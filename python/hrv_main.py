from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from datetime import datetime
from collections import deque
from typing import Dict
import numpy as np
import joblib
import requests
import uvicorn

NODE_API = "http://localhost:3001"


# === HRV ML 모델 로드 ===
try:
    bundle = joblib.load('stress_bundle.pkl')
except:
    bundle = None


# === FastAPI 앱 설정 ===
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === 더미 데이터 생성기 === 여기는 있는 데이터 가지고 수정할 부분
class DummyDataGenerator:
    """시계열 더미 데이터 생성"""
    def __init__(self):
        pass

    def generate_metrics_for_timestamp(self, timestamp: datetime) -> Dict:
        """주어진 시점에 대해 더미 데이터 생성"""
        hour = timestamp.hour
        minute = timestamp.minute
        second = timestamp.second

        # 시간대별 기본값
        if 6 <= hour < 12:
            base_hr, base_rmssd, base_pnn50, base_sd1 = 45, 28, 8, 20
        elif 12 <= hour < 18:
            base_hr, base_rmssd, base_pnn50, base_sd1 = 55, 35, 15, 25
        else:
            base_hr, base_rmssd, base_pnn50, base_sd1 = 65, 42, 22, 30

        # 분/초 단위 미세 변동
        minute_factor = (minute + second / 60) / 60
        second_noise = np.sin(second * 0.1) * 5

        return {
            "hr":    max(20, base_hr    + minute_factor * 15 + second_noise + np.random.normal(0, 2)),
            "rmssd": max(10, base_rmssd + minute_factor * 12 + second_noise + np.random.normal(0, 1.5)),
            "pnn50": max(0,  base_pnn50 + minute_factor * 10 + second_noise + np.random.normal(0, 1)),
            "sd1":   max(5,  base_sd1   + minute_factor * 8  + second_noise + np.random.normal(0, 1.5)),
        }

# === 글로벌 상태 관리 ===
class MetricsBuffer:
    def __init__(self, window_size: int = 6000):
        self.hr_buffer    = deque(maxlen=window_size)
        self.rmssd_buffer = deque(maxlen=window_size)
        self.pnn50_buffer = deque(maxlen=window_size)
        self.sd1_buffer   = deque(maxlen=window_size)
        self.last_ml_run  = None
        # 1분 베이스라인
        self.baseline_start  = None
        self.baseline_values = []
        self.baseline_rmssd  = None   # 확정되면 float 값

    def add_metrics(self, hr: float, rmssd: float, pnn50: float, sd1: float):
        self.hr_buffer.append(hr)
        self.rmssd_buffer.append(rmssd)
        self.pnn50_buffer.append(pnn50)
        self.sd1_buffer.append(sd1)
        # 베이스라인 수집 (최초 60초)
        if self.baseline_rmssd is None:
            if self.baseline_start is None:
                self.baseline_start = datetime.now()
            elapsed = (datetime.now() - self.baseline_start).total_seconds()
            if elapsed < 60:
                self.baseline_values.append(rmssd)
            elif self.baseline_values:
                self.baseline_rmssd = round(float(np.mean(self.baseline_values)), 2)

    def should_run_ml(self, current_time: datetime) -> bool:
        current_minute_key = (current_time.hour, current_time.minute)
        if self.last_ml_run is None or self.last_ml_run != current_minute_key:
            self.last_ml_run = current_minute_key
            return True
        return False

    def run_ml_model(self, current_time: datetime) -> Dict:
        if len(self.hr_buffer) == 0:
            return {"status": "insufficient_data"}

        metrics_summary = {
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

        # ML 모델 실행 (1분마다 모은 데이터를 모델에 집어넣는 코드)
        if bundle is not None:
            try:
                import pandas as pd
                input_df = pd.DataFrame([{
                    'HR':    metrics_summary["hr_mean"],
                    'RMSSD': metrics_summary["rmssd_mean"],
                    'pNN50': metrics_summary["pnn50_mean"],
                    'SD1':   metrics_summary["sd1_mean"],
                }])
                shap_vals = bundle['explainer'].shap_values(input_df)
                shap_pct  = np.abs(shap_vals[0, :, 1]) / np.abs(shap_vals[0, :, 1]).sum()
                input_norm = bundle['scaler'].transform(input_df)[0]
                score = round((input_norm * shap_pct).sum() * 100, 1)
                metrics_summary["ml_prediction"] = float(score)
            except Exception as e:
                metrics_summary["ml_error"] = str(e)

        return metrics_summary

# === 인스턴스 생성 ===
metrics_buffer  = MetricsBuffer()
dummy_generator = DummyDataGenerator()

@app.post("/generate-metrics")
async def generate_metrics_for_time(request: Dict):
    """
    특정 시간에 대한 더미 데이터 생성 및 처리
    요청: { "hour": 10, "minute": 30, "second": 45, "data_points": 100 }
    """
    try:
        hour        = request.get("hour", 0)
        minute      = request.get("minute", 0)
        second      = request.get("second", 0)
        data_points = request.get("data_points", 100)
        pat_id      = request.get("pat_id", None)
        session_id  = request.get("session_id", None)

        timestamp = datetime.now().replace(hour=hour, minute=minute, second=second, microsecond=0)

        results = {
            "timestamp":      timestamp.isoformat(),
            "data_generated": 0,
            "realtime_rmssd": [],
            "ml_triggered":   False,
            "ml_result":      None,
            "baseline_ready": metrics_buffer.baseline_rmssd is not None,
            "baseline_rmssd": metrics_buffer.baseline_rmssd,
        }

        # 데이터포인트 생성
        for i in range(data_points):
            metrics = dummy_generator.generate_metrics_for_timestamp(timestamp)
            metrics_buffer.add_metrics(
                hr=metrics["hr"], rmssd=metrics["rmssd"],
                pnn50=metrics["pnn50"], sd1=metrics["sd1"],
            )
            results["data_generated"] += 1
            if i >= data_points - 10:
                results["realtime_rmssd"].append(round(metrics["rmssd"], 2))

        # RMSSD → Node DB 저장
        if pat_id:
            for rmssd_val in results["realtime_rmssd"]:
                try:
                    requests.post(f"{NODE_API}/api/rmssd", json={
                        "pat_id": pat_id, "session_id": session_id, "rmssd_value": rmssd_val,
                    }, timeout=2)
                except Exception:
                    pass

        # 분이 바뀔 때 ML 실행
        if metrics_buffer.should_run_ml(timestamp):
            ml_result = metrics_buffer.run_ml_model(timestamp)
            results["ml_triggered"] = True
            results["ml_result"]    = ml_result

            # ML 결과 → Node DB 저장
            if pat_id:
                try:
                    requests.post(f"{NODE_API}/api/stress", json={
                        "pat_id":               pat_id,
                        "session_id":           session_id,
                        "hrv_stress":           ml_result.get("ml_prediction", 0),
                        "voice_stress":         0,
                        "questionnaire_stress": 0,
                        "total_stress":         ml_result.get("ml_prediction", 0),
                    }, timeout=2)
                except Exception:
                    pass

        return results

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/health")
async def health_check():
    return {
        "status":      "ok",
        "buffer_size": len(metrics_buffer.rmssd_buffer),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
