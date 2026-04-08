import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import axios from 'axios'
import '../styles/monitor.css'
import { circleClass } from '../utils/stressUtils'

const API = 'http://localhost:3001'
const PYTHON_API = 'http://localhost:8000'

// 가중치 파라미터
const WEIGHTS = {
  hrv:   0.486,  // 심전도(HRV) 48.6%
  voice: 0.333,  // 음성(Voice) 33.3%
  pss:   0.181,  // 문진(PSS)   18.1%
}

// 가중 합산 스트레스 계산 (분당 호출)
// hrv: 0~100, voice: 0~100, pss: 0~40 → 정규화 후 가중합
function calcTotalStress(hrv, voice, pss) {
  const pssNorm = (pss / 40) * 100
  return Math.round(hrv * WEIGHTS.hrv + voice * WEIGHTS.voice + pssNorm * WEIGHTS.pss)
}

// 툴팁
const GraphTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'white', border: '1px solid #DDD', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
      <div style={{ color: '#888', marginBottom: 2 }}>데이터포인트 {label}</div>
      <div style={{ fontWeight: 700, color: '#333' }}>RMSSD: {payload[0].value} ms</div>
    </div>
  )
}

// 샘플 대기 환자 목록
const WAITING_PATIENTS = [
  { pat_id: 'P001', pat_name: '김망나뇽', age: 42, gender: '남', visit_count: 3, has_questionnaire: true },
  { pat_id: 'P002', pat_name: '박망나뇽', age: 100, gender: '남', visit_count: 3, has_questionnaire: true },
  { pat_id: 'P003', pat_name: '최망나뇽', age: 132, gender: '여', visit_count: 1, has_questionnaire: false },
  { pat_id: 'P004', pat_name: '조망나뇽', age: 102, gender: '남', visit_count: 2, has_questionnaire: false },
  { pat_id: 'P005', pat_name: '양망나뇽', age: 98, gender: '여', visit_count: 1, has_questionnaire: false },
]


const SAMPLE_KEYWORDS = [
  { id: 1, word: '가족', time: '12:35:24', content: "가족들이 뭐 대화도 안되고 머 그래서 힘들어요 → 동의 문장 그런거 출력" },
  { id: 2, word: '다리', time: '12:38:14', content: "다리가 계속 저리고 아파요. 잠을 못자서 그런 것 같아요." },
  { id: 3, word: '돈',   time: '12:40:24', content: "돈 걱정이 많아요. 요즘 생활비가 너무 부족해서요." },
  { id: 4, word: '얼굴', time: '12:52:12', content: "얼굴이 자꾸 붉어지고 두근거려요. 불안할 때마다 그래요." },
  { id: 5, word: '성적', time: '12:53:58', content: "성적이 떨어질까봐 너무 불안해요. 공부를 해도 머릿속에 안 들어와요." },
  { id: 6, word: '연애', time: '12:56:32', content: "연애 때문에 스트레스를 많이 받고 있어요. 감정 조절이 안 돼요." },
]

