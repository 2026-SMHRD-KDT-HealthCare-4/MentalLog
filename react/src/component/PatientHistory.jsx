import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

function stressColor(v) {
  if (v < 40) return '#22C55E'
  if (v < 70) return '#F59E0B'
  return '#EF4444'
}

function stressLabel(v) {
  if (v < 40) return 'low'
  if (v < 70) return 'medium'
  return 'high'
}

const SAMPLE_HISTORY = [
  {
    visit_id: 'V001',
    visit_date: '2026-04-01',
    duration: '32분',
    stress_total: 58,
    stress_peak: 74,
    hrv_avg: 42,
    diagnosis: '범불안장애(GAD)',
    phq9: 8,
    gad7: 10,
    sleep_quality: 4,
    anxiety_level: 7,
    chief_complaint: '직장 스트레스로 인한 수면 장애와 만성 두통 호소',
    medication: '에스시탈로프람 10mg',
    keywords: ['불면', '두통', '업무'],
    notes: '불안 증상 지속. 인지행동치료 병행 권고. 약물 용량 유지. 2주 후 재방문 예정.',
  },
  {
    visit_id: 'V002',
    visit_date: '2026-03-18',
    duration: '27분',
    stress_total: 45,
    stress_peak: 61,
    hrv_avg: 51,
    diagnosis: '범불안장애(GAD)',
    phq9: 6,
    gad7: 8,
    sleep_quality: 6,
    anxiety_level: 5,
    chief_complaint: '전반적인 불안감, 집중력 저하',
    medication: '에스시탈로프람 10mg',
    keywords: ['집중', '피로'],
    notes: '이전 대비 증상 호전. 수면 패턴 개선됨. 약물 유지 및 1개월 후 재방문.',
  },
  {
    visit_id: 'V003',
    visit_date: '2026-02-25',
    duration: '41분',
    stress_total: 72,
    stress_peak: 88,
    hrv_avg: 28,
    diagnosis: '범불안장애(GAD)',
    phq9: 12,
    gad7: 14,
    sleep_quality: 2,
    anxiety_level: 9,
    chief_complaint: '극심한 불안, 공황발작 2회 경험, 완전한 불면',
    medication: '에스시탈로프람 5mg',
    keywords: ['공황', '불면', '공포', '가슴답답', '긴장'],
    notes: '고스트레스 상태. 에스시탈로프람 10mg으로 증량. 필요 시 단기간 수면제 처방 고려. 2주 이내 재방문.',
  },
]

