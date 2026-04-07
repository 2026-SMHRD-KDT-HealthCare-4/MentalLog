from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from dotenv import load_dotenv
import numpy as np
import joblib
import librosa
import requests
import uvicorn
import json
import os
import io

load_dotenv()

# === 음성 분석 ML 모델 로드 ===
try:
    voice_model = joblib.load('voice_stress_model.pkl')
    voice_le    = joblib.load('label_encoder.pkl')
    print("음성 AI 모델 로딩 완료!")
except Exception as e:
    print(f"음성 모델 로드 실패 (파일 경로를 확인하세요): {e}")
    voice_model = None
    voice_le    = None

# === FastAPI 앱 설정 ===
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API ───────────────────────────────────────────────────────────────────

@app.post("/api/analyze-voice")
async def analyze_voice(audio_file: UploadFile = File(...)):
    """
    프론트엔드에서 녹음된 음성 파일을 받아 스트레스 분석 + STT 결과 반환
    - stress:     감정 분류 라벨 (음성 모델 학습 완료 후 활성화)
    - transcript: 네이버 클로바 STT 변환 텍스트
    """
    if voice_model is None or voice_le is None:
        return {"status": "error", "message": "음성 모델이 로드되지 않았습니다."}

    try:
        contents = await audio_file.read()

        y, sr = librosa.load(io.BytesIO(contents), sr=None, duration=3.0)
        mfccs        = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40)
        mfccs_scaled = np.mean(mfccs.T, axis=0).reshape(1, -1)
        stress_result = voice_le.inverse_transform(voice_model.predict(mfccs_scaled))[0]

        # STT는 전체 오디오 사용 (librosa는 3초 추출, STT는 전문 전달)
        stt_result = "인식 실패"
        try:
            headers = {"X-CLOVASPEECH-API-KEY": os.getenv("NCP_CLOVA_SPEECH_SECRET_KEY")}
            files = {
                "media":  contents,
                "params": (None, json.dumps({"language": "ko-KR", "completion": "sync"}), "application/json"),
            }
            stt_response = requests.post(
                os.getenv("NCP_CLOVA_SPEECH_URL"),
                headers=headers,
                files=files,
                timeout=5,
            )
            stt_result = stt_response.json().get("text", "인식 실패")
        except Exception:
            pass

        return {
            "status":     "success",
            "stress":     stress_result,
            "transcript": stt_result,
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/health")
async def health_check():
    return {
        "status":             "ok",
        "voice_model_loaded": voice_model is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
