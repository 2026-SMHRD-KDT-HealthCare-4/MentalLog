import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

const Join = () => {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    doc_id: '', passward: '', pw_confirm: '',
    doc_name: '', hospital_name: '', license_no: '',
  })
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleJoin = async () => {
    if (!form.doc_id || !form.passward || !form.doc_name) {
      setError('ID, 비밀번호, 성명은 필수입니다.'); return
    }
    if (form.passward !== form.pw_confirm) {
      setError('비밀번호가 일치하지 않습니다.'); return
    }
    try {
      const res = await axios.post(`${API}/join`, form)
      if (res.data === 1 || res.data?.success) {
        navigate('/login')
      } else {
        setError('회원가입에 실패했습니다. 다시 시도해주세요.')
      }
    } catch {
      setError('서버 연결 실패. 잠시 후 다시 시도해주세요.')
    }
  }

  const fields = [
    { label: '의사 ID',  key: 'doc_id',       type: 'text' },
    { label: 'PW',       key: 'passward',      type: 'password' },
    { label: 'PW 확인',  key: 'pw_confirm',    type: 'password' },
    { label: '의사 성명', key: 'doc_name',      type: 'text' },
    { label: '병원명',   key: 'hospital_name', type: 'text' },
    { label: '면허번호', key: 'license_no',    type: 'text' },
  ]

  return (
    <div className="auth-page">
      <div className="auth-brand">MentalLog</div>
      <div className="auth-card">
        <div className="auth-card-title">회원가입</div>

        {fields.map(f => (
          <div className="auth-field" key={f.key}>
            <label>{f.label}</label>
            <input
              className="auth-input"
              type={f.type}
              value={form[f.key]}
              onChange={set(f.key)}
            />
          </div>
        ))}

        {error && (
          <div style={{ color: '#E53935', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
            {error}
          </div>
        )}

        <div className="auth-btn-row">
          <button className="btn btn-dark" style={{ padding: '8px 28px' }} onClick={handleJoin}>
            가입하기
          </button>
          <button className="btn btn-light" style={{ padding: '8px 28px' }} onClick={() => navigate('/login')}>
            취소
          </button>
        </div>
      </div>

      <div className="auth-link">
        이미 계정이 있으신가요? <a href="/login">로그인</a>
      </div>
    </div>
  )
}

export default Join
