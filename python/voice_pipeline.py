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
import os
import queue
import threading
import wave
from pathlib import Path
from collections import Counter
from datetime import datetime

import time

import joblib
import numpy as np
import requests

from dotenv import load_dotenv

from stress_main import calculate_stress

load_dotenv()


# ── 로거 ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("voice_pipeline")

# ── ReturnZero API 키 (.env 에서 로드) ──────────────────────────────────
RTZR_CLIENT_ID     = os.getenv("RTZR_CLIENT_ID",     "[client id]")
RTZR_CLIENT_SECRET = os.getenv("RTZR_CLIENT_SECRET", "[client secret]")
RTZR_BASE_URL      = "https://openapi.vito.ai"

# ── 캘리브레이션: 의사 화자 ID ───────────────────────────────────────────
# calibrate_doctor() 호출 후 설정. None이면 기존 로직(발화 수 기준) 사용.
doctor_speaker_id: int | None = None

# ── 상수 ────────────────────────────────────────────────────────────────
TOP_KEYWORD_COUNT = 5      # 키워드 추출 상위 N개
RECORD_SECONDS    = 60     # 녹음 구간 (초)
SAMPLE_RATE       = 16000  # Hz, mono
NODE_API          = "http://localhost:3001"

# ── 음성 ML 모델 로드 ────────────────────────────────────────────────────
# voice_stress_model.pkl 구조: {"model_name": str, "rf_model": RFRegressor, "kote_labels": list}
# 흐름: 텍스트 → KoTE (44개 감정 확률) → rf_model → 스트레스 점수
try:
    _bundle      = joblib.load(Path(__file__).parent / "voice_stress_model.pkl")
    _rf_model    = _bundle["rf_model"]
    _kote_labels = _bundle["kote_labels"]
    _kote_name   = _bundle["model_name"]
    log.info(f"음성 ML 모델 로드 성공 (KoTE: {_kote_name})")
except Exception as _e:
    _bundle = _rf_model = _kote_labels = _kote_name = None
    log.warning(f"음성 ML 모델 로드 실패: {_e}")

# ── KoTE 파이프라인: 처음 사용 시 로드 (lazy) ────────────────────────────
_kote_pipe = None

def _get_kote_pipe():
    """KoTE 파이프라인을 처음 호출 시에만 로드 (lazy loading)."""
    global _kote_pipe
    if _kote_pipe is not None:
        return _kote_pipe
    if _kote_name is None:
        return None
    try:
        from transformers import pipeline as hf_pipeline
        _kote_pipe = hf_pipeline(
            "text-classification",
            model=_kote_name,
            top_k=None,
        )
        log.info("KoTE 파이프라인 로드 성공")
    except Exception as _e:
        log.warning(f"KoTE 파이프라인 로드 실패: {_e}")
    return _kote_pipe

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

