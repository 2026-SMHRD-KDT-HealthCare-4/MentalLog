/**
 * monitorRouter.js
 * 실제 DB 스키마 기준 API 라우터
 * - tb_patient, tb_hrv_data, tb_session
 */

const express = require('express')
const router = express.Router()
const conn = require('../config/db')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  환자 API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/patients - 전체 환자 목록
router.get('/patients', async (req, res) => {
  try {
    const sql = `
      SELECT pat_id, pat_name, gender, birth_date, med_history, servey_scores, reg_dt
      FROM tb_patient
      ORDER BY reg_dt DESC NULLS LAST
    `
    const result = await conn.query(sql)
    res.json(result.rows)
  } catch (err) {
    console.error('환자 목록 조회 실패:', err.message)
    res.status(500).json({ error: '환자 목록 조회 실패', detail: err.message })
  }
})

// GET /api/patients/:id - 특정 환자 조회
router.get('/patients/:id', async (req, res) => {
  try {
    const sql = `
      SELECT pat_id, pat_name, gender, birth_date, med_history, servey_scores, reg_dt
      FROM tb_patient
      WHERE pat_id = $1
    `
    const result = await conn.query(sql, [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '환자를 찾을 수 없습니다.' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('환자 조회 실패:', err.message)
    res.status(500).json({ error: '환자 조회 실패', detail: err.message })
  }
})

// POST /api/patients - 환자 등록/수정 (upsert)
router.post('/patients', async (req, res) => {
  const { pat_id, pat_name, gender, birth_date, med_history, doc_id } = req.body
  if (!pat_id || !pat_name) {
    return res.status(400).json({ error: 'pat_id, pat_name 필수' })
  }
  try {
    // gender: DB는 CHAR(1) 'M'/'F' 체크 제약 → 한글이면 매핑, 모르면 null
    const genderMapped = gender === '남' ? 'M'
                       : gender === '여' ? 'F'
                       : (gender === 'M' || gender === 'F') ? gender
                       : null

    const sql = `
      INSERT INTO tb_patient (pat_id, pat_name, gender, birth_date, med_history, servey_scores)
      VALUES ($1, $2, $3, $4, $5, 0)
      ON CONFLICT (pat_id) DO UPDATE
        SET pat_name    = EXCLUDED.pat_name,
            gender      = EXCLUDED.gender,
            birth_date  = EXCLUDED.birth_date,
            med_history = EXCLUDED.med_history
      RETURNING *
    `
    const result = await conn.query(sql, [
      pat_id, pat_name,
      genderMapped,
      birth_date  || null,
      med_history || null,
    ])
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('환자 등록 실패:', err.message)
    res.status(500).json({ error: '환자 등록 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HRV 데이터 API (tb_hrv_data)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /api/rmssd - HRV 데이터 저장 (Python → Node)
router.post('/rmssd', async (req, res) => {
  const { session_id, hr_val, rmssd_val, pnn50_val, sd1_val } = req.body
  if (!session_id || rmssd_val === undefined) {
    return res.status(400).json({ error: 'session_id, rmssd_val 필수' })
  }
  try {
    const sql = `
      INSERT INTO tb_hrv_data (session_id, hr_val, rmssd_val, pnn50_val, sd1_val, time_stamp)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING data_no
    `
    const result = await conn.query(sql, [
      session_id,
      Math.round(hr_val    || 0),
      Math.round(rmssd_val || 0),
      Math.round(pnn50_val || 0),
      Math.round(sd1_val   || 0),
    ])
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('HRV 저장 실패:', err.message)
    res.status(500).json({ error: 'HRV 저장 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  문진 API (tb_patient.servey_scores)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /api/questionnaire - 문진 점수 저장 (tb_patient.servey_scores 업데이트)
router.post('/questionnaire', async (req, res) => {
  const { pat_id, stress_score, threshold } = req.body
  if (!pat_id) return res.status(400).json({ error: 'pat_id 필수' })
  try {
    await conn.query(
      'UPDATE tb_patient SET servey_scores = $1 WHERE pat_id = $2',
      [stress_score || 0, pat_id]
    )
    res.status(201).json({ pat_id, stress_score, threshold })
  } catch (err) {
    console.error('문진 저장 실패:', err.message)
    res.status(500).json({ error: '문진 저장 실패', detail: err.message })
  }
})

// GET /api/questionnaire/:patientId - 문진 점수 조회
router.get('/questionnaire/:patientId', async (req, res) => {
  try {
    const result = await conn.query(
      'SELECT servey_scores AS stress_score FROM tb_patient WHERE pat_id = $1',
      [req.params.patientId]
    )
    if (result.rows.length === 0) return res.json(null)
    const score = result.rows[0].stress_score || 0
    // PSS 기반 임계치 계산 (프론트와 동일 공식)
    const threshold = Math.round(score * 1.5 + 40)
    res.json({ stress_score: score, threshold })
  } catch (err) {
    console.error('문진 조회 실패:', err.message)
    res.status(500).json({ error: '문진 조회 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  세션/소견 API (tb_session)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/notes/detail/:sessionId - 특정 세션 상세 조회
router.get('/notes/detail/:sessionId', async (req, res) => {
  try {
    const sql = `
      SELECT
        s.session_id,
        s.pat_id,
        p.pat_name,
        p.birth_date AS pat_birth,
        p.gender     AS pat_gender,
        s.doctor_opinion AS notes,
        s.stress_idx,
        s.stress_graph_data,
        s.start_dt
      FROM tb_session s
      LEFT JOIN tb_patient p ON p.pat_id = s.pat_id
      WHERE s.session_id = $1
    `
    const result = await conn.query(sql, [req.params.sessionId])
    if (result.rows.length === 0) return res.json(null)

    const row = result.rows[0]
    let graphData = {}
    try { graphData = JSON.parse(row.stress_graph_data || '{}') } catch {}

    res.json({
      ...row,
      stress_total: row.stress_idx || 0,
      stress_peak:  graphData.peak  || row.stress_idx || 0,
    })
  } catch (err) {
    console.error('세션 상세 조회 실패:', err.message)
    res.status(500).json({ error: '조회 실패', detail: err.message })
  }
})

// GET /api/notes/:patientId - 최근 세션 소견 조회
router.get('/notes/:patientId', async (req, res) => {
  try {
    const sql = `
      SELECT session_id, pat_id, doctor_opinion AS notes,
             stress_idx, stress_graph_data, start_dt
      FROM tb_session
      WHERE pat_id = $1
      ORDER BY start_dt DESC NULLS LAST
      LIMIT 1
    `
    const result = await conn.query(sql, [req.params.patientId])
    if (result.rows.length === 0) return res.json(null)

    const row = result.rows[0]
    let graphData = {}
    try { graphData = JSON.parse(row.stress_graph_data || '{}') } catch {}

    res.json({
      ...row,
      stress_total: row.stress_idx || 0,
      stress_peak:  graphData.peak  || row.stress_idx || 0,
    })
  } catch (err) {
    console.error('소견 조회 실패:', err.message)
    res.status(500).json({ error: '소견 조회 실패', detail: err.message })
  }
})

// POST /api/notes - 세션/소견 저장
router.post('/notes', async (req, res) => {
  const { session_id, pat_id, notes, stress_total, stress_peak } = req.body
  if (!pat_id) return res.status(400).json({ error: 'pat_id 필수' })

  const sid = session_id || Date.now()
  const graphData = JSON.stringify({ total: stress_total || 0, peak: stress_peak || 0 })

  try {
    // pat_id가 tb_patient에 실제로 존재하는지 확인
    const patCheck = await conn.query('SELECT pat_id FROM tb_patient WHERE pat_id = $1', [pat_id])
    if (patCheck.rows.length === 0) {
      console.error(`세션 저장 실패: pat_id="${pat_id}" 가 tb_patient에 없음`)
      return res.status(400).json({ error: `환자(${pat_id})가 DB에 없습니다. 환자 등록 후 다시 시도하세요.` })
    }

    // 세션이 이미 있으면 UPDATE, 없으면 INSERT
    const existing = await conn.query(
      'SELECT session_id FROM tb_session WHERE session_id = $1',
      [sid]
    )

    if (existing.rows.length > 0) {
      await conn.query(
        `UPDATE tb_session
         SET doctor_opinion = $1, stress_idx = $2, stress_graph_data = $3, end_dt = NOW()
         WHERE session_id = $4`,
        [notes || '', stress_total || 0, graphData, sid]
      )
    } else {
      await conn.query(
        `INSERT INTO tb_session
           (session_id, pat_id, start_dt, end_dt, stt_text, doctor_opinion, stress_idx, stress_graph_data)
         VALUES ($1, $2, NOW(), NOW(), '', $3, $4, $5)`,
        [sid, pat_id, notes || '', stress_total || 0, graphData]
      )
    }

    res.status(201).json({ session_id: sid, pat_id, stress_total, stress_peak })
  } catch (err) {
    console.error('세션 저장 실패:', err.message)
    res.status(500).json({ error: '세션 저장 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  환자 히스토리 API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/history/:patientId - 방문 히스토리 목록
router.get('/history/:patientId', async (req, res) => {
  try {
    const sql = `
      SELECT
        s.session_id                              AS visit_id,
        TO_CHAR(s.start_dt, 'YYYY-MM-DD')        AS visit_date,
        s.doctor_opinion                          AS notes,
        s.stress_idx                              AS stress_total,
        s.stress_graph_data,
        p.med_history                             AS diagnosis
      FROM tb_session s
      LEFT JOIN tb_patient p ON p.pat_id = s.pat_id
      WHERE s.pat_id = $1
      ORDER BY s.start_dt DESC NULLS LAST
      LIMIT 20
    `
    const result = await conn.query(sql, [req.params.patientId])
    const visits = result.rows.map(row => {
      let graphData = {}
      try { graphData = JSON.parse(row.stress_graph_data || '{}') } catch {}
      return {
        ...row,
        stress_peak: graphData.peak || row.stress_total || 0,
        hrv_avg:     45,
      }
    })
    res.json(visits)
  } catch (err) {
    console.error('히스토리 조회 실패:', err.message)
    res.status(500).json({ error: '히스토리 조회 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  최근 진료 완료 환자 (스케줄 히스토리 사이드바)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/recent-visits', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT ON (s.pat_id)
        s.session_id,
        s.pat_id,
        p.pat_name,
        TO_CHAR(s.start_dt, 'MM/DD') AS visit_date,
        s.start_dt
      FROM tb_session s
      LEFT JOIN tb_patient p ON p.pat_id = s.pat_id
      ORDER BY s.pat_id, s.start_dt DESC NULLS LAST
    `
    const result = await conn.query(sql)
    const now = new Date()

    const this_week = [], one_week = [], one_month = []
    result.rows.forEach(row => {
      const d = new Date(row.start_dt)
      const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24))
      const entry = {
        note_id:    row.session_id,
        pat_id:     row.pat_id,
        pat_name:   row.pat_name || row.pat_id,
        visit_date: row.visit_date,
      }
      if (diffDays <= 7)       this_week.push(entry)
      else if (diffDays <= 14) one_week.push(entry)
      else if (diffDays <= 30) one_month.push(entry)
    })

    res.json({ this_week, one_week, one_month })
  } catch (err) {
    console.error('최근 진료 조회 실패:', err.message)
    res.status(500).json({ error: '조회 실패', detail: err.message })
  }
})

module.exports = router
