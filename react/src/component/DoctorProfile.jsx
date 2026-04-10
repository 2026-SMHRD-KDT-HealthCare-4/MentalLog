import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

const DoctorProfile = () => {
  const navigate = useNavigate()
  const [doctor, setDoctor] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = JSON.parse(sessionStorage.getItem('doctor') || '{}')
    if (!stored.doc_id) { navigate('/login'); return }

    axios.get(`${API}/api/doctor/${stored.doc_id}`)
      .then(res => setDoctor(res.data))
      .catch(() => {
        // 서버 조회 실패 시 sessionStorage 데이터로 폴백
        setDoctor(stored)
        setError('일부 정보를 불러오지 못했습니다.')
      })
  }, [navigate])

  const handleLogout = () => {
    sessionStorage.removeItem('doctor')
    navigate('/login')
  }

  if (!doctor) return (
    <div className="auth-page">
      <div className="auth-brand">MentalLog</div>
      <div style={{ color: '#888', marginTop: 40 }}>불러오는 중...</div>
    </div>
  )

  const initial = doctor.doc_name ? doctor.doc_name[0] : '의'

  const rows = [
    { label: '의사 ID',  value: doctor.doc_id },
    { label: '성명',     value: doctor.doc_name },
    { label: '병원명',   value: doctor.hospital_name || '–' },
    { label: '면허번호', value: doctor.license_no || '–' },
  ]

  return (
    <div className="auth-page">
      <div className="auth-brand">MentalLog</div>

      <div className="auth-card" style={{ width: 440, position: 'relative' }}>
        {/* 좌상단 뒤로가기 */}
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute', top: 14, left: 14,
            background: 'none', border: 'none',
            fontSize: 20, color: '#888', cursor: 'pointer', lineHeight: 1,
          }}
        >
          ←
        </button>

        {/* 아바타 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: '#4A90D9', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 700, marginBottom: 10,
          }}>
            {initial}
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#222' }}>{doctor.doc_name}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{doctor.hospital_name || ''}</div>
        </div>

        {/* 정보 테이블 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(r => (
            <div key={r.label} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '10px 14px', background: '#F8F8F8',
              borderRadius: 8, fontSize: 14,
            }}>
              <span style={{ color: '#888', fontWeight: 500 }}>{r.label}</span>
              <span style={{ color: '#222', fontWeight: 600 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ color: '#F0A500', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
            {error}
          </div>
        )}

        {/* 버튼 */}
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button
            className="btn btn-light"
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 14 }}
            onClick={() => navigate('/profile/edit')}
          >
            회원정보 수정
          </button>
          <button
            className="btn btn-dark"
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 14, background: '#E53935' }}
            onClick={handleLogout}
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

export default DoctorProfile
