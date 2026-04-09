import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

const Login = () => {
  const navigate = useNavigate()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')

  const handleLogin = async () => {
    if (!id || !pw) { setError('아이디와 비밀번호를 입력하세요.'); return }
    try {
      const res = await axios.post(`${API}/login`, { doc_id: id, password: pw })
      if (res.data.success) {
        sessionStorage.setItem('doctor', JSON.stringify(res.data.user))
        navigate('/schedule')
      } else {
        setError(res.data.message || '로그인 실패')
      }
    } catch {
      setError('서버에 연결할 수 없습니다. Node 서버가 실행 중인지 확인하세요.')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">MentalLog</div>
      <div className="auth-card" style={{ width: 420 }}>
        <div className="auth-card-title">Login</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="auth-input"
            type="text"
            placeholder="아이디"
            value={id}
            onChange={e => setId(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ height: 42, borderRadius: 8, fontSize: 14 }}
          />
          <input
            className="auth-input"
            type="password"
            placeholder="비밀번호"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ height: 42, borderRadius: 8, fontSize: 14 }}
          />
        </div>

        {error && (
          <div style={{ color: '#E53935', fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            {error}
          </div>
        )}

        <button className="auth-submit-btn" onClick={handleLogin} style={{ marginTop: 16 }}>
          Login
        </button>
      </div>

      <div className="auth-link">
        계정이 없으신가요? <a href="/join">회원가입</a>
      </div>
    </div>
  )
}

export default Login
