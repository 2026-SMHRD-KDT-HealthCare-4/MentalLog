from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
from datetime import datetime, timedelta
from collections import deque
import numpy as np
from typing import Dict
import joblib

# === ML 모델 로드 ===
try:
    ml_model = joblib.load('models/health_metrics_model.pkl')
except:
    ml_model = None

# === FastAPI 앱 설정 ===
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === 더미 데이터 생성기 ===
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
            base_hrv, base_rmssd, base_pnn50, base_sd1 = 45, 28, 8, 20
        elif 12 <= hour < 18:
            base_hrv, base_rmssd, base_pnn50, base_sd1 = 55, 35, 15, 25
        else:
            base_hrv, base_rmssd, base_pnn50, base_sd1 = 65, 42, 22, 30
        
        # 분/초 단위 미세 변동
        minute_factor = (minute + second / 60) / 60
        second_noise = np.sin(second * 0.1) * 5
        
        return {
            "hrv": max(20, base_hrv + minute_factor * 15 + second_noise + np.random.normal(0, 2)),
            "rmssd": max(10, base_rmssd + minute_factor * 12 + second_noise + np.random.normal(0, 1.5)),
            "pnn50": max(0, base_pnn50 + minute_factor * 10 + second_noise + np.random.normal(0, 1)),
            "sd1": max(5, base_sd1 + minute_factor * 8 + second_noise + np.random.normal(0, 1.5))
        }

# === 글로벌 상태 관리 ===
class MetricsBuffer:
    def __init__(self, window_size: int = 6000):
        self.hrv_buffer = deque(maxlen=window_size)
        self.rmssd_buffer = deque(maxlen=window_size)
        self.pnn50_buffer = deque(maxlen=window_size)
        self.sd1_buffer = deque(maxlen=window_size)
        self.last_ml_run = None

    def add_metrics(self, hrv: float, rmssd: float, pnn50: float, sd1: float):
        self.hrv_buffer.append(hrv)
        self.rmssd_buffer.append(rmssd)
        self.pnn50_buffer.append(pnn50)
        self.sd1_buffer.append(sd1)

    def should_run_ml(self, current_time: datetime) -> bool:
        current_minute_key = (current_time.hour, current_time.minute)
        if self.last_ml_run is None or self.last_ml_run != current_minute_key:
            self.last_ml_run = current_minute_key
            return True
        return False

    def run_ml_model(self, current_time: datetime) -> Dict:
        if len(self.hrv_buffer) == 0:
            return {"status": "insufficient_data"}

        metrics_summary = {
            "timestamp": current_time.isoformat(),
            "minute": f"{current_time.hour:02d}:{current_time.minute:02d}",
            "data_points": len(self.hrv_buffer),
            "hrv_mean": float(np.mean(self.hrv_buffer)),
            "hrv_sum": float(np.sum(self.hrv_buffer)),
            "rmssd_mean": float(np.mean(self.rmssd_buffer)),
            "rmssd_sum": float(np.sum(self.rmssd_buffer)),
            "pnn50_mean": float(np.mean(self.pnn50_buffer)),
            "pnn50_sum": float(np.sum(self.pnn50_buffer)),
            "sd1_mean": float(np.mean(self.sd1_buffer)),
            "sd1_sum": float(np.sum(self.sd1_buffer)),
        }

        # ML 모델 실행
        if ml_model is not None:
            try:
                features = np.array([[
                    metrics_summary["hrv_mean"],
                    metrics_summary["rmssd_mean"],
                    metrics_summary["pnn50_mean"],
                    metrics_summary["sd1_mean"]
                ]])
                prediction = ml_model.predict(features)[0]
                metrics_summary["ml_prediction"] = float(prediction)
            except Exception as e:
                metrics_summary["ml_error"] = str(e)

        return metrics_summary

# === 인스턴스 생성 ===
metrics_buffer = MetricsBuffer()
dummy_generator = DummyDataGenerator()

# === 단일 REST API ===
@app.post("/generate-metrics")
async def generate_metrics_for_time(request: Dict):
    """
    특정 시간에 대한 더미 데이터 생성 및 처리
    
    요청:
    {
        "hour": 10,
        "minute": 30,
        "second": 45,
        "data_points": 100
    }
    """
    try:
        hour = request.get("hour", 0)
        minute = request.get("minute", 0)
        second = request.get("second", 0)
        data_points = request.get("data_points", 100)
        
        timestamp = datetime.now().replace(hour=hour, minute=minute, second=second, microsecond=0)
        
        results = {
            "timestamp": timestamp.isoformat(),
            "data_generated": 0,
            "rmssd_samples": [],
            "ml_triggered": False,
            "ml_result": None
        }
        
        # 데이터포인트 생성
        for i in range(data_points):
            metrics = dummy_generator.generate_metrics_for_timestamp(timestamp)
            metrics_buffer.add_metrics(
                hrv=metrics["hrv"],
                rmssd=metrics["rmssd"],
                pnn50=metrics["pnn50"],
                sd1=metrics["sd1"]
            )
            results["data_generated"] += 1
            
            if i >= data_points - 10:
                results["rmssd_samples"].append(round(metrics["rmssd"], 2))
        
        # 분이 바뀔 때 ML 실행
        if metrics_buffer.should_run_ml(timestamp):
            ml_result = metrics_buffer.run_ml_model(timestamp)
            results["ml_triggered"] = True
            results["ml_result"] = ml_result
        
        return results
    
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "buffer_size": len(metrics_buffer.rmssd_buffer)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)