const PatientHistory = () => {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedVisit, setSelectedVisit] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const pid = patientId || 'P001'
    axios.get(`${API}/api/patients/${pid}`)
      .then(res => setPatient(res.data))
      .catch(() => setPatient({
        pat_id: pid, pat_name: '홍길동',
        pat_birth: '1985-03-15', pat_gender: '남',
        diagnosis: '범불안장애(GAD)', pat_phone: '010-1234-5678'
      }))

    axios.get(`${API}/api/history/${pid}`)
      .then(res => {
        const data = Array.isArray(res.data) && res.data.length > 0 ? res.data : SAMPLE_HISTORY
        setHistory(data)
        setSelectedVisit(data[0])
      })
      .catch(() => {
        setHistory(SAMPLE_HISTORY)
        setSelectedVisit(SAMPLE_HISTORY[0])
      })
      .finally(() => setLoading(false))
  }, [patientId])

  // 스트레스 추세 차트 데이터
  const trendData = history.map(v => ({
    date: v.visit_date,
    current: v.stress_total,
    peak: v.stress_peak,
    hrv: v.hrv_avg,
  })).reverse()

  return (
    <div className="monitor-root">
      {/* Navbar */}
      <nav className="monitor-navbar">
        <a href="/" className="navbar-brand">
          <span className="brand-dot" />
          MentalLog
        </a>
        <div className="navbar-nav">
          <a href="/patients">환자 목록</a>
          <a href={`/monitor/${patientId}`} className="active">모니터링</a>
        </div>
        <div className="navbar-user">
          <span>담당의</span>
          <div className="avatar">Dr</div>
        </div>
      </nav>

      <div className="monitor-page history-page" style={{ padding: '20px 24px' }}>
        {/* 헤더 */}
        <div className="history-header">
          <button className="btn btn-outline" onClick={() => navigate('/patients')} style={{ padding: '6px 12px' }}>
            ← 목록
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#F1F5F9' }}>
              {patient?.pat_name || '...'}
              <span style={{ fontSize: 14, color: '#64748B', fontWeight: 400, marginLeft: 10 }}>
                환자 방문 히스토리
              </span>
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
              {patient?.pat_id} · {patient?.pat_birth} · {patient?.pat_gender} · {patient?.diagnosis}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/monitor/${patientId}`)}
            style={{ marginLeft: 'auto' }}
          >
            새 세션 시작
          </button>
        </div>

        {/* 스트레스 추세 차트 */}
        {trendData.length > 1 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">스트레스 추세 (방문별)</span>
            </div>
            <div style={{ padding: '10px 16px 16px' }}>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 11 }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#0F172A', border: '1px solid #1E3A5F', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#64748B' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: '#64748B', paddingTop: 8 }}
                  />
                  <Line type="monotone" dataKey="current" name="현재 스트레스" stroke="#38BDF8" strokeWidth={2} dot={{ fill: '#38BDF8', r: 4 }} />
                  <Line type="monotone" dataKey="peak" name="최고 스트레스" stroke="#EF4444" strokeWidth={2} strokeDasharray="4 4" dot={{ fill: '#EF4444', r: 4 }} />
                  <Line type="monotone" dataKey="hrv" name="HRV 평균(ms)" stroke="#22C55E" strokeWidth={2} dot={{ fill: '#22C55E', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading-state"><div className="spinner" />히스토리 불러오는 중...</div>
        ) : (
          <div className="history-grid">
            {/* 방문 목록 */}
            <div className="history-list">
              <p style={{ fontSize: 12, color: '#475569', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                방문 기록 ({history.length}건)
              </p>
              {history.map(v => (
                <div
                  key={v.visit_id}
                  className={`history-item ${selectedVisit?.visit_id === v.visit_id ? 'selected' : ''}`}
                  onClick={() => setSelectedVisit(v)}
                >
                  <div className="history-item-date">{v.visit_date}</div>
                  <div className="history-item-meta">진료 시간: {v.duration}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span className={`history-item-stress ${stressLabel(v.stress_total)}`}>
                      스트레스 {v.stress_total}
                    </span>
                    <span className={`history-item-stress ${stressLabel(v.stress_peak)}`}>
                      최고 {v.stress_peak}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* 방문 상세 */}
            {selectedVisit && (
              <div className="history-detail">
                {/* 측정 데이터 */}
                <div className="detail-section">
                  <div className="detail-section-header">측정 데이터 — {selectedVisit.visit_date}</div>
                  <div className="detail-section-body">
                    <div className="detail-row">
                      <span className="detail-row-label">진료 시간</span>
                      <span className="detail-row-value">{selectedVisit.duration}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">현재 스트레스</span>
                      <span className="detail-row-value" style={{ color: stressColor(selectedVisit.stress_total), fontWeight: 700 }}>
                        {selectedVisit.stress_total} / 100
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">최고 스트레스</span>
                      <span className="detail-row-value" style={{ color: stressColor(selectedVisit.stress_peak), fontWeight: 700 }}>
                        {selectedVisit.stress_peak} / 100
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">HRV 평균 (RMSSD)</span>
                      <span className="detail-row-value">{selectedVisit.hrv_avg} ms</span>
                    </div>
                  </div>
                </div>

                {/* 사전문진 */}
                <div className="detail-section">
                  <div className="detail-section-header">사전문진 결과</div>
                  <div className="detail-section-body">
                    <div className="detail-row">
                      <span className="detail-row-label">주요 호소</span>
                      <span className="detail-row-value">{selectedVisit.chief_complaint}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">PHQ-9 점수</span>
                      <span className="detail-row-value">{selectedVisit.phq9} / 27</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">GAD-7 점수</span>
                      <span className="detail-row-value">{selectedVisit.gad7} / 21</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">수면의 질</span>
                      <span className="detail-row-value">{selectedVisit.sleep_quality} / 10</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">불안 수준</span>
                      <span className="detail-row-value">{selectedVisit.anxiety_level} / 10</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row-label">복용 약물</span>
                      <span className="detail-row-value">{selectedVisit.medication || '없음'}</span>
                    </div>
                  </div>
                </div>

                {/* 추출 키워드 */}
                {selectedVisit.keywords && selectedVisit.keywords.length > 0 && (
                  <div className="detail-section">
                    <div className="detail-section-header">추출된 음성 키워드</div>
                    <div className="detail-section-body">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {selectedVisit.keywords.map((kw, i) => (
                          <span key={i} className="keyword-chip" style={{ cursor: 'default' }}>
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 의사 소견 */}
                <div className="detail-section">
                  <div className="detail-section-header">최종 의사 소견</div>
                  <div className="detail-section-body">
                    <p style={{
                      fontSize: 14, color: '#E2E8F0', lineHeight: 1.7,
                      margin: 0, whiteSpace: 'pre-wrap'
                    }}>
                      {selectedVisit.notes || '소견이 기록되지 않았습니다.'}
                    </p>
                  </div>
                </div>

                {/* 진단 완료 표시 */}
                <div style={{
                  background: 'rgba(34,197,94,0.06)',
                  border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 14,
                  color: '#86EFAC',
                }}>
                  <span style={{ fontSize: 22 }}>✓</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#22C55E' }}>진단 완료</div>
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                      {selectedVisit.visit_date} 방문 — 소견 작성 완료
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PatientHistory