const Monitor = () => {
  const { patientId } = useParams()
  const navigate = useNavigate()

  // 환자 정보
  const [patient, setPatient] = useState(null)
  const [currentPatientIdx, setCurrentPatientIdx] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)

  // RMSSD 데이터
  const [sessionActive, setSessionActive] = useState(true)
  const sessionIdRef = useRef(Date.now())   // 세션 ID (BIGINT, DB session_id)
  const lastHrvStressRef = useRef(0)        // 마지막 ML HRV 스트레스값 보관 (PSS 즉시 반영용)
  const pssScoreRef = useRef(0)             // pssScore ref (폴링 클로저 stale 방지)

  // RMSSD 차트 데이터 (Python API)
  const [rmssdData, setRmssdData] = useState([])

  // 1분 베이스라인
  const [baselineRmssd, setBaselineRmssd] = useState(null)
  const [baselineReady, setBaselineReady] = useState(false)

  // PSS 입력
  const [pssInput, setPssInput] = useState('')
  const [pssSubmitted, setPssSubmitted] = useState(false)

  // 스트레스 지수
  const [threshold, setThreshold] = useState(null) // RMSSD 기반 임계치 (ms)
  const voiceStress = 0                             // 음성 스트레스 placeholder (0~100)
  const [hrv, setHrv] = useState(52)
  const [hr, setHr] = useState(72)

  // 분당 총합 스트레스
  const [totalStress, setTotalStress] = useState(null)   // 분당 평균 (평균 원형)
  const [peakStress, setPeakStress] = useState(null)     // 세션 최고치 (최고 원형)

  // 과거 처방 내역
  const [prescriptions, setPrescriptions] = useState([])

  // 키워드
  const [keywords, setKeywords] = useState(SAMPLE_KEYWORDS)
  const [selectedKw, setSelectedKw] = useState(null)
  const [isSaved, setIsSaved] = useState(false)

  // 의사 소견
  const [notes, setNotes] = useState('')

  // ── 환자 입실 시 베이스라인 리셋 + 새 세션 ID 생성 ──
  useEffect(() => {
    axios.post(`${PYTHON_API}/reset-baseline`).catch(() => {})
    sessionIdRef.current = Date.now()
    setBaselineRmssd(null)
    setBaselineReady(false)
  }, [patientId])

  // ── 환자 로드 ──
  useEffect(() => {
    const idx = WAITING_PATIENTS.findIndex(p => p.pat_id === patientId)
    if (idx !== -1) setCurrentPatientIdx(idx)
    const p = WAITING_PATIENTS.find(p => p.pat_id === patientId) || WAITING_PATIENTS[0]

    const fallbackPatient = {
      pat_id: p.pat_id, pat_name: p.pat_name,
      birth_date: null, gender: p.gender,
      med_history: null,
    }

    Promise.all([
      axios.get(`${API}/api/patients/${p.pat_id}`).catch(() => ({ data: null })),
      axios.get(`${API}/api/notes/${p.pat_id}`).catch(() => ({ data: null })),
      axios.get(`${API}/api/questionnaire/${p.pat_id}`).catch(() => ({ data: null })),
      axios.get(`${API}/api/history/${p.pat_id}`).catch(() => ({ data: [] })),
    ]).then(async ([patRes, notesRes, qRes, histRes]) => {
      const patData = patRes.data || fallbackPatient
      setPatient(patData)

      // 페이지 진입 시 환자 upsert (세션 저장 전에 반드시 존재해야 함)
      const doctor = JSON.parse(sessionStorage.getItem('doctor') || '{}')
      await axios.post(`${API}/api/patients`, {
        pat_id:      patData.pat_id,
        pat_name:    patData.pat_name,
        gender:      patData.gender      || null,
        birth_date:  patData.birth_date  || null,
        med_history: patData.med_history || null,
      }).catch(e => console.error('환자 upsert 실패:', e?.response?.data || e?.message))

      const visits = histRes.data || []
      setPrescriptions(visits.map(v => ({
        note_id:  v.visit_id,
        date:     v.visit_date,
        content:  v.notes || '',
        stress:   v.stress_total,
      })))
      if (notesRes.data?.notes) setNotes(notesRes.data.notes)
      if (qRes.data) {
        pssScoreRef.current = qRes.data.stress_score || 0
        setThreshold(qRes.data.threshold || 70)
      }
    })
  }, [patientId])

  // ── Python API 폴링 (RMSSD 차트 + ML 동그라미) ──
  useEffect(() => {
    if (!sessionActive) return
    const interval = setInterval(async () => {
      const now = new Date()
      try {
        const res = await axios.post(`${PYTHON_API}/generate-metrics`, {
          hour: now.getHours(),
          minute: now.getMinutes(),
          second: now.getSeconds(),
          data_points: 1,
          pat_id: patient?.pat_id,
          session_id: sessionIdRef.current,
        })
        const data = res.data

        if (data.realtime_rmssd && Array.isArray(data.realtime_rmssd)) {
          setRmssdData(prev => {
            const startX = prev.length
            const newPoints = data.realtime_rmssd.map((v, i) => ({
              x: startX + i,
              value: Math.round(v * 100) / 100,
            }))
            const next = [...prev, ...newPoints]
            return next.length > 100 ? next.slice(-100) : next
          })
          // HRV 박스: 최신 RMSSD 값으로 실시간 갱신
          const latestRmssd = data.realtime_rmssd[data.realtime_rmssd.length - 1]
          if (latestRmssd != null) setHrv(Math.round(latestRmssd))
        }

        // 1분 베이스라인 수신
        if (data.baseline_ready && data.baseline_rmssd && !baselineReady) {
          setBaselineRmssd(data.baseline_rmssd)
          setBaselineReady(true)
        }

        // 분당 총합 스트레스 갱신 + HR 박스 업데이트
        if (data.ml_triggered && data.ml_result) {
          if (data.ml_result.hr_mean != null)
            setHr(Math.round(data.ml_result.hr_mean))

          if (data.ml_result.ml_prediction != null) {
            const hrvStress = Math.max(0, Math.min(100, data.ml_result.ml_prediction))
            lastHrvStressRef.current = hrvStress
            const total = calcTotalStress(hrvStress, voiceStress, pssScoreRef.current)
            setTotalStress(total)
            setPeakStress(prev => (prev === null || total > prev) ? total : prev)
          }
        }
      } catch (e) {}
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionActive])


  // ── PSS 임계치 계산 + 즉시 원형 반영 ──
  const handlePssSubmit = () => {
    const pss = Number(pssInput)
    if (pss < 0 || pss > 40 || !baselineRmssd) return
    const margin = 0.439 - (pss / 40) * 0.291
    const newThreshold = Math.round(baselineRmssd * (1 - margin) * 10) / 10
    setThreshold(newThreshold)
    pssScoreRef.current = pss
    setPssSubmitted(true)
    // 마지막 HRV 스트레스값 + 새 PSS로 즉시 총합 계산
    const total = calcTotalStress(lastHrvStressRef.current, voiceStress, pss)
    setTotalStress(total)
    setPeakStress(prev => (prev === null || total > prev) ? total : prev)
  }

  // ── 환자 전환 ──
  const goPrev = () => {
    const idx = Math.max(0, currentPatientIdx - 1)
    setCurrentPatientIdx(idx)
    navigate(`/monitor/${WAITING_PATIENTS[idx].pat_id}`)
  }
  const goNext = () => {
    const idx = Math.min(WAITING_PATIENTS.length - 1, currentPatientIdx + 1)
    setCurrentPatientIdx(idx)
    navigate(`/monitor/${WAITING_PATIENTS[idx].pat_id}`)
  }
  const goToPatient = (p, i) => {
    setCurrentPatientIdx(i)
    setShowDropdown(false)
    navigate(`/monitor/${p.pat_id}`)
  }

  // 현재 RMSSD (차트 최신값), 임계치 초과 여부 (RMSSD < threshold → 스트레스 과다)
  const currentRmssd = rmssdData.length > 0 ? rmssdData[rmssdData.length - 1].value : null
  const isOverThreshold = pssSubmitted && threshold !== null && currentRmssd !== null && currentRmssd < threshold

  // ── 저장 ──
  const handleSave = async () => {
    const timestamp = new Date().toLocaleString('ko-KR')
    const savedNote = `${notes}\n\n저장완료입니다 ✓\n${timestamp}`
    setNotes(savedNote)
    setIsSaved(true)
    try {
      await axios.post(`${API}/api/notes`, {
        session_id:   sessionIdRef.current,
        pat_id:       patient?.pat_id,
        notes,
        stress_total: totalStress ?? 0,
        stress_peak:  peakStress  ?? 0,
      })
      // 저장 후 처방 내역 갱신
      const histRes = await axios.get(`${API}/api/history/${patient?.pat_id}`).catch(() => ({ data: [] }))
      const visits = histRes.data || []
      setPrescriptions(visits.map(v => ({
        note_id: v.visit_id,
        date:    v.visit_date,
        content: v.notes || '',
        stress:  v.stress_total,
      })))
    } catch (e) {
      console.error('저장 실패:', e?.response?.data || e?.message || e)
      alert(`저장 실패: ${e?.response?.data?.detail || e?.response?.data?.error || e?.message || '알 수 없는 오류'}`)
    }
  }

  // ── 진단 완료 → 레포트 ──
  const handleComplete = async () => {
    await handleSave()
    navigate(`/report/${patient?.pat_id}`, {
      state: {
        patient,
        notes,
        totalStress: totalStress ?? 0,
        peakStress:  peakStress  ?? 0,
        threshold:   threshold   ?? 0,
      }
    })
  }

  const currentPatient = WAITING_PATIENTS[currentPatientIdx]

  return (
    <div className="monitor-root" onClick={() => showDropdown && setShowDropdown(false)}>
      {/* ── 네비게이션 바 ── */}
      <nav className="monitor-navbar">
        <div className="nav-controls">
          <button className="nav-icon-btn" onClick={() => navigate('/schedule')}>←</button>
          <button className="nav-icon-btn" onClick={() => window.location.reload()}>↺</button>
          <span
            style={{ fontSize: 13, color: '#888', marginLeft: 4, fontFamily: 'Georgia, serif', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => navigate('/schedule')}
          >M</span>
        </div>

        {/* << 환자명 >> */}
        <div className="nav-patient-nav" onClick={e => e.stopPropagation()}>
          <button className="nav-arrow-btn" onClick={goPrev}>&lt;&lt;</button>
          <button className="nav-patient-name-btn" onClick={() => setShowDropdown(v => !v)}>
            {currentPatient?.pat_name || patient?.pat_name || '...'}
          </button>
          <button className="nav-arrow-btn" onClick={goNext}>&gt;&gt;</button>

          {showDropdown && (
            <div className="patient-dropdown">
              {WAITING_PATIENTS.map((p, i) => (
                <div
                  key={p.pat_id}
                  className={`patient-dropdown-item ${i === currentPatientIdx ? 'current' : ''}`}
                  onClick={() => goToPatient(p, i)}
                >
                  <span>{p.pat_name}</span>
                  <span style={{ fontSize: 11, color: '#AAA' }}>
                    {p.age}세 / {p.gender} / 문진 {p.has_questionnaire ? 'O' : 'X'} / {p.visit_count}회차
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="nav-user-area" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
          <span className="nav-user-label">User</span>
          <button className="nav-user-btn">
            {(() => { const d = JSON.parse(sessionStorage.getItem('doctor') || '{}'); return d.doc_name?.[0] || '의' })()}
          </button>
        </div>
      </nav>

      {/* ── 바디 ── */}
      <div className="monitor-body">
        {/* 상단: 환자 패널 + 그래프 */}
        <div className="monitor-top">
          {/* 좌측 패널 */}
          <div className="left-panel">
            {/* 환자 정보 */}
            <div className="patient-info-section">
              <div className="patient-title">
                환자 : {patient?.pat_name || '...'}
              </div>
              <div className="patient-sub">
                Age: {patient?.birth_date
                  ? `${new Date().getFullYear() - new Date(patient.birth_date).getFullYear()}세`
                  : '–'} / {patient?.gender} / 환자번호 {patient?.pat_id}
              </div>

              {/* 베이스라인 상태 (항상 표시) */}
              <div className={`baseline-status ${baselineReady ? 'ready' : 'measuring'}`}>
                {baselineReady
                  ? `✓ 베이스라인 완료: ${baselineRmssd} ms`
                  : '⏳ 베이스라인 측정 중 (1분)...'}
              </div>

              {/* PSS 입력 (제출 전) */}
              {!pssSubmitted ? (
                <div className="pss-input-section">
                  <span className="pss-label">PSS 점수 (0~40)</span>
                  <div className="pss-row">
                    <input
                      type="number" min="0" max="40"
                      value={pssInput}
                      onChange={e => setPssInput(e.target.value)}
                      placeholder="0~40"
                      className="pss-input"
                    />
                    <button
                      className="pss-btn"
                      onClick={handlePssSubmit}
                      disabled={!baselineReady || pssInput === ''}
                    >
                      임계치 설정
                    </button>
                  </div>
                  {!baselineReady && (
                    <div className="pss-hint">베이스라인 완료 후 임계치 설정 가능합니다</div>
                  )}
                </div>
              ) : (
                /* PSS 제출 결과 */
                <div className="pss-result">
                  PSS {pssInput}점 → 임계치 {threshold} ms
                </div>
              )}
            </div>

            {/* 스트레스 원형 3개 */}
            <div className="stress-circles-section">
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${totalStress !== null ? circleClass(totalStress) : 'c-green'}`}>
                  <span className="num">{totalStress ?? '–'}</span>
                </div>
                <span className="stress-circle-label">평균</span>
              </div>
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${peakStress !== null ? circleClass(peakStress) : 'c-green'}`}>
                  <span className="num">{peakStress ?? '–'}</span>
                </div>
                <span className="stress-circle-label">최고</span>
              </div>
              <div className="stress-circle-item">
                <div className={`stress-circle-ring c-orange`}>
                  <span className="num">{threshold ?? '–'}</span>
                </div>
                <span className="stress-circle-label">임계치</span>
              </div>
            </div>

            {/* 추세 */}
            <div className="trend-section">
              <span style={{ fontWeight: 600, color: '#555' }}>W추세</span>
              <span className={`trend-badge ${peakStress > threshold ? 'up' : 'down'}`}>
                {peakStress > threshold ? '▲' : '▼'}
              </span>
              지난 주에 비하여 n % {peakStress > threshold ? '상승' : '하강'}
            </div>

            {/* 키워드 분석 */}
            <div className="keywords-section">
              {selectedKw ? (
                /* 키워드 선택 시: 상세 내용 */
                <>
                  <div className="keywords-section-header">
                    <span>{selectedKw.word} &nbsp; 키워드 분석</span>
                    <button
                      style={{ fontSize: 11, background: 'none', border: 'none', color: '#4A90D9', cursor: 'pointer' }}
                      onClick={() => setSelectedKw(null)}
                    >
                      ← 목록
                    </button>
                  </div>
                  <div className="keyword-detail">
                    <div className="keyword-detail-content">{selectedKw.content}</div>
                    <div className="keyword-detail-time">{'{' + selectedKw.time + '}'}</div>
                  </div>
                </>
              ) : (
                /* 기본: 키워드 목록 */
                <>
                  <div className="keywords-section-header">
                    <span>{isSaved ? '주요 키워드' : '실시간 키워드 분석'}</span>
                    {isOverThreshold && (
                      <span style={{ fontSize: 10, color: '#E07800', background: '#FFF3E0', padding: '1px 6px', borderRadius: 3, border: '1px solid #FFD180' }}>
                        임계치 초과
                      </span>
                    )}
                  </div>
                  {keywords.length === 0 ? (
                    <div className="empty-state">세션 중 키워드가 추출되면 표시됩니다</div>
                  ) : (
                    <div className="keyword-grid">
                      {keywords.map(kw => (
                        <div
                          key={kw.id}
                          className={`kw-chip ${selectedKw?.id === kw.id ? 'selected' : ''}`}
                          onClick={() => setSelectedKw(kw)}
                        >
                          <span className="kw-word">{kw.word}</span>
                          {!isSaved && <span className="kw-time">{kw.time}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 그래프 패널 */}
          <div className="graph-panel">
            <div className="graph-panel-header">
              <div className="graph-title-group">
                <h3>RMSSD 그래프</h3>
                <p>실시간 환자 스트레스 수치 모니터링</p>
              </div>
              <div className="hrv-hr-box">
                <div className="hrv-hr-labels">
                  <span>HRV</span>
                  <span>HR</span>
                </div>
                <div className="hrv-hr-values">
                  <span>{hrv}</span>
                  <span>{hr}</span>
                </div>
              </div>
            </div>

            <div className="graph-area">
              {rmssdData.length === 0 ? (
                <div className="empty-state" style={{ paddingTop: 60 }}>
                  데이터 수신 대기 중...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rmssdData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#F0F0F0" vertical={false} />
                    <XAxis
                      dataKey="x"
                      tick={{ fill: '#BBB', fontSize: 10 }}
                      tickLine={false}
                      axisLine={{ stroke: '#EEE' }}
                      interval={Math.max(0, Math.floor(rmssdData.length / 10) - 1)}
                    />
                    <YAxis
                      domain={[0, 65]}
                      ticks={[0, 15, 30, 45, 60]}
                      tick={{ fill: '#BBB', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<GraphTooltip />} />
                    {/* 임계치 기준선 (빨간 가로선) - RMSSD ms 단위 */}
                    {threshold !== null && (
                      <ReferenceLine
                        y={threshold}
                        stroke="#E53935"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        label={{ value: `임계치 ${threshold}ms`, position: 'insideTopRight', fontSize: 10, fill: '#E53935' }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#333333"
                      strokeWidth={1.8}
                      dot={false}
                      activeDot={{ r: 4, fill: '#333', stroke: 'white', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* 하단: 의사 소견 + 과거 처방 내용 */}
        <div className="monitor-bottom">
          {/* 의사 소견 */}
          <div className="notes-panel">
            <div className="panel-header">
              <span className="panel-title">의사 소견</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`save-btn ${isSaved ? 'saved' : ''}`}
                  onClick={handleSave}
                  disabled={isSaved}
                >
                  {isSaved ? '저장 완료' : '저장'}
                </button>
                <button
                  className="save-btn"
                  style={{ background: '#4A90D9' }}
                  onClick={handleComplete}
                >
                  진단 완료
                </button>
              </div>
            </div>
            <textarea
              className={`notes-textarea ${isSaved ? 'saved-mode' : ''}`}
              placeholder="의사의 소견을 입력하세요..."
              value={notes}
              onChange={e => { setNotes(e.target.value); setIsSaved(false) }}
            />
          </div>

          {/* 과거 처방 내용 */}
          <div className="prescription-panel">
            <div className="panel-header">
              <span className="panel-title">과거 처방 내용</span>
            </div>
            <div className="prescription-list">
              {prescriptions.length === 0 ? (
                <div className="empty-state">저장된 처방 내역이 없습니다</div>
              ) : prescriptions.map((rx, i) => (
                <div
                  className="prescription-row"
                  key={i}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/report/${patient?.pat_id}?noteId=${rx.note_id}`)}
                >
                  <span className="prescription-date">{rx.date}</span>
                  <span className="prescription-content" style={{ whiteSpace: 'pre-line' }}>
                    {rx.content || '(소견 없음)'}
                  </span>
                  {rx.stress != null && (
                    <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      스트레스 {rx.stress}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Monitor
