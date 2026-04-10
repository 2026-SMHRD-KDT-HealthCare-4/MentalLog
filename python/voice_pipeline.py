"""
voice_pipeline.py — 1분 단위 음성 수집 → 클로바 STT + 화자분리 → 음성 ML → 통합 스트레스 계산

실행 방법 (단독):
    python voice_pipeline.py --session_id 1234 --patient_id P001

hrv_main 과의 연동:
    run_pipeline() 의 hrv_stress_queue(asyncio.Queue) 에 1분마다 hrv_stress 값을 put() 한다.
    예) await hrv_stress_queue.put(ml_prediction)
"""

import asyncio
import io
import json
import logging
import wave
from collections import Counter
from datetime import datetime

import boto3
import joblib
import librosa
import numpy as np
import requests

from stress_main import calculate_stress

# ── API 키 ──────────────────────────────────────────────────────────────
CLOVA_SPEECH_SECRET_KEY  = ""
CLOVA_SPEECH_INVOKE_URL  = ""
NAVER_STORAGE_ACCESS_KEY = ""
NAVER_STORAGE_SECRET_KEY = ""
NAVER_STORAGE_BUCKET     = ""

# ── 상수 ────────────────────────────────────────────────────────────────
PATIENT_SPEAKER_ID  = 1       # 화자분리 결과에서 환자 라벨 (추후 변경 가능)
TOP_KEYWORD_COUNT   = 5       # 키워드 추출 상위 N개
RECORD_SECONDS      = 60      # 녹음 구간 (초)
SAMPLE_RATE         = 16000   # Hz, mono
NCP_STORAGE_ENDPOINT = "https://kr.object.ncloudstorage.com"
NODE_API            = "http://localhost:3001"

# ── 로거 ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("voice_pipeline")

# ── 음성 ML 모델 로드 ────────────────────────────────────────────────────
try:
    _voice_model = joblib.load("voice_stress_model.pkl")
    log.info("음성 ML 모델 로드 성공")
except Exception as _e:
    _voice_model = None
    log.warning(f"음성 ML 모델 로드 실패: {_e}")

# ── 한국어 형태소 분석기 (kiwipiepy 우선, 없으면 정규식 폴백) ──────────────
try:
    from kiwipiepy import Kiwi
    _kiwi = Kiwi()
    def _extract_nouns(text: str) -> list[str]:
        return [tok.form for tok in _kiwi.tokenize(text) if tok.tag.startswith("NN")]
    log.info("kiwipiepy 형태소 분석기 사용")
except ImportError:
    import re
    _kiwi = None
    def _extract_nouns(text: str) -> list[str]:
        # 2글자 이상 한글 어절 추출 (폴백)
        return re.findall(r"[가-힣]{2,}", text)
    log.info("kiwipiepy 없음 → 정규식 폴백 사용")


# ════════════════════════════════════════════════════════════════════════
# 1. 마이크 녹음
# ════════════════════════════════════════════════════════════════════════

def _record_blocking(duration: int) -> bytes:
    """동기 함수. sounddevice 로 duration 초 녹음 후 WAV bytes 반환."""
    import sounddevice as sd

    audio = sd.rec(
        frames=duration * SAMPLE_RATE,
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
    )
    sd.wait()  # 녹음 완료 대기

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # int16 = 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())
    return buf.getvalue()


