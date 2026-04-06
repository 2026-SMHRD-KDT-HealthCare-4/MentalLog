import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

const SAMPLE_PATIENTS = [
  { pat_id: 'P001', pat_name: '홍길동', pat_birth: '1985-03-15', pat_gender: '남', diagnosis: '범불안장애(GAD)', last_visit: '2026-04-01' },
  { pat_id: 'P002', pat_name: '김미래', pat_birth: '1990-07-22', pat_gender: '여', diagnosis: '주요우울장애(MDD)', last_visit: '2026-04-03' },
  { pat_id: 'P003', pat_name: '이준혁', pat_birth: '1978-11-08', pat_gender: '남', diagnosis: '공황장애', last_visit: '2026-03-28' },
  { pat_id: 'P004', pat_name: '박서연', pat_birth: '1995-05-30', pat_gender: '여', diagnosis: '외상 후 스트레스장애(PTSD)', last_visit: '2026-04-05' },
]

const PatientList = () => {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    axios.get(`${API}/api/patients`)
      .then(res => setPatients(Array.isArray(res.data) && res.data.length > 0 ? res.data : SAMPLE_PATIENTS))
      .catch(() => setPatients(SAMPLE_PATIENTS))
      .finally(() => setLoading(false))
  }, [])

  const filtered = patients.filter(p =>
    p.pat_name?.includes(search) ||
    p.pat_id?.toLowerCase().includes(search.toLowerCase()) ||
    p.diagnosis?.includes(search)
  )

  return (
    <div className="monitor-root">
      {/* Navbar */}
      <nav className="monitor-navbar">
        <a href="/" className="navbar-brand">
          <span className="brand-dot" />
          MentalLog
        </a>
        <div className="navbar-nav">
          <a href="/patients" className="active">환자 목록</a>
        </div>
        <div className="navbar-user">
          <span>담당의</span>
          <div className="avatar">Dr</div>
        </div>
      </nav>

      <div className="monitor-page">
        <div className="patient-list-page" style={{ maxWidth: '100%' }}>
          <div className="patient-list-header">
            <h1>환자 목록</h1>
            <p>환자를 선택해 스트레스 모니터링 세션을 시작하세요.</p>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              placeholder="이름, ID, 진단명으로 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ maxWidth: 320 }}
            />
            <span style={{ fontSize: 13, color: '#475569' }}>
              {filtered.length}명
            </span>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="spinner" />
              환자 목록 불러오는 중...
            </div>
          ) : (
            <table className="patient-table">
              <thead>
                <tr>
                  <th>환자 ID</th>
                  <th>이름</th>
                  <th>생년월일</th>
                  <th>성별</th>
                  <th>진단명</th>
                  <th>최근 방문</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.pat_id}>
                    <td style={{ color: '#64748B', fontFamily: 'monospace' }}>{p.pat_id}</td>
                    <td style={{ fontWeight: 600 }}>{p.pat_name}</td>
                    <td>{p.pat_birth}</td>
                    <td>{p.pat_gender}</td>
                    <td>
                      <span style={{
                        fontSize: 12, padding: '2px 8px', borderRadius: 4,
                        background: 'rgba(14,165,233,0.08)',
                        color: '#38BDF8',
                        border: '1px solid rgba(56,189,248,0.15)'
                      }}>
                        {p.diagnosis}
                      </span>
                    </td>
                    <td style={{ color: '#64748B' }}>{p.last_visit || '-'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="action-btn"
                        onClick={() => navigate(`/monitor/${p.pat_id}`)}
                      >
                        모니터링 시작
                      </button>
                      <button
                        className="action-btn"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#818CF8', borderColor: 'rgba(129,140,248,0.2)' }}
                        onClick={() => navigate(`/history/${p.pat_id}`)}
                      >
                        히스토리
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: '#475569', padding: 32 }}>
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default PatientList
