from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from datetime import datetime
from collections import deque
from typing import Dict, List, Optional
import numpy as np
import joblib
import pickle
import requests
import uvicorn
import neurokit2 as nk
import matplotlib
matplotlib.use('Agg')   # GUI 없는 환경에서 렌더링
import matplotlib.pyplot as plt
import io
import firebase_admin
from firebase_admin import credentials, storage

NODE_API        = "http://localhost:3001"
ECG_SAMPLE_RATE = 700   # Hz
WINDOW_SEC      = 15    # 슬라이딩 윈도우 (초)
MIN_SEC_FOR_HRV = 5     # 최소 버퍼 (초)

# === Firebase 초기화 ===
try:
    cred = credentials.Certificate('devil-nayeon-firebase-adminsdk-fbsvc-08b215c51e.json')
    firebase_admin.initialize_app(cred, {
        'storageBucket': 'devil-nayeon.firebasestorage.app'
    })
    fb_bucket = storage.bucket()
    print("Firebase Storage 초기화 성공")
except Exception as e:
    fb_bucket = None
    print(f"⚠️ Firebase 초기화 실패: {e}")

# === ECG 데이터 로드 ===
try:
    with open('S2.pkl', 'rb') as f:
        s2_raw = pickle.load(f, encoding='latin1')
    ecg_signal = s2_raw['signal']['chest']['ECG'].flatten().astype(np.float64)
    print(f"ECG 로드 성공: {len(ecg_signal):,} samples ({len(ecg_signal)/ECG_SAMPLE_RATE:.1f}초)")
except Exception as e:
    print(f"⚠️ ECG 로드 실패: {e}")
    ecg_signal = None

# === ML 모델 로드 ===
try:
    bundle = joblib.load('stress_bundle.pkl')
    print("ML 모델 로드 성공")
except FileNotFoundError:
    print("⚠️ stress_bundle.pkl 없음 → RMSSD 폴백 모드")
    bundle = None
except Exception as e:
    print(f"⚠️ ML 모델 로드 실패: {e} → RMSSD 폴백 모드")
    bundle = None

# === FastAPI 앱 ===
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# === ECG 처리기 (실시간 슬라이딩 윈도우) ===
class ECGProcessor:
    """
    S2.pkl ECG 신호를 초당 700 samples씩 읽어
    슬라이딩 윈도우로 neurokit2 HRV 지표를 계산한다.
    """
    def __init__(self):
        self.pointer    = 0
        self.ecg_buffer = deque(maxlen=ECG_SAMPLE_RATE * WINDOW_SEC)
        self.session_start = None

    def reset(self):
        self.pointer    = 0
        self.ecg_buffer.clear()
        self.session_start = None

    def get_next_second_metrics(self) -> Dict:
        """1초치 ECG 추가 후 슬라이딩 윈도우로 HRV 계산. 신호 없으면 빈 dict 반환."""
        if ecg_signal is None:
            return {}

        if self.session_start is None:
            self.session_start = datetime.now()

        # 1초(700 samples) 추출 — 끝에 도달하면 처음부터 루프
        start = self.pointer % len(ecg_signal)
        end   = start + ECG_SAMPLE_RATE
        if end <= len(ecg_signal):
            chunk = ecg_signal[start:end]
        else:
            chunk = np.concatenate([ecg_signal[start:], ecg_signal[:end - len(ecg_signal)]])
        self.pointer += ECG_SAMPLE_RATE

        self.ecg_buffer.extend(chunk)

        # 최소 버퍼 미달 시 계산 불가
        if len(self.ecg_buffer) < ECG_SAMPLE_RATE * MIN_SEC_FOR_HRV:
            return {"rmssd": None, "hr": None, "pnn50": None, "sd1": None}

        try:
            arr = np.array(self.ecg_buffer, dtype=np.float64)
            signals, info = nk.ecg_process(arr, sampling_rate=ECG_SAMPLE_RATE)
            r_peaks = info['ECG_R_Peaks']

            if len(r_peaks) < 3:
                return {"rmssd": None, "hr": None, "pnn50": None, "sd1": None}

            rr_ms = np.diff(r_peaks) / ECG_SAMPLE_RATE * 1000  # ms
            diff_rr = np.diff(rr_ms)

            rmssd = float(np.sqrt(np.mean(diff_rr ** 2)))
            hr    = float(60000 / np.mean(rr_ms))
            pnn50 = float(np.sum(np.abs(diff_rr) > 50) / len(diff_rr) * 100) if len(diff_rr) > 0 else 0.0
            sd1   = float(np.std(diff_rr) / np.sqrt(2))

            return {
                "rmssd": round(rmssd, 2),
                "hr":    round(hr,    1),
                "pnn50": round(pnn50, 2),
                "sd1":   round(sd1,   2),
            }
        except Exception as e:
            return {"rmssd": None, "hr": None, "pnn50": None, "sd1": None}