def _record_blocking(duration: int, stop_event: threading.Event) -> bytes:
    """
    동기 함수. sounddevice InputStream 으로 녹음.
    stop_event 가 set 되면 즉시 녹음을 끊고 그때까지 수집된 오디오를 반환.
    정상 흐름(duration 초 경과)에도 동일하게 반환.
    """
    import sounddevice as sd

    frame_queue: queue.Queue = queue.Queue()

    def _callback(indata, *_):
        frame_queue.put(indata.copy())

    frames_list = []
    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
        callback=_callback,
    ):
        # duration 초 또는 stop_event 세트까지 대기
        stop_event.wait(timeout=duration)

    # 스트림 종료 후 큐에 남은 프레임 수집
    while not frame_queue.empty():
        frames_list.append(frame_queue.get_nowait())

    if not frames_list:
        return b""

    audio = np.concatenate(frames_list, axis=0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # int16 = 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())
    return buf.getvalue()


async def record_chunk(stop_event: threading.Event) -> bytes:
    """비동기 래퍼. stop_event 세트 시 현재까지 녹음분을 즉시 반환."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _record_blocking, RECORD_SECONDS, stop_event)


# ════════════════════════════════════════════════════════════════════════
# 2. ReturnZero STT (비동기 — 토큰 발급 → 파일 전송 → 폴링)
# ════════════════════════════════════════════════════════════════════════

# ── JWT 토큰 캐시 (6시간 유효, 만료 30분 전 갱신) ──
_rtzr_token: dict = {}   # {"access_token": str, "expire_at": int}


def _get_rtzr_token() -> str:
    """
    ReturnZero access token 반환.
    캐시가 유효하면 재사용, 만료 임박(30분 이내)이면 재발급.
    """
    if _rtzr_token.get("access_token") and \
            _rtzr_token.get("expire_at", 0) > time.time() + 1800:
        return _rtzr_token["access_token"]

    resp = requests.post(
        f"{RTZR_BASE_URL}/v1/authenticate",
        data={"client_id": RTZR_CLIENT_ID, "client_secret": RTZR_CLIENT_SECRET},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _rtzr_token["access_token"] = data["access_token"]
    _rtzr_token["expire_at"]    = data.get("expire_at", int(time.time()) + 21600)
    log.info("[RTZR] 토큰 발급 완료")
    return _rtzr_token["access_token"]


async def call_rtzr_stt(audio_bytes: bytes) -> dict:
    """
    ReturnZero async STT: WAV bytes 전송 → 폴링 → 결과 반환.
    화자분리(use_diarization=true, spk_count=2) 포함.

    반환: ReturnZero 응답 JSON
      - results.utterances[].msg  : 발화 텍스트
      - results.utterances[].spk  : 화자 ID (int, 0-based)
      - results.utterances[].start_at   : 시작 시각 (ms)
      - results.utterances[].duration   : 길이 (ms)
    """
    loop = asyncio.get_event_loop()

    config = {
        "model_name":             "sommers",
        "language":               "ko",
        "use_diarization":        True,
        "diarization":            {"spk_count": 2},
        "use_itn":                True,
        "use_disfluency_filter":  True,
        "use_profanity_filter":   False,
        "use_paragraph_splitter": False,
        "domain":                 "GENERAL",
    }

    # ── 작업 제출 ──
    def _submit():
        token = _get_rtzr_token()
        resp = requests.post(
            f"{RTZR_BASE_URL}/v1/transcribe",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("audio.wav", audio_bytes, "audio/wav")},
            data={"config": json.dumps(config)},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()

    submit_result = await loop.run_in_executor(None, _submit)
    tid = submit_result.get("id")
    if not tid:
        raise ValueError(f"[RTZR] 작업 제출 실패: {submit_result}")
    log.info(f"[RTZR] 작업 제출 완료 — id={tid}")

    # ── 폴링 (최대 5분, 5초 간격) ──
    def _poll():
        url = f"{RTZR_BASE_URL}/v1/transcribe/{tid}"
        for _ in range(60):
            time.sleep(5)
            token = _get_rtzr_token()
            resp  = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
            resp.raise_for_status()
            data   = resp.json()
            status = data.get("status", "")
            if status == "completed":
                return data
            if status == "failed":
                raise RuntimeError(f"[RTZR] STT 실패 — status={status}")
            log.info(f"[RTZR] 처리 중... status={status}")
        raise TimeoutError("[RTZR] STT 폴링 타임아웃 (5분)")

    result      = await loop.run_in_executor(None, _poll)
    utterances  = result.get("results", {}).get("utterances", [])
    speaker_ids = sorted(set(u["spk"] for u in utterances if u.get("spk") is not None))
    log.info(f"[RTZR] STT 완료 — 발화 수: {len(utterances)}, 화자: {speaker_ids}")
    if utterances:
        log.info(f"[RTZR][DEBUG] utterances[0] 전체: {utterances[0]}")
    return result


# ════════════════════════════════════════════════════════════════════════
# 3-b. 화자 캘리브레이션
# ════════════════════════════════════════════════════════════════════════

async def calibrate_doctor() -> dict:
    """
    의사가 4초간 말하는 동안 녹음 → ReturnZero STT → 첫 발화 spk 값을 doctor_speaker_id에 저장.
    반환:
        {"success": True,  "doctor_spk": int}
        {"success": False, "reason": "no_speech" | "no_audio" | <오류 메시지>}
    """
    global doctor_speaker_id
    log.info("[Calib] 의사 캘리브레이션 녹음 시작 (4초)")

    # 4초 고정 녹음 (stop_event는 절대 set 되지 않는 더미)
    stop_never = threading.Event()
    loop = asyncio.get_event_loop()
    audio_bytes = await loop.run_in_executor(None, _record_blocking, 4, stop_never)

    if not audio_bytes:
        log.warning("[Calib] 오디오 없음")
        return {"success": False, "reason": "no_audio"}

    log.info("[Calib] STT 전송 중...")
    try:
        rtzr_result = await call_rtzr_stt(audio_bytes)
    except Exception as e:
        log.error(f"[Calib] STT 오류: {e}")
        return {"success": False, "reason": str(e)}

    utterances = rtzr_result.get("results", {}).get("utterances", [])
    if not utterances:
        log.warning("[Calib] 발화 없음 → 캘리브레이션 실패")
        return {"success": False, "reason": "no_speech"}

    doctor_speaker_id = utterances[0].get("spk")
    log.info(f"[Calib] 의사 화자 ID 설정 완료 → doctor_speaker_id={doctor_speaker_id}")
    return {"success": True, "doctor_spk": doctor_speaker_id}


def reset_calibration() -> None:
    """캘리브레이션 초기화. 세션 종료 시 호출."""
    global doctor_speaker_id
    doctor_speaker_id = None
    log.info("[Calib] doctor_speaker_id 초기화 완료")


# ════════════════════════════════════════════════════════════════════════
# 4. 환자 발화 추출
# ════════════════════════════════════════════════════════════════════════

def extract_patient_utterances(rtzr_result: dict) -> str:
    """
    ReturnZero STT 결과에서 환자 발화 텍스트 추출.
    - 화자분리: results.utterances[].spk (int, 0-based)
    - 발화 수가 가장 많은 화자 = 환자로 간주
    - 화자 정보 없으면 전체 발화 텍스트 사용
    """
    utterances = rtzr_result.get("results", {}).get("utterances", [])

    # ── spk 필드가 있으면 화자분리 사용 ──
    spk_utts = [u for u in utterances if u.get("spk") is not None]

    if spk_utts:
        spk_counter = Counter(u["spk"] for u in spk_utts)
        unique_spks = list(spk_counter.keys())
        log.info(f"[STT] 화자 분리 완료 — 화자 목록: {unique_spks}, 발화수: {dict(spk_counter)}")

        # 화자별 발화 내용 로그
        for spk in unique_spks:
            spk_text = " ".join(u["msg"] for u in spk_utts if u["spk"] == spk).strip()
            log.info(f"[STT] 화자 {spk} 발화: {spk_text[:120]}")

        if len(unique_spks) >= 2:
            # ── 캘리브레이션 적용: 의사 spk 제외 → 나머지 = 환자 ──
            if doctor_speaker_id is not None:
                patient_text = " ".join(
                    u["msg"] for u in spk_utts if u["spk"] != doctor_speaker_id
                ).strip()
                if patient_text:
                    log.info(
                        f"[STT] 캘리브레이션 기반 추출 — 의사 spk={doctor_speaker_id} 제외"
                        f" ({len([u for u in spk_utts if u['spk'] != doctor_speaker_id])}개 발화)"
                    )
                    return patient_text
                log.warning("[STT] 캘리브레이션 적용 시 환자 발화 없음 → 발화 수 기반 fallback")

            # ── fallback: 발화 수가 가장 많은 화자 = 환자 ──
            patient_spk = spk_counter.most_common(1)[0][0]
            log.info(f"[STT] 환자로 판단된 화자: {patient_spk} (발화 {spk_counter[patient_spk]}개)")
            patient_text = " ".join(
                u["msg"] for u in spk_utts if u["spk"] == patient_spk
            ).strip()
            if patient_text:
                return patient_text

        # 화자 1명 — 전체 발화 사용
        log.info("[STT] 화자 1명 — 전체 발화 텍스트 사용")
        return " ".join(u["msg"] for u in spk_utts).strip()

    # ── spk 정보 없음 → 전체 utterances fallback ──
    fallback = " ".join(u.get("msg", "") for u in utterances)
    log.info(f"[STT] 화자분리 없음 — 전체 발화 fallback ({len(fallback)}자)")
    return fallback.strip()


# ════════════════════════════════════════════════════════════════════════
# 5. 음성 스트레스 ML
# ════════════════════════════════════════════════════════════════════════

def run_voice_ml(patient_text: str) -> float:
    """
    음성 스트레스 ML 모델 실행.
    흐름: 텍스트 → KoTE 44개 감정 확률 → RF Regressor → 스트레스 점수 (0~100)
    텍스트가 없거나 모델 로드 실패 시 0.0 반환.
    반환: 0~100 float
    """
    kote_pipe = _get_kote_pipe()
    if _rf_model is None or kote_pipe is None:
        return 0.0
    if not patient_text.strip():
        return 0.0

    try:
        # ── KoTE: 텍스트 → 44개 감정 확률 ──
        kote_result = kote_pipe(patient_text)[0]   # [{"label": ..., "score": ...}, ...]
        # kote_labels 순서에 맞게 확률 배열 정렬
        score_map = {item["label"]: item["score"] for item in kote_result}
        feat = np.array(
            [score_map.get(label, 0.0) for label in _kote_labels],
            dtype=np.float32,
        ).reshape(1, -1)

        # ── RF Regressor: 감정 확률 → 스트레스 점수 ──
        stress = float(_rf_model.predict(feat)[0])
        # 모델이 0~1 범위로 예측하는 경우 0~100으로 스케일링
        if stress <= 1.0:
            stress = stress * 100.0
        stress = max(0.0, min(100.0, stress))   # 0~100 클리핑
        return round(stress, 2)

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


def build_sentence_mapping(keywords: list, text: str) -> dict:
    """
    주어진 키워드 목록에 대해 text에서 대표 문장(키워드 포함 + 가장 긴 것)을 찾아 반환.

    Parameters
    ----------
    keywords : 키워드 문자열 리스트
    text     : 전체 발화 텍스트

    Returns
    -------
    dict[str, str]  { keyword: 대표_문장 }
    """
    import re
    raw_sents    = re.split(r"[.!?。]", text)
    sents_clean  = [s.strip() for s in raw_sents if len(s.strip()) > 1]
    result: dict = {}
    for kw in keywords:
        candidates     = [s for s in sents_clean if kw in s]
        result[kw]     = max(candidates, key=len) if candidates else ""
    return result


def extract_keywords_sentences(text: str) -> tuple:
    """
    환자 발화 텍스트에서 상위 TOP_KEYWORD_COUNT 개 명사 키워드 추출 (kiwipiepy 폴백).
    각 키워드에 대해 대표 문장 1개 매핑.

    Returns
    -------
    keywords : list[str]
    sentences: dict[str, str]  { keyword: sentence }
    """
    if not text.strip():
        return [], {}

    # 명사 추출 및 빈도 계산
    nouns = [n for n in _extract_nouns(text) if n not in _STOPWORDS and len(n) >= 2]
    if not nouns:
        return [], {}

    freq     = Counter(nouns)
    keywords = [kw for kw, _ in freq.most_common(TOP_KEYWORD_COUNT)]
    return keywords, build_sentence_mapping(keywords, text)


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
        # ── 2 & 3. ReturnZero STT (화자분리 포함) ──
        rtzr_result = await call_rtzr_stt(audio_bytes)

        # ── 4. 환자 발화 추출 (utterances[].spk 기반 화자분리) ──
        patient_text = extract_patient_utterances(rtzr_result)
        log.info(f"[Chunk {chunk_label}] 환자 발화 ({len(patient_text)}자): {patient_text[:80]}...")

        # ── 5. 음성 스트레스 (KoTE ML) ──
        voice_stress = run_voice_ml(patient_text)
        log.info(f"[Chunk {chunk_label}] KoTE ML voice_stress={voice_stress:.1f}")

        # ── 6 & 7. 피크 감지 → 키워드 + 상황 요약 (kiwipiepy) ──
        is_peak = hrv_stress > threshold
        log.info(
            f"[Chunk {chunk_label}] 피크 판단 — "
            f"hrv_stress={hrv_stress:.1f} > threshold={threshold:.1f} → is_peak={is_peak}"
        )
        keywords: list  = []
        sentences: dict = {}

        if is_peak and patient_text:
            keywords, sentences = extract_keywords_sentences(patient_text)
            log.info(f"[Chunk {chunk_label}] 키워드 {len(keywords)}개: {keywords}")
            log.info(f"[Chunk {chunk_label}] 상황 요약: { {k: v[:30] for k, v in sentences.items()} }")
        elif is_peak and not patient_text:
            log.warning(f"[Chunk {chunk_label}] 피크이지만 발화 텍스트 없음 → 키워드 없음")
        else:
            log.info(f"[Chunk {chunk_label}] 피크 아님 → 키워드 추출 생략")

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

        # ── 청크 요약: 피크 구간 대표 문장 추출 ──
        chunk_summary = ""
        if is_peak and sentences:
            # sentences 값(대표 문장)에서 중복 제거, 빈 문장 제외
            unique_sents = list(dict.fromkeys(s for s in sentences.values() if s.strip()))
            chunk_summary = "\n".join(unique_sents)
            log.info(f"[Chunk {chunk_label}] 청크 요약 {len(unique_sents)}문장 생성")

        # ── Node.js 로 결과 전송 ──
        try:
            requests.post(
                f"{NODE_API}/api/voice-stress",
                json={
                    **result,
                    "session_id":    session_id,
                    "chunk_summary": chunk_summary,  # 피크 구간 대표 문장 요약
                },
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
    threshold_ref:    list,           # [threshold_value] — 실시간 변경 가능한 mutable 참조
    hrv_stress_queue: asyncio.Queue,
    stop_event:       threading.Event,  # 진단 완료 시 세트 → 현재 녹음 즉시 종료 후 STT 제출
) -> None:
    """
    1분 단위 수집 루프.

    stop_event       : stop-voice 호출 시 set() → 현재 녹음을 즉시 끊고
                       그때까지 수집된 오디오를 STT 에 제출한 뒤 루프 종료.
    hrv_stress_queue : 외부에서 1분마다 hrv_stress(float) 를 put() 해야 한다.
    pss_score        : 문진 결과 점수 (0~40), 세션 중 고정값.
    threshold_ref    : [임계치] — PSS 제출 시 외부에서 값을 변경하면 즉시 반영.
    """
    log.info(f"파이프라인 시작 — session={session_id} pss={pss_score} threshold={threshold_ref[0]}")

    latest_hrv_stress = 0.0  # 아직 ML 결과 없을 때 기본값

    while True:
        chunk_start = datetime.now()
        log.info(f"[Chunk {chunk_start.strftime('%H:%M:%S')}] 녹음 시작 (threshold={threshold_ref[0]})")

        # ── 녹음 (stop_event 세트 시 즉시 종료, 그때까지의 오디오 반환) ──
        audio_bytes = await record_chunk(stop_event)
        duration_s  = len(audio_bytes) / (SAMPLE_RATE * 2) if audio_bytes else 0
        log.info(f"[Chunk {chunk_start.strftime('%H:%M:%S')}] 녹음 완료 ({duration_s:.1f}s)")

        # ── 이번 구간의 hrv_stress 취득 ──
        while not hrv_stress_queue.empty():
            latest_hrv_stress = await hrv_stress_queue.get()
        hrv_stress_snapshot = latest_hrv_stress

        # ── 녹음 데이터가 있으면 백그라운드 처리 위임 ──
        if audio_bytes:
            asyncio.create_task(
                process_chunk(
                    audio_bytes=audio_bytes,
                    chunk_start=chunk_start,
                    hrv_stress=hrv_stress_snapshot,
                    pss_score=pss_score,
                    threshold=threshold_ref[0],
                    session_id=session_id,
                )
            )
        else:
            log.warning(f"[Chunk {chunk_start.strftime('%H:%M:%S')}] 녹음 데이터 없음 → 건너뜀")

        # ── 중단 신호가 세트됐으면 루프 종료 ──
        if stop_event.is_set():
            log.info("[Voice] stop_event 감지 → 파이프라인 종료 (마지막 청크는 백그라운드 처리 중)")
            break


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
    parser.add_argument("--test_audio",   default=r"C:\Users\SMHRD\Downloads\업무처리\쇼핑_25.m4a",
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
                    threshold_ref=[args.threshold],
                    hrv_stress_queue=hrv_q,
                    stop_event=threading.Event(),  # 단독 실행: 외부 중단 신호 없음
                ),
                _hrv_poller(),
            )

        asyncio.run(_main())
