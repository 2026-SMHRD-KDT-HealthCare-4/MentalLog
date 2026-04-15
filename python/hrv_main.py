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
import matplotlib.font_manager as fm

# 한글 폰트 설정 (Windows: 맑은 고딕)
_korean_font = None
for _fname in ['Malgun Gothic', 'NanumGothic', 'AppleGothic', 'Nanum Gothic']:
    if any(_fname.lower() in f.name.lower() for f in fm.fontManager.ttflist):
        _korean_font = _fname
        break
if _korean_font:
    plt.rcParams['font.family'] = _korean_font
plt.rcParams['axes.unicode_minus'] = False  # 마이너스 기호 깨짐 방지
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
    """그래프 URL을 Node.js API를 통해 tb_session에 저장."""
    import json
    try:
        requests.post(
            f"{NODE_API}/api/graph-url",
            json={"session_id": session_id, "graph_url": graph_url},
            timeout=5,
        )
        print(f"✅ DB graph_url 저장 완료: session={session_id}")
    except Exception as e:
        print(f"⚠️ DB graph_url 저장 실패: {e}")


def save_hrv_to_db(session_id: int, hr: float, rmssd: float, pnn50: float, sd1: float):
    """10초 단위 HRV 요약을 Node.js API를 통해 저장."""
    try:
        requests.post(
            f"{NODE_API}/api/rmssd",
            json={
                "session_id": session_id,
                "hr_val":     round(hr),
                "rmssd_val":  round(rmssd),
                "pnn50_val":  round(pnn50),
                "sd1_val":    round(sd1),
            },
            timeout=5,
        )
        print(f"✅ HRV 저장: session={session_id} rmssd={round(rmssd)} hr={round(hr)}")
    except Exception as e:
        print(f"⚠️ HRV 저장 실패: {e}")


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


# ── 음성 파이프라인 관리 ────────────────────────────────────────────────
import asyncio
import random
import sys
import os
import threading

_voice_tasks: Dict[str, dict] = {}   # session_id → {tasks, threshold_ref, stop_event}


@app.post("/start-voice")
async def start_voice(request: Dict):
    """
    대시보드 진입 시 호출.
    session_id 에 대한 음성 파이프라인(녹음→STT→ML)을 백그라운드로 시작.
    HRV 스트레스는 mock(랜덤) 값 사용.
    """
    # 처음 호출 시에만 import (KoTE 모델 로딩 지연)
    sys.path.insert(0, os.path.dirname(__file__))
    from voice_pipeline import run_pipeline, RECORD_SECONDS

    session_id = str(request.get("session_id", ""))
    pss_score  = float(request.get("pss_score",  0.0))
    threshold  = float(request.get("threshold",  70.0))

    if not session_id:
        return {"error": "session_id 필수"}

    # 이미 실행 중이면 기존 것 중단
    if session_id in _voice_tasks:
        prev = _voice_tasks.pop(session_id)
        prev["stop_event"].set()
        for t in prev["tasks"]:
            t.cancel()

    hrv_q: asyncio.Queue  = asyncio.Queue()
    threshold_ref          = [threshold]
    stop_event             = threading.Event()   # 진단 완료 시 set() → 현재 녹음 즉시 종료

    async def _mock_hrv_poller():
        await hrv_q.put(random.uniform(60, 80))   # 첫 청크에도 값 있도록 즉시 투입
        while True:
            await asyncio.sleep(RECORD_SECONDS)
            await hrv_q.put(random.uniform(60, 80))

    pipeline_task = asyncio.create_task(
        run_pipeline(
            session_id=session_id,
            pss_score=pss_score,
            threshold_ref=threshold_ref,
            hrv_stress_queue=hrv_q,
            stop_event=stop_event,
        )
    )
    poller_task = asyncio.create_task(_mock_hrv_poller())
    _voice_tasks[session_id] = {
        "tasks":         [pipeline_task, poller_task],
        "threshold_ref": threshold_ref,
        "stop_event":    stop_event,
    }

    print(f"[Voice] 파이프라인 시작 — session={session_id}")
    return {"status": "started", "session_id": session_id}


@app.post("/stop-voice")
async def stop_voice(request: Dict):
    """
    진단 완료 시 호출.
    stop_event 를 set → 현재 녹음을 즉시 끊고 그때까지의 오디오를 STT 에 제출.
    STT/ML 처리는 백그라운드에서 계속 완료됨.
    """
    session_id = str(request.get("session_id", ""))
    entry = _voice_tasks.pop(session_id, None)
    if entry:
        # 현재 녹음을 즉시 종료시키는 신호 (process_chunk 백그라운드 태스크는 계속 실행)
        entry["stop_event"].set()
        # HRV poller 만 즉시 취소 (pipeline_task 는 stop_event 감지 후 자체 종료)
        entry["tasks"][1].cancel()
    print(f"[Voice] 파이프라인 중지 요청 — session={session_id} (마지막 청크 STT 처리 중)")
    return {"status": "stopped", "session_id": session_id}


@app.post("/api/calibrate")
async def calibrate():
    """
    의사가 4초 말하는 동안 녹음 → ReturnZero STT → doctor_speaker_id 저장.
    voice_pipeline 과 같은 프로세스이므로 전역변수 즉시 공유됨.
    """
    sys.path.insert(0, os.path.dirname(__file__))
    from voice_pipeline import calibrate_doctor
    result = await calibrate_doctor()
    return result


@app.post("/api/reset-calibration")
async def reset_calib():
    """세션 종료 시 캘리브레이션 초기화."""
    sys.path.insert(0, os.path.dirname(__file__))
    from voice_pipeline import reset_calibration
    reset_calibration()
    return {"success": True}


@app.post("/update-voice")
async def update_voice(request: Dict):
    """
    PSS 제출 시 호출. 실행 중인 음성 파이프라인의 임계치를 즉시 업데이트.
    """
    session_id = str(request.get("session_id", ""))
    threshold  = float(request.get("threshold", 70.0))
    entry = _voice_tasks.get(session_id)
    if entry:
        entry["threshold_ref"][0] = threshold
        print(f"[Voice] 임계치 업데이트 — session={session_id} threshold={threshold}")
        return {"status": "updated", "threshold": threshold}
    return {"status": "not_found", "session_id": session_id}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