# === 메트릭 버퍼 (분당 ML 실행) ===
class MetricsBuffer:
    def __init__(self, window_size: int = 6000):
        self.hr_buffer    = deque(maxlen=window_size)
        self.rmssd_buffer = deque(maxlen=window_size)
        self.pnn50_buffer = deque(maxlen=window_size)
        self.sd1_buffer   = deque(maxlen=window_size)
        self.last_ml_run  = None
        self.baseline_start  = None
        self.baseline_values = []
        self.baseline_rmssd  = None

    def add_metrics(self, hr: float, rmssd: float, pnn50: float, sd1: float):
        self.hr_buffer.append(hr)
        self.rmssd_buffer.append(rmssd)
        self.pnn50_buffer.append(pnn50)
        self.sd1_buffer.append(sd1)
        # 1분 베이스라인 수집
        if self.baseline_rmssd is None:
            if self.baseline_start is None:
                self.baseline_start = datetime.now()
            elapsed = (datetime.now() - self.baseline_start).total_seconds()
            if elapsed < 60:
                self.baseline_values.append(rmssd)
            elif self.baseline_values:
                self.baseline_rmssd = round(float(np.mean(self.baseline_values)), 2)

    def should_run_ml(self, current_time: datetime) -> bool:
        key = (current_time.hour, current_time.minute)
        if self.last_ml_run is None or self.last_ml_run != key:
            self.last_ml_run = key
            return True
        return False

    def run_ml_model(self, current_time: datetime) -> Dict:
        if len(self.rmssd_buffer) == 0:
            return {"status": "insufficient_data"}

        summary = {
            "timestamp":   current_time.isoformat(),
            "minute":      f"{current_time.hour:02d}:{current_time.minute:02d}",
            "data_points": len(self.hr_buffer),
            "hr_mean":     float(np.mean(self.hr_buffer)),
            "hr_max":      float(np.max(self.hr_buffer)),
            "rmssd_mean":  float(np.mean(self.rmssd_buffer)),
            "rmssd_max":   float(np.max(self.rmssd_buffer)),
            "pnn50_mean":  float(np.mean(self.pnn50_buffer)),
            "pnn50_max":   float(np.max(self.pnn50_buffer)),
            "sd1_mean":    float(np.mean(self.sd1_buffer)),
            "sd1_max":     float(np.max(self.sd1_buffer)),
        }

        # ML 모델 실행
        if bundle is not None:
            try:
                import pandas as pd
                input_df = pd.DataFrame([{
                    'HR':    summary["hr_mean"],
                    'RMSSD': summary["rmssd_mean"],
                    'pNN50': summary["pnn50_mean"],
                    'SD1':   summary["sd1_mean"],
                }])
                shap_vals = bundle['explainer'].shap_values(input_df)
                shap_pct  = np.abs(shap_vals[0, :, 1]) / np.abs(shap_vals[0, :, 1]).sum()
                input_norm = bundle['scaler'].transform(input_df)[0]
                score = round((input_norm * shap_pct).sum() * 100, 1)
                summary["ml_prediction"] = float(max(0.0, min(100.0, score)))
            except Exception as e:
                summary["ml_error"] = str(e)

        # 번들 없거나 예외 → RMSSD 폴백
        if "ml_prediction" not in summary:
            r = summary["rmssd_mean"]
            summary["ml_prediction"] = float(round(max(0.0, min(100.0, 100 - ((r - 5) / 95) * 100)), 1))

        # 버퍼 초기화 (다음 분은 새 데이터만)
        self.hr_buffer.clear()
        self.rmssd_buffer.clear()
        self.pnn50_buffer.clear()
        self.sd1_buffer.clear()

        return summary


# === 세션별 RMSSD 히스토리 (그래프 생성용) ===
# session_id → [(timestamp_str, rmssd), ...]
session_rmssd_history: Dict[str, List] = {}