async def record_chunk() -> bytes:
    """비동기 래퍼. 이벤트 루프를 블록하지 않고 마이크 녹음."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _record_blocking, RECORD_SECONDS)


# ════════════════════════════════════════════════════════════════════════
# 2. 네이버 오브젝트 스토리지 업로드
# ════════════════════════════════════════════════════════════════════════

def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=NCP_STORAGE_ENDPOINT,
        aws_access_key_id=NAVER_STORAGE_ACCESS_KEY,
        aws_secret_access_key=NAVER_STORAGE_SECRET_KEY,
    )


async def upload_to_naver_storage(audio_bytes: bytes, object_key: str) -> str:
    """WAV bytes 를 NCP Object Storage 에 업로드하고 공개 URL 반환."""
    loop = asyncio.get_event_loop()

    def _upload():
        s3 = _s3_client()
        s3.put_object(
            Bucket=NAVER_STORAGE_BUCKET,
            Key=object_key,
            Body=audio_bytes,
            ContentType="audio/wav",
            ACL="public-read",
        )
        return f"{NCP_STORAGE_ENDPOINT}/{NAVER_STORAGE_BUCKET}/{object_key}"

    url = await loop.run_in_executor(None, _upload)
    log.info(f"[Storage] 업로드 완료 → {url}")
    return url


# ════════════════════════════════════════════════════════════════════════
# 3. 네이버 클로바 Speech (장문분석 + 화자분리)
# ════════════════════════════════════════════════════════════════════════

async def call_clova_speech(audio_url: str) -> dict:
    """
    NCP Object Storage URL 로 Clova Speech 장문분석 + 화자분리 호출.
    반환: Clova Speech 응답 JSON (segments 포함)
    """
    headers = {
        "Accept":               "application/json;UTF-8",
        "Content-Type":         "application/json;UTF-8",
        "X-CLOVASPEECH-API-KEY": CLOVA_SPEECH_SECRET_KEY,
    }
    payload = {
        "url":      audio_url,
        "language": "ko-KR",
        "completion": "sync",
        "diarization": {
            "enable":           True,
            "speakerCountMin":  2,
            "speakerCountMax":  2,
        },
        "timestamp": {"enable": True},
    }

    loop = asyncio.get_event_loop()

    def _post():
        resp = requests.post(
            f"{CLOVA_SPEECH_INVOKE_URL}/recognizer/url",
            headers=headers,
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()

    result = await loop.run_in_executor(None, _post)
    log.info(f"[Clova] 화자분리 완료 — segments: {len(result.get('segments', []))}")
    return result


# ════════════════════════════════════════════════════════════════════════
# 4. 환자 발화 추출
# ════════════════════════════════════════════════════════════════════════

def extract_patient_utterances(clova_result: dict) -> str:
    """
    Clova Speech 결과에서 PATIENT_SPEAKER_ID 화자 발화만 추출해 텍스트로 반환.
    segments[].speaker.label 이 str(PATIENT_SPEAKER_ID) 인 것만 수집.
    """
    segments = clova_result.get("segments", [])
    patient_label = str(PATIENT_SPEAKER_ID)
    utterances = [
        seg.get("text", "")
        for seg in segments
        if seg.get("speaker", {}).get("label") == patient_label
    ]
    return " ".join(utterances).strip()


# ════════════════════════════════════════════════════════════════════════
# 5. 음성 스트레스 ML
# ════════════════════════════════════════════════════════════════════════

def run_voice_ml(patient_text: str, audio_bytes: bytes) -> float:
    """
    음성 스트레스 ML 모델 실행. 텍스트 기반으로 예측 시도.
    모델이 없거나 실패 시 MFCC(오디오) 기반 폴백.
    반환: 0~100 float
    """
    if _voice_model is None:
        return 0.0

    # ── 텍스트 기반 예측 (Pipeline with vectorizer) ──
    try:
        pred = _voice_model.predict([patient_text])
        # 확률값 반환 가능 시 사용
        if hasattr(_voice_model, "predict_proba"):
            proba = _voice_model.predict_proba([patient_text])[0]
            # 클래스 순서에서 'stressed' 또는 양성 클래스 인덱스를 찾음
            classes = list(_voice_model.classes_)
            stress_idx = next(
                (i for i, c in enumerate(classes) if "stress" in str(c).lower()),
                len(classes) - 1,
            )
            return round(float(proba[stress_idx]) * 100, 2)
        # 라벨 → float 변환
        label = str(pred[0]).lower()
        return 75.0 if "stress" in label else 25.0
    except Exception:
        pass

    # ── MFCC 기반 폴백 ──
    try:
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=None, duration=5.0)
        mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40)
        feat  = np.mean(mfccs.T, axis=0).reshape(1, -1)
        pred  = _voice_model.predict(feat)
        label = str(pred[0]).lower()
        return 75.0 if "stress" in label else 25.0
    except Exception as e:
        log.warning(f"[VoiceML] 예측 실패: {e}")
        return 0.0


# ════════════════════════════════════════════════════════════════════════
# 6 & 7. 키워드 추출 + keyword-sentence 매핑
# ════════════════════════════════════════════════════════════════════════

# 한국어 불용어 (기본 집합)
_STOPWORDS = {
    "이", "그", "저", "것", "수", "등", "때", "중", "분", "위", "아래",
    "앞", "뒤", "좀", "더", "제", "내", "우리", "저희", "거기", "여기",
}


def extract_keywords_sentences(text: str) -> tuple[list[str], dict[str, str]]:
    """
    환자 발화 텍스트에서 상위 TOP_KEYWORD_COUNT 개 명사 키워드 추출.
    각 키워드에 대해 가장 대표 문장(키워드 포함 + 가장 긴 문장) 1개 매핑.

    Returns
    -------
    keywords : list[str]
    sentences: dict[str, str]  { keyword: sentence }
    """
    if not text.strip():
        return [], {}

    # 문장 분리 (마침표/느낌표/물음표 기준)
    import re
    raw_sentences = re.split(r"[.!?。]", text)
    sentences_clean = [s.strip() for s in raw_sentences if len(s.strip()) > 1]

    # 명사 추출 및 빈도 계산
    nouns = [n for n in _extract_nouns(text) if n not in _STOPWORDS and len(n) >= 2]
    if not nouns:
        return [], {}

    freq = Counter(nouns)
    keywords = [kw for kw, _ in freq.most_common(TOP_KEYWORD_COUNT)]

    # 키워드별 대표 문장 매핑 (키워드 포함 문장 중 가장 긴 것)
    keyword_sentences: dict[str, str] = {}
    for kw in keywords:
        candidates = [s for s in sentences_clean if kw in s]
        if candidates:
            keyword_sentences[kw] = max(candidates, key=len)
        else:
            keyword_sentences[kw] = ""

    return keywords, keyword_sentences


# ════════════════════════════════════════════════════════════════════════
# 백그라운드 처리 태스크 (업로드 → STT → ML → 스트레스 계산)
# ════════════════════════════════════════════════════════════════════════

async def process_chunk(
    audio_bytes:      bytes,
    chunk_start:      datetime,
    hrv_stress:       float,
    pss_score:        float,
    threshold:        float,
    session_id:       str,
) -> None:
    """
    1분 구간 오디오를 백그라운드에서 처리한다.
    hrv_stress 는 이미 계산된 값을 받는다.
    """
    chunk_label = chunk_start.strftime("%H:%M:%S")
    log.info(f"[Chunk {chunk_label}] 처리 시작 (hrv_stress={hrv_stress:.1f})")

    try:
        # ── 2. 스토리지 업로드 ──
        object_key = f"audio/{session_id}/{chunk_label.replace(':','')}.wav"
        audio_url  = await upload_to_naver_storage(audio_bytes, object_key)

        # ── 3. Clova Speech ──
        clova_result = await call_clova_speech(audio_url)

        # ── 4. 환자 발화 추출 ──
        patient_text = extract_patient_utterances(clova_result)
        log.info(f"[Chunk {chunk_label}] 환자 발화: {patient_text[:60]}…")

        # ── 5. 음성 ML ──
        voice_stress = run_voice_ml(patient_text, audio_bytes)
        log.info(f"[Chunk {chunk_label}] 음성 ML 완료 — voice_stress={voice_stress:.1f}")

        # ── 6 & 7. 피크 감지 → 키워드/문장 ──
        is_peak = hrv_stress > threshold
        keywords, sentences = ([], {})
        if is_peak and patient_text:
            keywords, sentences = extract_keywords_sentences(patient_text)
            log.info(f"[Chunk {chunk_label}] 피크 감지 — 키워드: {keywords}")

        # ── stress_main 호출 ──
        result = calculate_stress(
            hrv_stress=hrv_stress,
            voice_stress=voice_stress,
            pss_score=pss_score,
            chunk_start_time=chunk_label,
            keywords=keywords if is_peak else None,
            sentences=sentences if is_peak else None,
        )
        log.info(
            f"[Chunk {chunk_label}] 최종 결과 — "
            f"total={result['total_stress']} "
            f"hrv={result['hrv_stress']} "
            f"voice={result['voice_stress']}"
        )

        # ── Node.js 로 결과 전송 ──
        try:
            requests.post(
                f"{NODE_API}/api/voice-stress",
                json={**result, "session_id": session_id},
                timeout=5,
            )
        except Exception as e:
            log.warning(f"[Chunk {chunk_label}] Node 전송 실패: {e}")

    except Exception as e:
        log.error(f"[Chunk {chunk_label}] 처리 중 오류: {e}", exc_info=True)


# ════════════════════════════════════════════════════════════════════════
# 메인 파이프라인 루프
# ════════════════════════════════════════════════════════════════════════

async def run_pipeline(
    session_id:       str,
    pss_score:        float,
    threshold:        float,
    hrv_stress_queue: asyncio.Queue,
) -> None:
    """
    1분 단위 수집 루프.

    hrv_stress_queue : 외부(hrv_main 또는 코디네이터)에서
                       1분마다 hrv_stress(float) 를 put() 해야 한다.
    pss_score        : 문진 결과 점수 (0~40), 세션 중 고정값.
    threshold        : RMSSD 피크 판단 임계치 (ms 단위 기준 hrv_stress).
    """
    log.info(f"파이프라인 시작 — session={session_id} pss={pss_score} threshold={threshold}")

    latest_hrv_stress = 0.0  # 아직 ML 결과 없을 때 기본값

    while True:
        chunk_start = datetime.now()
        log.info(f"[Chunk {chunk_start.strftime('%H:%M:%S')}] 녹음 시작")

        # ── 1분 녹음 (블로킹 → 스레드풀) ──
        audio_bytes = await record_chunk()
        log.info(f"[Chunk {chunk_start.strftime('%H:%M:%S')}] 녹음 완료 ({RECORD_SECONDS}s)")

        # ── 이번 구간의 hrv_stress 취득 ──
        # hrv_main 이 1분 ML 결과를 Queue 에 put() 했으면 사용, 없으면 마지막 값 유지
        while not hrv_stress_queue.empty():
            latest_hrv_stress = await hrv_stress_queue.get()

        hrv_stress_snapshot = latest_hrv_stress

        # ── 처리를 백그라운드 태스크로 위임 → 즉시 다음 수집 시작 ──
        asyncio.create_task(
            process_chunk(
                audio_bytes=audio_bytes,
                chunk_start=chunk_start,
                hrv_stress=hrv_stress_snapshot,
                pss_score=pss_score,
                threshold=threshold,
                session_id=session_id,
            )
        )
        # 루프는 즉시 다음 1분 수집으로 진행 (딜레이 없음)


# ════════════════════════════════════════════════════════════════════════
# 테스트용 — 로컬 WAV 파일로 파이프라인 실행
# ════════════════════════════════════════════════════════════════════════

async def run_test_audio(
    wav_path:   str,
    session_id: str,
    pss_score:  float,
    threshold:  float,
    hrv_stress: float = 50.0,
) -> None:
    """
    마이크 녹음 대신 로컬 WAV 파일을 읽어 process_chunk() 를 1회 실행한다.

    Parameters
    ----------
    wav_path   : 로컬 WAV 파일 경로
    session_id : 세션 ID 문자열
    pss_score  : PSS 문진 점수 (0~40)
    threshold  : 피크 판단 임계치 (hrv_stress 기준)
    hrv_stress : 테스트용 HRV 스트레스 값 (기본 50.0)
    """
    log.info(f"[Test] WAV 파일 로드: {wav_path}")
    with open(wav_path, "rb") as f:
        audio_bytes = f.read()
    log.info(f"[Test] 파일 크기: {len(audio_bytes):,} bytes")

    await process_chunk(
        audio_bytes=audio_bytes,
        chunk_start=datetime.now(),
        hrv_stress=hrv_stress,
        pss_score=pss_score,
        threshold=threshold,
        session_id=session_id,
    )


# ════════════════════════════════════════════════════════════════════════
# 단독 실행 진입점
# ════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Voice pipeline standalone runner")
    parser.add_argument("--session_id",   default=str(int(datetime.now().timestamp() * 1000)))
    parser.add_argument("--patient_id",   default="P001")
    parser.add_argument("--pss_score",    type=float, default=20.0)
    parser.add_argument("--threshold",    type=float, default=40.0)
    parser.add_argument("--hrv_stress",   type=float, default=50.0,
                        help="테스트 모드 전용 HRV 스트레스 값 (기본 50.0)")
    parser.add_argument("--test_audio",   default=None,
                        help="테스트용 로컬 WAV 파일 경로. 지정 시 마이크 녹음 없이 해당 파일로 pipeline 1회 실행")
    args = parser.parse_args()

    # ── 테스트 모드 ──────────────────────────────────────────────────────
    if args.test_audio:
        log.info(f"[Test 모드] 파일: {args.test_audio}")
        asyncio.run(
            run_test_audio(
                wav_path=args.test_audio,
                session_id=args.session_id,
                pss_score=args.pss_score,
                threshold=args.threshold,
                hrv_stress=args.hrv_stress,
            )
        )
    # ── 일반 실행 모드 ────────────────────────────────────────────────────
    else:
        hrv_q: asyncio.Queue = asyncio.Queue()

        async def _hrv_poller():
            """hrv_main ML 결과를 1분마다 hrv_q 에 push (단독 실행용)."""
            import random
            while True:
                await asyncio.sleep(RECORD_SECONDS)
                mock_hrv = random.uniform(20, 80)
                await hrv_q.put(mock_hrv)
                log.info(f"[HRV poller] hrv_stress={mock_hrv:.1f} → queue")

        async def _main():
            await asyncio.gather(
                run_pipeline(
                    session_id=args.session_id,
                    pss_score=args.pss_score,
                    threshold=args.threshold,
                    hrv_stress_queue=hrv_q,
                ),
                _hrv_poller(),
            )

        asyncio.run(_main())
