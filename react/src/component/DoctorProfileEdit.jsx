import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

const DoctorProfileEdit = () => {
  const navigate = useNavigate()
  const [form, setForm] = useState({ doc_name: '', hospital_name: '', license_no: '', password: '', pw_confirm: '' })
  const [docId, setDocId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const stored = JSON.parse(sessionStorage.getItem('doctor') || '{}')
    if (!stored.doc_id) { navigate('/login'); return }
    setDocId(stored.doc_id)
    setForm(f => ({
      ...f,
      doc_name: stored.doc_name || '',
      hospital_name: stored.hospital_name || '',
      license_no: stored.license_no || '',
    }))
  }, [navigate])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (form.password && form.password !== form.pw_confirm) {
      setError('비밀번호가 일치하지 않습니다.'); return
    }
    try {
      const res = await axios.put(`${API}/api/doctor/${docId}`, {
        doc_name: form.doc_name,
        hospital_name: form.hospital_name,
        license_no: form.license_no,
        ...(form.password ? { password: form.password } : {}),
      })
      if (res.data.success) {
        sessionStorage.setItem('doctor', JSON.stringify({
          doc_id: docId,
          doc_name: form.doc_name,
          hospital_name: form.hospital_name,
          license_no: form.license_no,
        }))
        setSuccess(true)
        setTimeout(() => navigate('/profile', { replace: true }), 1000)
      } else {
        setError('수정에 실패했습니다.')
      }
    } catch {
      setError('서버 연결 실패.')
    }
  }

  const fields = [
    { label: '성명',     key: 'doc_name',      type: 'text' },
    { label: '병원명',   key: 'hospital_name', type: 'text' },
    { label: '면허번호', key: 'license_no',    type: 'text' },
    { label: '새 비밀번호', key: 'password',   type: 'password', placeholder: '변경 시에만 입력' },
    { label: 'PW 확인',  key: 'pw_confirm',    type: 'password', placeholder: '변경 시에만 입력' },
  ]

  return (
    <div className="auth-page">
      <div className="auth-brand">MentalLog</div>

      <div className="auth-card" style={{ width: 440, position: 'relative' }}>
        {/* 좌상단 뒤로가기 */}
        <button
          onClick={() => navigate('/profile', { replace: true })}

          style={{
            position: 'absolute', top: 14, left: 14,
            background: 'none', border: 'none',
            fontSize: 20, color: '#888', cursor: 'pointer', lineHeight: 1,
          }}
        >
          ←
        </button>

        <div className="auth-card-title" style={{ marginBottom: 20 }}>회원정보 수정</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map(f => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#888', fontWeight: 500 }}>{f.label}</label>
              <input
                className="auth-input"
                type={f.type}
                value={form[f.key]}
                placeholder={f.placeholder || ''}
                onChange={set(f.key)}
                style={{ height: 40, borderRadius: 8, fontSize: 14 }}
              />
            </div>
          ))}
        </div>

        {error && (
          <div style={{ color: '#E53935', fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ color: '#2E7D32', fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            수정 완료! 돌아갑니다...
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            className="btn btn-dark"
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 14 }}
            onClick={handleSave}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

export default DoctorProfileEdit
