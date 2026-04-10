from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from typing import Dict
import uvicorn

# 가중치 설정 (조절 가능)
STRESS_WEIGHTS = {
    "hrv":           0.5,   # HRV 스트레스 가중치
    "voice":         0.2,   # 음성 스트레스 가중치 (모델 학습 완료 후 활성화)
    "questionnaire": 0.3,   # 문진(PSS) 스트레스 가중치
}

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/final-stress")
async def calculate_final_stress(request: Dict):
    """
    HRV + 음성 + 문진(PSS) 스트레스를 가중 합산하여 최종 스트레스 지수 반환
    요청: { "hrv_stress": 70, "voice_stress": 0, "pss_score": 50 }
    """
    hrv_stress   = float(request.get("hrv_stress", 0))
    voice_stress = float(request.get("voice_stress", 0))  # 음성 모델 학습 완료 전: 0
    pss_score    = float(request.get("pss_score", 0))

    final_stress = round(
        hrv_stress   * STRESS_WEIGHTS["hrv"] +
        voice_stress * STRESS_WEIGHTS["voice"] +
        pss_score    * STRESS_WEIGHTS["questionnaire"]
    )

    if final_stress < 40:
        level = "낮음"
    elif final_stress < 60:
        level = "보통"
    elif final_stress < 75:
        level = "높음"
    else:
        level = "매우 높음"

    return {
        "status":       "success",
        "final_stress": final_stress,
        "level":        level,
        "breakdown": {
            "hrv_stress":         hrv_stress,
            "hrv_contribution":   round(hrv_stress   * STRESS_WEIGHTS["hrv"], 1),
            "voice_stress":       voice_stress,
            "voice_contribution": round(voice_stress * STRESS_WEIGHTS["voice"], 1),
            "pss_score":          pss_score,
            "pss_contribution":   round(pss_score    * STRESS_WEIGHTS["questionnaire"], 1),
        },
        "weights": STRESS_WEIGHTS,
    }

@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
