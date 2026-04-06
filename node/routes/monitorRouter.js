/**
 * monitorRouter.js
 * 스트레스 모니터링 관련 API 라우터
 * - 환자, RMSSD, 스트레스, 문진, 키워드, 소견, 히스토리
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
      SELECT pat_id, pat_name, pat_birth, pat_gender,
             pat_phone, diagnosis, last_visit
      FROM TB_PATIENT
      ORDER BY last_visit DESC NULLS LAST
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
      SELECT pat_id, pat_name, pat_birth, pat_gender,
             pat_phone, diagnosis, last_visit
      FROM TB_PATIENT
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

// POST /api/patients - 환자 등록
router.post('/patients', async (req, res) => {
  const { pat_id, pat_name, pat_birth, pat_gender, pat_phone, diagnosis } = req.body
  if (!pat_id || !pat_name) {
    return res.status(400).json({ error: 'pat_id, pat_name 필수' })
  }
  try {
    const sql = `
      INSERT INTO TB_PATIENT (pat_id, pat_name, pat_birth, pat_gender, pat_phone, diagnosis)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (pat_id) DO UPDATE
        SET pat_name = EXCLUDED.pat_name,
            pat_birth = EXCLUDED.pat_birth,
            pat_gender = EXCLUDED.pat_gender,
            pat_phone = EXCLUDED.pat_phone,
            diagnosis = EXCLUDED.diagnosis
      RETURNING *
    `
    const result = await conn.query(sql, [pat_id, pat_name, pat_birth, pat_gender, pat_phone, diagnosis])
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('환자 등록 실패:', err.message)
    res.status(500).json({ error: '환자 등록 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RMSSD 데이터 API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/rmssd/:patientId - 최근 RMSSD 데이터 (최근 60개)
router.get('/rmssd/:patientId', async (req, res) => {
  try {
    const sql = `
      SELECT rmssd_value, measured_at
      FROM TB_RMSSD
      WHERE pat_id = $1
      ORDER BY measured_at DESC
      LIMIT 60
    `
    const result = await conn.query(sql, [req.params.patientId])
    res.json(result.rows.reverse())
  } catch (err) {
    console.error('RMSSD 조회 실패:', err.message)
    res.status(500).json({ error: 'RMSSD 조회 실패', detail: err.message })
  }
})

// POST /api/rmssd - RMSSD 데이터 저장 (FastAPI 또는 센서에서 호출)
router.post('/rmssd', async (req, res) => {
  const { pat_id, session_id, rmssd_value } = req.body
  if (!pat_id || rmssd_value === undefined) {
    return res.status(400).json({ error: 'pat_id, rmssd_value 필수' })
  }
  try {
    const sql = `
      INSERT INTO TB_RMSSD (pat_id, session_id, rmssd_value, measured_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *
    `
    const result = await conn.query(sql, [pat_id, session_id, rmssd_value])
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('RMSSD 저장 실패:', err.message)
    res.status(500).json({ error: 'RMSSD 저장 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  사전문진 API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /api/questionnaire - 문진 결과 저장 + 임계치 계산
router.post('/questionnaire', async (req, res) => {
  const {
    pat_id, chiefComplaint, sleepQuality, anxietyLevel,
    recentStressEvent, stressEventDesc, currentMedication,
    phq9, gad7, stress_score, threshold
  } = req.body

  if (!pat_id) return res.status(400).json({ error: 'pat_id 필수' })

  try {
    const sql = `
      INSERT INTO TB_QUESTIONNAIRE (
        pat_id, chief_complaint, sleep_quality, anxiety_level,
        recent_stress_event, stress_event_desc, current_medication,
        phq9_score, gad7_score, stress_score, threshold, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      RETURNING *
    `
    const result = await conn.query(sql, [
      pat_id, chiefComplaint, sleepQuality, anxietyLevel,
      recentStressEvent, stressEventDesc, currentMedication,
      phq9, gad7, stress_score, threshold
    ])

    // 환자 테이블의 threshold 업데이트
    await conn.query(
      'UPDATE TB_PATIENT SET stress_threshold = $1 WHERE pat_id = $2',
      [threshold, pat_id]
    )

    res.status(201).json({ ...result.rows[0], threshold })
  } catch (err) {
    console.error('문진 저장 실패:', err.message)
    res.status(500).json({ error: '문진 저장 실패', detail: err.message })
  }
})

// GET /api/questionnaire/:patientId - 최근 문진 결과 조회
router.get('/questionnaire/:patientId', async (req, res) => {
  try {
    const sql = `
      SELECT * FROM TB_QUESTIONNAIRE
      WHERE pat_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `
    const result = await conn.query(sql, [req.params.patientId])
    res.json(result.rows[0] || null)
  } catch (err) {
    console.error('문진 조회 실패:', err.message)
    res.status(500).json({ error: '문진 조회 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  키워드 API (Clova Speech API 결과 저장/조회)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/keywords/:patientId - 환자의 키워드 목록
router.get('/keywords/:patientId', async (req, res) => {
  try {
    const sql = `
      SELECT keyword_id AS id, keyword AS word, is_high_stress AS "stressHigh",
             summary, extracted_at
      FROM TB_KEYWORD
      WHERE pat_id = $1
      ORDER BY extracted_at DESC
      LIMIT 20
    `
    const result = await conn.query(sql, [req.params.patientId])
    res.json(result.rows)
  } catch (err) {
    console.error('키워드 조회 실패:', err.message)
    res.status(500).json({ error: '키워드 조회 실패', detail: err.message })
  }
})

// POST /api/keywords - 키워드 저장 (Clova Speech 결과)
router.post('/keywords', async (req, res) => {
  const { pat_id, session_id, keyword, is_high_stress, summary } = req.body
  if (!pat_id || !keyword) {
    return res.status(400).json({ error: 'pat_id, keyword 필수' })
  }
  try {
    const sql = `
      INSERT INTO TB_KEYWORD (pat_id, session_id, keyword, is_high_stress, summary, extracted_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING keyword_id AS id, keyword AS word, is_high_stress AS "stressHigh", summary
    `
    const result = await conn.query(sql, [pat_id, session_id, keyword, is_high_stress || false, summary || ''])
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('키워드 저장 실패:', err.message)
    res.status(500).json({ error: '키워드 저장 실패', detail: err.message })
  }
})

// GET /api/keywords/:id/summary - 키워드 발화 요약 조회
router.get('/keywords/:id/summary', async (req, res) => {
  try {
    const sql = `
      SELECT keyword AS word, summary, extracted_at
      FROM TB_KEYWORD
      WHERE keyword_id = $1
    `
    const result = await conn.query(sql, [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '키워드를 찾을 수 없습니다.' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('키워드 요약 조회 실패:', err.message)
    res.status(500).json({ error: '키워드 요약 조회 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  의사 소견 API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/notes/:patientId - 최근 소견 조회
router.get('/notes/:patientId', async (req, res) => {
  try {
    const sql = `
      SELECT note_id, pat_id, notes, stress_total, stress_peak,
             session_duration, created_at
      FROM TB_DOCTOR_NOTE
      WHERE pat_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `
    const result = await conn.query(sql, [req.params.patientId])
    res.json(result.rows[0] || null)
  } catch (err) {
    console.error('소견 조회 실패:', err.message)
    res.status(500).json({ error: '소견 조회 실패', detail: err.message })
  }
})

// POST /api/notes - 소견 저장 (세션 종료 시)
router.post('/notes', async (req, res) => {
  const { pat_id, notes, stress_total, stress_peak, session_duration } = req.body
  if (!pat_id) return res.status(400).json({ error: 'pat_id 필수' })

  try {
    const sql = `
      INSERT INTO TB_DOCTOR_NOTE (pat_id, notes, stress_total, stress_peak, session_duration, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `
    const result = await conn.query(sql, [
      pat_id, notes || '', stress_total || 0, stress_peak || 0, session_duration || 0
    ])

    // 환자의 last_visit 업데이트
    await conn.query(
      'UPDATE TB_PATIENT SET last_visit = CURRENT_DATE WHERE pat_id = $1',
      [pat_id]
    )

    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('소견 저장 실패:', err.message)
    res.status(500).json({ error: '소견 저장 실패', detail: err.message })
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
        n.note_id AS visit_id,
        TO_CHAR(n.created_at, 'YYYY-MM-DD') AS visit_date,
        CONCAT(FLOOR(n.session_duration / 60), '분') AS duration,
        n.stress_total,
        n.stress_peak,
        n.notes,
        q.chief_complaint,
        q.phq9_score AS phq9,
        q.gad7_score AS gad7,
        q.sleep_quality,
        q.anxiety_level,
        q.current_medication AS medication,
        p.diagnosis
      FROM TB_DOCTOR_NOTE n
      LEFT JOIN TB_QUESTIONNAIRE q
        ON q.pat_id = n.pat_id
        AND q.created_at::date = n.created_at::date
      LEFT JOIN TB_PATIENT p ON p.pat_id = n.pat_id
      WHERE n.pat_id = $1
      ORDER BY n.created_at DESC
      LIMIT 20
    `
    const result = await conn.query(sql, [req.params.patientId])

    // 각 방문의 키워드 추가
    const visits = await Promise.all(result.rows.map(async (row) => {
      const kwResult = await conn.query(
        `SELECT keyword FROM TB_KEYWORD
         WHERE pat_id = $1 AND extracted_at::date = $2::date
         LIMIT 10`,
        [req.params.patientId, row.visit_date]
      )
      return {
        ...row,
        keywords: kwResult.rows.map(k => k.keyword),
        hrv_avg: 45, // TODO: TB_RMSSD에서 평균 계산
      }
    }))

    res.json(visits)
  } catch (err) {
    console.error('히스토리 조회 실패:', err.message)
    res.status(500).json({ error: '히스토리 조회 실패', detail: err.message })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  스트레스 데이터 저장 (FastAPI 연동용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /api/stress - 스트레스 수치 저장 (FastAPI → Node)
router.post('/stress', async (req, res) => {
  const { pat_id, session_id, hrv_stress, voice_stress, questionnaire_stress, total_stress } = req.body
  if (!pat_id) return res.status(400).json({ error: 'pat_id 필수' })

  try {
    const sql = `
      INSERT INTO TB_STRESS_LOG (
        pat_id, session_id, hrv_stress, voice_stress,
        questionnaire_stress, total_stress, measured_at
      ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
    `
    const result = await conn.query(sql, [
      pat_id, session_id,
      hrv_stress || 0, voice_stress || 0,
      questionnaire_stress || 0, total_stress || 0
    ])
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('스트레스 저장 실패:', err.message)
    res.status(500).json({ error: '스트레스 저장 실패', detail: err.message })
  }
})

module.exports = router
