const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
const conn = require('./config/db')

// ── 미들웨어 ──
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// ── 기존 회원가입 라우트 ──
app.post('/join', (req, res) => {
  const { doc_id, passward: password, doc_name, hospital_name, license_no } = req.body
  const sql = `
    INSERT INTO TB_DOCTOR (doc_id, password, doc_name, hospital_name, license_no)
    VALUES ($1, $2, $3, $4, $5)
  `
  conn.query(sql, [doc_id, password, doc_name, hospital_name, license_no], (err, result) => {
    if (err) {
      console.error('회원가입 실패:', err.message)
      return res.status(500).send(0)
    }
    res.send(result.rowCount > 0 ? 1 : 0)
  })
})

// ── 로그인 라우트 ──
app.post('/login', (req, res) => {
  const { doc_id, password } = req.body
  const sql = 'SELECT doc_id, doc_name, hospital_name, license_no FROM TB_DOCTOR WHERE doc_id=$1 AND password=$2'
  conn.query(sql, [doc_id, password], (err, result) => {
    if (err) return res.status(500).json({ error: '로그인 실패' })
    if (result.rowCount > 0) {
      res.json({ success: true, user: result.rows[0] })
    } else {
      res.json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' })
    }
  })
})

// ── 의사 프로필 조회 / 수정 ──
app.get('/api/doctor/:doc_id', (req, res) => {
  const { doc_id } = req.params
  const sql = 'SELECT doc_id, doc_name, hospital_name, license_no FROM TB_DOCTOR WHERE doc_id=$1'
  conn.query(sql, [doc_id], (err, result) => {
    if (err) return res.status(500).json({ error: '조회 실패' })
    if (result.rowCount > 0) res.json(result.rows[0])
    else res.status(404).json({ error: '의사 정보 없음' })
  })
})

app.put('/api/doctor/:doc_id', (req, res) => {
  const { doc_id } = req.params
  const { doc_name, hospital_name, license_no, password } = req.body
  const fields = ['doc_name=$1', 'hospital_name=$2', 'license_no=$3']
  const values = [doc_name, hospital_name, license_no]
  if (password) { fields.push(`password=$${values.length + 1}`); values.push(password) }
  values.push(doc_id)
  const sql = `UPDATE TB_DOCTOR SET ${fields.join(', ')} WHERE doc_id=$${values.length}`
  conn.query(sql, values, (err, result) => {
    if (err) return res.status(500).json({ error: '수정 실패' })
    res.json({ success: result.rowCount > 0 })
  })
})

// ── 스트레스 모니터링 API 라우터 ──
const monitorRouter = require('./routes/monitorRouter')
app.use('/api', monitorRouter)

// ── 헬스체크 ──
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'MentalLog API', version: '1.0.0' })
})

// ── 에러 핸들러 ──
app.use((err, _req, res, _next) => {
  console.error('서버 오류:', err.stack)
  res.status(500).json({ error: '서버 내부 오류', detail: err.message })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`MentalLog API 서버 실행 중: http://localhost:${PORT}`)
})