def upload_graph_to_firebase(session_id: str, rmssd_history: List) -> Optional[str]:
    """
    RMSSD 히스토리로 그래프 이미지를 생성하고 Firebase Storage에 업로드.
    반환값: 공개 다운로드 URL (실패 시 None)
    """
    if fb_bucket is None or not rmssd_history:
        return None
    try:
        times  = [r[0] for r in rmssd_history]
        values = [r[1] for r in rmssd_history]
        xs = range(len(values))

        fig, ax = plt.subplots(figsize=(16, 5), dpi=150)
        fig.patch.set_facecolor('#FAFAFA')
        ax.set_facecolor('#FAFAFA')

        # 라인 + 그라데이션 fill
        ax.plot(xs, values, color='#4A90D9', linewidth=2.2, zorder=3)
        ax.fill_between(xs, values, color='#4A90D9', alpha=0.15, zorder=2)

        # 최고점 / 최저점 마커
        max_idx = int(np.argmax(values))
        min_idx = int(np.argmin(values))
        ax.scatter([max_idx], [values[max_idx]], color='red',   zorder=5, s=60)
        ax.scatter([min_idx], [values[min_idx]], color='green', zorder=5, s=60)
        ax.annotate(f'최고 {values[max_idx]:.1f}ms',
                    xy=(max_idx, values[max_idx]),
                    xytext=(6, 6), textcoords='offset points',
                    fontsize=8, color='red')
        ax.annotate(f'최저 {values[min_idx]:.1f}ms',
                    xy=(min_idx, values[min_idx]),
                    xytext=(6, -14), textcoords='offset points',
                    fontsize=8, color='green')

        # X축 레이블: 전체 중 10개 균등 표시
        n = len(times)
        tick_indices = [round(i * (n - 1) / 9) for i in range(10)] if n >= 10 else list(range(n))
        ax.set_xticks(tick_indices)
        ax.set_xticklabels([times[i] for i in tick_indices],
                           fontsize=8, rotation=30, ha='right', color='#888888')

        # Y축
        ax.set_ylabel('RMSSD (ms)', fontsize=9, color='#888888')
        ax.tick_params(axis='y', colors='#888888')

        # 타이틀
        ax.set_title(f'Session {session_id} — RMSSD 추이',
                     fontsize=12, fontweight='bold', color='#333333')

        # 그리드 (가로 + 세로 점선, 흐리게)
        ax.grid(axis='y', linestyle='--', alpha=0.3, color='#AAAAAA', zorder=1)
        ax.grid(axis='x', linestyle='--', alpha=0.15, color='#AAAAAA', zorder=1)

        # 테두리 정리
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['left'].set_edgecolor('#DDDDDD')
        ax.spines['bottom'].set_edgecolor('#DDDDDD')

        fig.tight_layout()

        buf = io.BytesIO()
        fig.savefig(buf, format='png', facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)

        blob_path = f"hrv_graphs/{session_id}.png"
        blob = fb_bucket.blob(blob_path)
        blob.upload_from_file(buf, content_type='image/png')
        blob.make_public()
        url = blob.public_url
        print(f"Firebase 업로드 완료: {url}")
        return url
    except Exception as e:
        print(f"⚠️ Firebase 업로드 실패: {e}")
        return None


def save_graph_url_to_db(session_id: str, graph_url: str):
    """그래프 URL을 tb_session.stress_graph_data(JSON)에 직접 저장."""
    import psycopg2, json
    conn = None
    try:
        conn = psycopg2.connect(
            host="project-db-campus.smhrd.com",
            port=3310,
            dbname="campus_25kdt_ha4_p2_3",
            user="campus_25kdt_ha4_p2_3",
            password="smhrd3",
        )
        cur = conn.cursor()

        # 기존 stress_graph_data 조회
        cur.execute(
            "SELECT stress_graph_data FROM tb_session WHERE session_id = %s",
            (int(session_id),)
        )
        row = cur.fetchone()
        if row is None:
            print(f"⚠️ session_id {session_id} 없음 — URL만 로그")
            print(f"graph_url: {graph_url}")
            return

        existing = {}
        try:
            existing = json.loads(row[0] or '{}')
        except Exception:
            existing = {}

        existing['graph_url'] = graph_url

        cur.execute(
            "UPDATE tb_session SET stress_graph_data = %s WHERE session_id = %s",
            (json.dumps(existing), int(session_id))
        )
        conn.commit()
        print(f"✅ DB graph_url 저장 완료: session={session_id}")
    except Exception as e:
        print(f"⚠️ DB graph_url 저장 실패: {e}")
    finally:
        if conn:
            conn.close()


