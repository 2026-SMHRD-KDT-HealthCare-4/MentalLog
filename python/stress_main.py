"""
stress_main.py — HRV + 음성 + PSS 가중 합산 스트레스 계산 모듈
호출 방법: from stress_main import calculate_stress
"""

# ── 가중치 ──────────────────────────────────────────────────────────────
HRV_WEIGHT   = 0.486   # HRV(RMSSD 기반 ML) 48.6%
VOICE_WEIGHT = 0.333   # 음성 ML             33.3%
PSS_WEIGHT   = 0.181   # 문진(PSS 0~40)      18.1%


def calculate_stress(
    hrv_stress:       float,
    voice_stress:     float,
    pss_score:        float,
    chunk_start_time: str,
    keywords:         list  | None = None,
    sentences:        dict  | None = None,
) -> dict:
    """
    매 1분 구간의 통합 스트레스 지수를 계산한다.

    Parameters
    ----------
    hrv_stress       : HRV ML 결과 (0~100)
    voice_stress     : 음성 ML 결과 (0~100)
    pss_score        : PSS 문진 점수 (0~40)
    chunk_start_time : 해당 구간 시작 시각 문자열 (HH:MM:SS)
    keywords         : 피크 구간 키워드 리스트 (피크가 아닐 땐 None)
    sentences        : 키워드 → 핵심 문장 매핑 딕셔너리 (피크가 아닐 땐 None)

    Returns
    -------
    dict with keys:
        total_stress, chunk_start_time, hrv_stress, voice_stress,
        keywords, sentences
    """
    pss_norm     = (pss_score / 40.0) * 100.0
    total_stress = (
        hrv_stress   * HRV_WEIGHT +
        voice_stress * VOICE_WEIGHT +
        pss_norm     * PSS_WEIGHT
    )

    return {
        "total_stress":      round(total_stress, 2),
        "chunk_start_time":  chunk_start_time,
        "hrv_stress":        round(hrv_stress,   2),
        "voice_stress":      round(voice_stress, 2),
        "keywords":          keywords  or [],
        "sentences":         sentences or {},
    }


# ── 단독 실행용 테스트 ───────────────────────────────────────────────────
if __name__ == "__main__":
    import json
    result = calculate_stress(
        hrv_stress=70.0,
        voice_stress=55.0,
        pss_score=28.0,
        chunk_start_time="12:34:00",
        keywords=["가족", "돈"],
        sentences={"가족": "가족 때문에 많이 힘들어요.", "돈": "돈 걱정이 너무 됩니다."},
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
