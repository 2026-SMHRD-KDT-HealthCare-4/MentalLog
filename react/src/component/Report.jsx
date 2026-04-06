import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

function circleClass(val) {
  if (val < 40) return 'c-green'
  if (val < 60) return 'c-yellow'
  if (val < 75) return 'c-orange'
  return 'c-red'
}

const GraphTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'white', border: '1px solid #DDD', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
      <div style={{ color: '#888' }}>포인트 {label}</div>
      <div style={{ fontWeight: 700 }}>{payload[0].value} ms</div>
    </div>
  )
}

// 샘플 RMSSD (저장된 세션 데이터)
const SAMPLE_RMSSD = Array.from({ length: 50 }, (_, i) => ({
  x: i,
  value: Math.round(30 + Math.sin(i * 0.4) * 12 + Math.random() * 8),
}))

const SAMPLE_KEYWORDS = [
  { id: 1, word: '가족', time: '12:35:24' },
  { id: 2, word: '다리', time: '12:38:14' },
  { id: 3, word: '돈',   time: '12:40:24' },
  { id: 4, word: '얼굴', time: '12:52:12' },
  { id: 5, word: '성적', time: '12:53:58' },
  { id: 6, word: '연애', time: '12:56:32' },
]

const Report = () => {
  const { patientId } = useParams()
  const navigate = useNavigate()

  const [patient, setPatient] = useState(null)
  const [notes, setNotes] = useState('')
  const [summary, setSummary] = useState('')
  const [avgStress] = useState(43)
  const [peakStress] = useState(90)
  const [threshold] = useState(64)
  const [hrv] = useState(62)
  const [hr] = useState(80)
  const reportTime = new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  useEffect(() => {
    axios.get(`${API}/api/patients/${patientId}`)
      .then(res => setPatient(res.data))
      .catch(() => setPatient({
        pat_id: patientId || 'P002',
        pat_name: '박망나뇽',
        pat_birth: '1924-01-01',
        pat_gender: '남',
        diagnosis: '범불안장애(GAD)',
      }))

    axios.get(`${API}/api/notes/${patientId}`)
      .then(res => { if (res.data?.notes) setNotes(res.data.notes) })
      .catch(() => {})
  }, [patientId])

  const age = patient?.pat_birth
    ? new Date().getFullYear() - new Date(patient.pat_birth).getFullYear()
    : '-'

  return (
    <div className="report-root">
      {/* 네비게이션 */}
      <nav className="monitor-navbar">
        <div className="nav-controls">
          <button className="nav-icon-btn" onClick={() => navigate(-1)}>←</button>
          <button className="nav-icon-btn" onClick={() => navigate('/schedule')}>↑</button>
        </div>

        <div className="nav-patient-nav">
          <button className="nav-arrow-btn">&lt;&lt;</button>
          <span className="nav-patient-name-btn" style={{ cursor: 'default' }}>
            박망나-1b
          </span>
          <button className="nav-arrow-btn">&gt;&gt;</button>
        </div>

        <div className="nav-user-area">
          <span className="nav-user-label">User</span>
          <button className="nav-user-btn">문</button>
        </div>
      </nav>

      {/* 바디 */}
      <div className="report-body">
        {/* 제목 */}
        <div className="report-title">
          "{patient?.pat_name || '...'}"님의 결과 레포트 ({reportTime})
        </div>

        {/* 상단: 좌측 패널 + 그래프 */}
        <div className="report-top">
          {/* 좌측 패널 */}
          <div className="left-panel">
            {/* 환자 정보 */}
            <div className="patient-info-section">
              <div className="patient-title">
                환자 : {patient?.pat_name || '...'}
              </div>
              <div className="patient-sub">
                Age: {age}세 / {patient?.pat_gender} / 환자번호 {patient?.pat_id}
              </div>
            </div>

            {/* 스트레스 원형 */}
            <div className="stress-circles-section">
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${circleClass(avgStress)}`}>
                  <span className="num">{avgStress}</span>
                </div>
                <span className="stress-circle-label">평균</span>
              </div>
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${circleClass(peakStress)}`}>
                  <span className="num">{peakStress}</span>
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
              <span className="trend-badge up">▲</span>
              최근 추세에서는 n % 상승
            </div>

            {/* 주요 키워드 */}
            <div className="keywords-section">
              <div className="keywords-section-header">
                <span>추요 키워드</span>
              </div>
              <div className="keyword-grid">
                {SAMPLE_KEYWORDS.map(kw => (
                  <div key={kw.id} className="kw-chip">
                    <span className="kw-word">{kw.word}</span>
                    <span className="kw-time">{kw.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 그래프 */}
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
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={SAMPLE_RMSSD} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#F0F0F0" vertical={false} />
                  <XAxis
                    dataKey="x"
                    tick={{ fill: '#BBB', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#EEE' }}
                    interval={4}
                  />
                  <YAxis
                    domain={[0, 65]}
                    ticks={[0, 15, 30, 45, 60]}
                    tick={{ fill: '#BBB', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<GraphTooltip />} />
                  <ReferenceLine y={38} stroke="#E53935" strokeWidth={1.5} />
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
            </div>
          </div>
        </div>

        {/* 하단: 주요 상황 요약 + 의사 소견 */}
        <div className="report-bottom">
          {/* 주요 상황 요약 */}
          <div className="report-summary-panel">
            <div className="panel-header">
              <span className="panel-title">주요 상황 요약</span>
            </div>
            <div className="report-summary-body">
              {summary || (
                <span style={{ color: '#CCC' }}>
                  "에서나 이래도 뭘 상처이 됩습시다..."
                </span>
              )}
              {summary && (
                <div style={{ fontSize: 11, color: '#AAA', marginTop: 8 }}>
                  {new Date().toLocaleString('ko-KR')}
                </div>
              )}
            </div>
          </div>

          {/* 의사 소견 (읽기 전용) */}
          <div className="notes-panel">
            <div className="panel-header">
              <span className="panel-title">의사 소견</span>
              <span style={{ fontSize: 11, color: '#5A9E5A', fontWeight: 600 }}>✓ 저장완료</span>
            </div>
            <div
              className="notes-textarea"
              style={{ flex: 1, padding: '10px 14px', fontSize: 13, color: '#333', lineHeight: 1.7, overflow: 'auto', whiteSpace: 'pre-wrap' }}
            >
              {notes || (
                <span style={{ color: '#CCC' }}>저장된 소견이 없습니다.</span>
              )}
              {notes && (
                <div style={{ fontSize: 11, color: '#AAA', marginTop: 10 }}>
                  [{new Date().toLocaleString('ko-KR')}]
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Report
