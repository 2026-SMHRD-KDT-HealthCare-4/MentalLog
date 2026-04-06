-- MentalLog DB Schema
-- PostgreSQL

-- 의사
CREATE TABLE IF NOT EXISTS TB_DOCTOR (
  doc_id        VARCHAR(50)  PRIMARY KEY,
  password      VARCHAR(255) NOT NULL,
  doc_name      VARCHAR(50)  NOT NULL,
  hospital_name VARCHAR(100),
  license_no    VARCHAR(50),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- 환자
CREATE TABLE IF NOT EXISTS TB_PATIENT (
  pat_id           VARCHAR(50)  PRIMARY KEY,
  pat_name         VARCHAR(50)  NOT NULL,
  pat_birth        DATE,
  pat_gender       CHAR(1),
  pat_phone        VARCHAR(20),
  diagnosis        VARCHAR(100),
  stress_threshold INT DEFAULT 70,
  last_visit       DATE,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- RMSSD 측정값
CREATE TABLE IF NOT EXISTS TB_RMSSD (
  rmssd_id    SERIAL PRIMARY KEY,
  pat_id      VARCHAR(50) REFERENCES TB_PATIENT(pat_id),
  session_id  VARCHAR(100),
  rmssd_value NUMERIC(6,2) NOT NULL,
  measured_at TIMESTAMP DEFAULT NOW()
);

-- 스트레스 로그 (종합)
CREATE TABLE IF NOT EXISTS TB_STRESS_LOG (
  log_id                SERIAL PRIMARY KEY,
  pat_id                VARCHAR(50) REFERENCES TB_PATIENT(pat_id),
  session_id            VARCHAR(100),
  hrv_stress            INT DEFAULT 0,
  voice_stress          INT DEFAULT 0,
  questionnaire_stress  INT DEFAULT 0,
  total_stress          INT DEFAULT 0,
  measured_at           TIMESTAMP DEFAULT NOW()
);

-- 사전문진
CREATE TABLE IF NOT EXISTS TB_QUESTIONNAIRE (
  q_id                SERIAL PRIMARY KEY,
  pat_id              VARCHAR(50) REFERENCES TB_PATIENT(pat_id),
  chief_complaint     TEXT,
  sleep_quality       INT,
  anxiety_level       INT,
  recent_stress_event BOOLEAN DEFAULT FALSE,
  stress_event_desc   TEXT,
  current_medication  VARCHAR(200),
  phq9_score          INT,
  gad7_score          INT,
  stress_score        INT,
  threshold           INT,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- 음성 키워드 (Clova Speech API 결과)
CREATE TABLE IF NOT EXISTS TB_KEYWORD (
  keyword_id    SERIAL PRIMARY KEY,
  pat_id        VARCHAR(50) REFERENCES TB_PATIENT(pat_id),
  session_id    VARCHAR(100),
  keyword       VARCHAR(100) NOT NULL,
  is_high_stress BOOLEAN DEFAULT FALSE,
  summary       TEXT,
  extracted_at  TIMESTAMP DEFAULT NOW()
);

-- 의사 소견
CREATE TABLE IF NOT EXISTS TB_DOCTOR_NOTE (
  note_id          SERIAL PRIMARY KEY,
  pat_id           VARCHAR(50) REFERENCES TB_PATIENT(pat_id),
  notes            TEXT,
  stress_total     INT DEFAULT 0,
  stress_peak      INT DEFAULT 0,
  session_duration INT DEFAULT 0,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_rmssd_pat     ON TB_RMSSD(pat_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_stress_pat    ON TB_STRESS_LOG(pat_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_pat   ON TB_KEYWORD(pat_id, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_pat      ON TB_DOCTOR_NOTE(pat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quest_pat     ON TB_QUESTIONNAIRE(pat_id, created_at DESC);
