import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'
const PYTHON_API = 'http://localhost:8000'

// ── 원형 색상 ──
function circleClass(val) {
  if (val < 40) return 'c-green'
  if (val < 60) return 'c-yellow'
  if (val < 75) return 'c-orange'
  return 'c-red'
}

// RMSSD → 스트레스 변환
function rmssdToStress(rmssd) {
  const c = Math.max(5, Math.min(100, rmssd))
  return Math.round(100 - ((c - 5) / 95) * 100)
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

const SAMPLE_PRESCRIPTIONS = [
  {
    date: '2026/03/01',
    content: "스트레스 지수 높음\n'가족'이라는 키워드는 높아보임\n다음에 다시 한번 이야기 해보기",
  },
  {
    date: '2026/02/04',
    content: "너무 걱정되어있음\n눈에 다른 곳을 보고 있음\n스트레스 지수 높음",
    compare: true,
  },
  {
    date: '2026/01/01',
    content: "괜찮은것같음\n스트레스 지수 낮음",
  },
  {
    date: '2025/12/26',
    content: "오늘 하루 이했습니다. 성 생명 뿔리뿔리\n준경이 보임\n극 처방이 필요합동 등\n스트레스 지수 중간",
  },
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
  const [currentRmssd, setCurrentRmssd] = useState(45)
  const [sessionActive, setSessionActive] = useState(true)
  const rmssdRef = useRef(null)
  const baseRef = useRef(45)

  // RMSSD 차트 데이터 (Python API)
  const [rmssdData, setRmssdData] = useState([])

  // ML 결과 (동그라미 업데이트용)
  const [mlHrMean, setMlHrMean] = useState(null)
  const [mlHrMax, setMlHrMax] = useState(null)

  // 스트레스 지수
  const [avgStress, setAvgStress] = useState(38)
  const [peakStress, setPeakStress] = useState(82)
  const [threshold, setThreshold] = useState(70)
  const [hrv, setHrv] = useState(52)
  const [hr, setHr] = useState(72)

  // 키워드
  const [keywords, setKeywords] = useState(SAMPLE_KEYWORDS)
  const [selectedKw, setSelectedKw] = useState(null)
  const [isSaved, setIsSaved] = useState(false)

  // 의사 소견
  const [notes, setNotes] = useState('')

  // ── 환자 로드 ──
  useEffect(() => {
    const idx = WAITING_PATIENTS.findIndex(p => p.pat_id === patientId)
    if (idx !== -1) setCurrentPatientIdx(idx)
    const p = WAITING_PATIENTS.find(p => p.pat_id === patientId) || WAITING_PATIENTS[0]

    axios.get(`${API}/api/patients/${p.pat_id}`)
      .then(res => setPatient(res.data))
      .catch(() => setPatient({
        pat_id: p.pat_id,
        pat_name: p.pat_name,
        pat_birth: '1982-05-14',
        pat_gender: p.gender,
        pat_phone: '010-1234-5678',
        diagnosis: '범불안장애(GAD)',
      }))

    // 소견 불러오기
    axios.get(`${API}/api/notes/${p.pat_id}`)
      .then(res => { if (res.data?.notes) setNotes(res.data.notes) })
      .catch(() => {})
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
          data_points: 10,
          pat_id: patient?.pat_id,
          session_id: `${patient?.pat_id}_${now.toISOString().slice(0, 10)}`,
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
        }

        if (data.ml_triggered && data.ml_result) {
          setMlHrMean(Math.round(data.ml_result.hr_mean))
          setMlHrMax(Math.round(data.ml_result.hr_max))
        }
      } catch (e) {}
    }, 2000)
    return () => clearInterval(interval)
  }, [sessionActive])

  // ── RMSSD 시뮬레이션 ──
  useEffect(() => {
    if (!sessionActive) return
    rmssdRef.current = setInterval(() => {
      baseRef.current = Math.max(15, Math.min(80, baseRef.current + (Math.random() - 0.5) * 7))
      const val = Math.round(baseRef.current * 10) / 10
      setCurrentRmssd(val)
      setHrv(Math.round(val))
      setHr(prev => Math.max(60, Math.min(120, prev + Math.round((Math.random() - 0.5) * 3))))
      const stress = rmssdToStress(val)
      setAvgStress(prev => Math.round(prev * 0.9 + stress * 0.1))
      setPeakStress(prev => Math.max(prev, stress))
    }, 1000)
    return () => clearInterval(rmssdRef.current)
  }, [sessionActive])

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

  // ── 저장 ──
  const handleSave = async () => {
    const timestamp = new Date().toLocaleString('ko-KR')
    const savedNote = `${notes}\n\n저장완료입니다 ✓\n${timestamp}`
    setNotes(savedNote)
    setIsSaved(true)
    try {
      await axios.post(`${API}/api/notes`, {
        pat_id: patient?.pat_id,
        notes,
        stress_total: avgStress,
        stress_peak: peakStress,
      })
    } catch (e) {}
  }

  // ── 진단 완료 → 레포트 ──
  const handleComplete = async () => {
    await handleSave()
    navigate(`/report/${patient?.pat_id}`)
  }

  const currentPatient = WAITING_PATIENTS[currentPatientIdx]

  return (
    <div className="monitor-root" onClick={() => showDropdown && setShowDropdown(false)}>
      {/* ── 네비게이션 바 ── */}
      <nav className="monitor-navbar">
        <div className="nav-controls">
          <button className="nav-icon-btn" onClick={() => navigate('/schedule')}>←</button>
          <button className="nav-icon-btn" onClick={() => window.location.reload()}>↺</button>
          <span style={{ fontSize: 13, color: '#888', marginLeft: 4, fontFamily: 'Georgia, serif', fontWeight: 600 }}>M</span>
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

        <div className="nav-user-area">
          <span className="nav-user-label">User</span>
          <button className="nav-user-btn">문</button>
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
                Age: {patient?.pat_birth
                  ? `${new Date().getFullYear() - new Date(patient.pat_birth).getFullYear()}세`
                  : '–'} / {patient?.pat_gender} / 환자번호 {patient?.pat_id}
              </div>
            </div>

            {/* 스트레스 원형 3개 */}
            <div className="stress-circles-section">
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${circleClass(mlHrMean ?? avgStress)}`}>
                  <span className="num">{mlHrMean ?? avgStress}</span>
                </div>
                <span className="stress-circle-label">평균</span>
              </div>
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${circleClass(mlHrMax ?? peakStress)}`}>
                  <span className="num">{mlHrMax ?? peakStress}</span>
                </div>
                <span className="stress-circle-label">최고</span>
              </div>
              <div className="stress-circle-item">
                <div className="stress-circle-ring c-orange">
                  <span className="num">{threshold}</span>
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
                    {avgStress > threshold && (
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
                    {/* 임계치 기준선 (빨간 가로선) */}
                    <ReferenceLine
                      y={rmssdToStress(threshold) > 0 ? 65 - rmssdToStress(threshold) * 0.45 : 35}
                      stroke="#E53935"
                      strokeWidth={1.5}
                      strokeDasharray="0"
                    />
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
              {SAMPLE_PRESCRIPTIONS.map((rx, i) => (
                <div className="prescription-row" key={i}>
                  <span className="prescription-date">{rx.date}</span>
                  <span className="prescription-content" style={{ whiteSpace: 'pre-line' }}>{rx.content}</span>
                  {rx.compare && <button className="compare-btn">비교</button>}
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