def save_hrv_to_db(session_id: int, hr: float, rmssd: float, pnn50: float, sd1: float):
    """10초 단위 HRV 요약을 tb_hrv_data에 직접 저장."""
    import psycopg2
    conn = None
    try:
        conn = psycopg2.connect(
            host="project-db-campus.smhrd.com",
            port=3310,
            dbname="campus_25kdt_ha4_p2_3",
            user="campus_25kdt_ha4_p2_3",
            password="smhrd3",
        )
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO tb_hrv_data (session_id, hr_val, rmssd_val, pnn50_val, sd1_val, time_stamp)
               VALUES (%s, %s, %s, %s, %s, NOW())""",
            (session_id, round(hr), round(rmssd), round(pnn50), round(sd1))
        )
        conn.commit()
        print(f"✅ HRV 저장: session={session_id} rmssd={round(rmssd)} hr={round(hr)}")
    except Exception as e:
        print(f"⚠️ HRV DB 저장 실패: {e}")
    finally:
        if conn:
            conn.close()


# === 인스턴스 ===
ecg_processor  = ECGProcessor()
metrics_buffer = MetricsBuffer()
hrv_save_counter: Dict[str, int] = {}   # session_id → 초 카운터


@app.post("/generate-metrics")
async def generate_metrics(request: Dict):
    """
    React에서 1초마다 호출.
    ECG 신호 1초 분량을 읽어 실시간 RMSSD 반환.
    분이 바뀌면 ML 모델 실행 후 스트레스 지수 반환.
    """
    try:
        session_id = request.get("session_id")
        now = datetime.now()

        metrics = ecg_processor.get_next_second_metrics()
        rmssd = metrics.get("rmssd")
        hr    = metrics.get("hr")
        pnn50 = metrics.get("pnn50")
        sd1   = metrics.get("sd1")

        if rmssd is not None:
            metrics_buffer.add_metrics(hr or 0, rmssd, pnn50 or 0, sd1 or 0)
            if session_id:
                sid_str = str(session_id)
                # 세션별 히스토리 누적 (Firebase 그래프용)
                if sid_str not in session_rmssd_history:
                    session_rmssd_history[sid_str] = []
                session_rmssd_history[sid_str].append(
                    (now.strftime('%H:%M:%S'), round(rmssd, 1))
                )
                # 10초마다 tb_hrv_data 직접 저장
                hrv_save_counter[sid_str] = hrv_save_counter.get(sid_str, 0) + 1
                if hrv_save_counter[sid_str] % 10 == 0:
                    save_hrv_to_db(
                        int(session_id),
                        hr or 0, rmssd, pnn50 or 0, sd1 or 0
                    )

        results = {
            "realtime_rmssd": [rmssd] if rmssd is not None else [],
            "ml_triggered":   False,
            "ml_result":      None,
            "baseline_ready": metrics_buffer.baseline_rmssd is not None,
            "baseline_rmssd": metrics_buffer.baseline_rmssd,
        }

        # 분당 ML 실행 (베이스라인 완료 후) → 스트레스 지수만 계산
        if metrics_buffer.baseline_rmssd is not None and metrics_buffer.should_run_ml(now):
            ml_result = metrics_buffer.run_ml_model(now)
            results["ml_triggered"] = True
            results["ml_result"]    = ml_result

        return results

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/upload-graph")
async def upload_graph(request: Dict):
    """
    세션 종료 시 React에서 호출.
    해당 세션의 RMSSD 히스토리로 그래프를 생성 → Firebase 업로드 → URL 반환.
    """
    session_id = str(request.get("session_id", ""))
    if not session_id:
        return {"error": "session_id 필수"}

    history = session_rmssd_history.get(session_id, [])
    if not history:
        return {"error": "해당 세션의 RMSSD 데이터 없음", "graph_url": None}

    graph_url = upload_graph_to_firebase(session_id, history)
    if graph_url:
        save_graph_url_to_db(session_id, graph_url)
        # 메모리에서 정리
        session_rmssd_history.pop(session_id, None)
    return {"graph_url": graph_url}


@app.post("/reset-baseline")
async def reset_baseline():
    metrics_buffer.baseline_start  = None
    metrics_buffer.baseline_values = []
    metrics_buffer.baseline_rmssd  = None
    metrics_buffer.last_ml_run     = None
    ecg_processor.reset()
    return {"status": "ok", "message": "베이스라인 + ECG 포인터 초기화 완료"}


@app.get("/health")
async def health_check():
    return {
        "status":        "ok",
        "buffer_size":   len(metrics_buffer.rmssd_buffer),
        "ecg_pointer":   ecg_processor.pointer,
        "ecg_available": ecg_signal is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
