import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import axios from 'axios'
import '../styles/monitor.css'
import { circleClass } from '../utils/stressUtils'

const API = 'http://localhost:3001'

const GraphTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'white', border: '1px solid #DDD', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
      <div style={{ color: '#888' }}>포인트 {label}</div>
      <div style={{ fontWeight: 700 }}>{payload[0].value} ms</div>
    </div>
  )
}

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
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const noteId = searchParams.get('noteId')

  const passedPatient   = location.state?.patient     || null
  const passedNotes     = location.state?.notes       || null
  const passedTotal     = location.state?.totalStress ?? null
  const passedPeak      = location.state?.peakStress  ?? null
  const passedThreshold = location.state?.threshold   ?? null
  const passedSessionId = location.state?.sessionId   || null

  const [patient, setPatient] = useState(null)
  const [notes, setNotes] = useState(passedNotes || '')
  const [summary, setSummary] = useState('')
  const [cumulativeAvg, setCumulativeAvg] = useState(passedTotal ?? 0)
  const [peakStress, setPeakStress] = useState(passedPeak ?? 0)
  const [threshold, setThreshold] = useState(passedThreshold ?? 0)
  const [rmssdData, setRmssdData] = useState([])
  const passedGraphUrl = location.state?.graphUrl || null
  const [graphUrl, setGraphUrl] = useState(passedGraphUrl)
  const reportTime = new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  // HRV DB 데이터 + Firebase graph_url 로드
  const loadHrvData = (sessionId) => {
    if (!sessionId) return
    axios.get(`${API}/api/hrv/${sessionId}`).then(res => {
      const rows = res.data || []
      if (rows.length > 0) {
        setRmssdData(rows)
        const hrVals = rows.map(r => r.hr).filter(v => v > 0)
        if (hrVals.length > 0) setHrAvg(Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length))
      }
    }).catch(() => {})

    // Firebase에 업로드된 그래프 이미지 URL 가져오기
    axios.get(`${API}/api/notes/detail/${sessionId}`).then(res => {
      const d = res.data
      if (!d) return
      try {
        const graphData = JSON.parse(d.stress_graph_data || '{}')
        if (graphData.graph_url) setGraphUrl(graphData.graph_url)
      } catch {}
    }).catch(() => {})
  }

  useEffect(() => {
    // 히스토리에서 특정 소견 조회
    if (noteId) {
      axios.get(`${API}/api/notes/detail/${noteId}`).then(res => {
        const d = res.data
        if (!d) return
        setPatient({
          pat_id:     d.pat_id,
          pat_name:   d.pat_name || d.pat_id,
          birth_date: d.pat_birth,
          gender:     d.pat_gender,
        })
        setNotes(d.notes || '')
        setPeakStress(d.stress_peak || 0)
        setCumulativeAvg(d.stress_total || 0)
        try {
          const graphData = JSON.parse(d.stress_graph_data || '{}')
          if (graphData.graph_url) setGraphUrl(graphData.graph_url)
        } catch {}
        loadHrvData(noteId)
      }).catch(() => {})
      return
    }

    // 진단 완료 후 진입 (state로 받은 값 우선)
    // passedSessionId 우선 사용, 없으면 DB에서 조회
    if (passedSessionId) loadHrvData(passedSessionId)

    Promise.all([
      axios.get(`${API}/api/patients/${patientId}`).catch(() => ({ data: null })),
      axios.get(`${API}/api/notes/${patientId}`).catch(() => ({ data: null })),
      axios.get(`${API}/api/history/${patientId}`).catch(() => ({ data: [] })),
      axios.get(`${API}/api/questionnaire/${patientId}`).catch(() => ({ data: null })),
    ]).then(([patRes, notesRes, histRes, qRes]) => {
      setPatient(patRes.data || passedPatient || {
        pat_id: patientId, pat_name: patientId,
        birth_date: null, gender: '–', med_history: '–',
      })
      if (notesRes.data) {
        if (notesRes.data.notes && !passedNotes) setNotes(notesRes.data.notes)
        if (passedPeak === null) setPeakStress(notesRes.data.stress_peak || 0)
        if (!passedSessionId) loadHrvData(notesRes.data.session_id)
      }
      const visits = histRes.data || []
      if (visits.length > 0 && passedTotal === null) {
        setCumulativeAvg(Math.round(
          visits.reduce((sum, v) => sum + (v.stress_total || 0), 0) / visits.length
        ))
      }
      if (qRes.data?.threshold && passedThreshold === null) setThreshold(qRes.data.threshold)
    })
  }, [patientId, noteId])

  const age = patient?.birth_date
    ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear()
    : '-'

  return (
    <div className="report-root">
      {/* 네비게이션 */}
      <nav className="monitor-navbar">
        <div className="nav-controls">
          <button className="nav-icon-btn" onClick={() => navigate(-1)}>←</button>
          <button className="nav-icon-btn" onClick={() => navigate('/schedule')}>↑</button>
          <span
            style={{ fontSize: 13, color: '#888', marginLeft: 4, fontFamily: 'Georgia, serif', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => navigate('/schedule')}
          >M</span>
        </div>

        <div className="nav-patient-nav">
          <button className="nav-arrow-btn">&lt;&lt;</button>
          <span className="nav-patient-name-btn" style={{ cursor: 'default' }}>
            {patient?.pat_name || patientId}
          </span>
          <button className="nav-arrow-btn">&gt;&gt;</button>
        </div>

        <div className="nav-user-area" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
          <span className="nav-user-label">User</span>
          <button className="nav-user-btn">
            {(() => { const d = JSON.parse(sessionStorage.getItem('doctor') || '{}'); return d.doc_name?.[0] || '의' })()}
          </button>
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
                Age: {age}세 / {patient?.gender} / 환자번호 {patient?.pat_id}
              </div>
            </div>

            {/* 스트레스 원형 */}
            <div className="stress-circles-section">
              <div className="stress-circle-item">
                <div className={`stress-circle-ring ${circleClass(cumulativeAvg)}`}>
                  <span className="num">{cumulativeAvg}</span>
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
                <div className={`stress-circle-ring ${circleClass(threshold)}`}>
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
                <span>주요 키워드</span>
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
            </div>
            <div className="graph-area">
              {graphUrl ? (
                <img src={graphUrl} alt="RMSSD 그래프" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : rmssdData.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#BBB', fontSize: 13 }}>
                  저장된 HRV 데이터가 없습니다
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
                  {threshold > 0 && (
                    <ReferenceLine y={threshold} stroke="#E53935" strokeWidth={1.5}
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

        {/* 하단: 주요 상황 요약 + 의사 소견 */}
        <div className="report-bottom">
          {/* 주요 상황 요약 */}
          <div className="report-summary-panel">
            <div className="panel-header">
              <span className="panel-title">주요 상황 요약</span>
            </div>
            <div className="report-summary-body">
              {summary || (
                <span style={{ color: '#CCC' }}>저장된 요약이 없습니다.</span>
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
