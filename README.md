# MentalLog - 실시간 스트레스 모니터링 시스템

> 정신과 상담을 위한 멀티모달 실시간 스트레스 분석 플랫폼

---

## 프로젝트 개요

**MentalLog**는 정신과 상담 세션 중 환자의 스트레스 상태를 실시간으로 정량화하여 의사에게 제공하는 임상 보조 시스템입니다.

HRV(심박 변이도), 음성 감정 분석, 사전 설문(PSS)의 세 가지 모달리티를 융합한 **멀티모달 스트레스 지수**를 산출하며, 상담 종료 후 리포트를 통해 세션 전반의 스트레스 변화 추이와 핵심 발화 키워드를 확인할 수 있습니다.

### 스트레스 산출 공식

```
통합 스트레스 지수 = HRV 스트레스 × 48.6% + 음성 스트레스 × 33.3% + PSS 점수 × 18.1%
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **실시간 HRV 모니터링** | ECG 신호에서 1초 단위 RMSSD, HR, pNN50, SD1 추출 및 시각화 |
| **음성 감정 분석** | 1분 단위 마이크 녹음 → 화자분리 → 환자 발화 추출 → 스트레스 점수 산출 |
| **멀티모달 스트레스 지수** | HRV + 음성 + PSS 가중 합산을 통한 통합 스트레스 점수 제공 |
| **개인화 베이스라인** | 세션 초반 1분 RMSSD를 기준으로 개인별 스트레스 임계치 자동 설정 |
| **의사 화자 캘리브레이션** | 의사 목소리를 등록하여 환자 발화만 선택적으로 분석 |
| **키워드 실시간 추출** | 환자 발화에서 핵심 명사 키워드 추출 및 시간대별 표시 |
| **세션 리포트** | 스트레스 추이 차트, 키워드 타임라인, 의사 소견을 포함한 진단 보고서 생성 |
| **환자 방문 히스토리** | 이전 세션 기록 조회 및 비교 |

---

## 기술 스택

### Frontend
- **React 19** + Vite
- **React Router DOM v7** - 페이지 라우팅
- **Recharts** - HRV 실시간 차트
- **Axios** - HTTP 통신

### Backend (Node.js)
- **Express 5** - REST API 서버
- **PostgreSQL** (pg 드라이버) - 환자/세션 데이터 영구 저장
- **dotenv** - 환경변수 관리

### ML/분석 서버 (Python)
- **FastAPI** + Uvicorn - 비동기 API 서버
- **NeuroKit2** - ECG 신호 처리 및 HRV 지표 계산
- **SHAP** + XGBoost - HRV 기반 스트레스 분류 모델 해석
- **librosa** - 음성 특성(MFCC) 추출
- **scikit-learn** - 음성 스트레스 Random Forest 모델
- **KoTE** - 한국어 텍스트 감정 분류
- **kiwipiepy** - 한국어 형태소 분석 (키워드 추출)
- **sounddevice** - 실시간 마이크 녹음
- **ReturnZero STT** - 화자분리 지원 음성인식 API

### 외부 서비스
- **Firebase Storage** - 세션 종료 후 HRV 그래프 이미지 저장
- **네이버 클로바 Speech** - 음성 → 텍스트 변환 (보조)

### 데이터베이스 스키마 (PostgreSQL)
| 테이블 | 설명 |
|--------|------|
| `tb_doctor` | 의사 계정 정보 |
| `tb_patient` | 환자 기본 정보 |
| `tb_session` | 상담 세션 (소견, 그래프 URL) |
| `tb_hrv_data` | 세션별 RMSSD 측정 이력 |
| `tb_questionnaire` | PSS 사전 문진 결과 |

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     React (포트 5173)                        │
│  로그인 / 환자 스케줄 / 실시간 모니터링 / 진단 리포트       │
└──────────────┬──────────────────────────┬───────────────────┘
               │ REST API                 │ REST API
               ▼                          ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│  Node.js (포트 3001)  │    │  Python FastAPI (포트 8000)  │
│  - 의사/환자 CRUD     │    │  - ECG → HRV 계산            │
│  - 세션/소견 저장     │◄───│  - SHAP/XGBoost ML 모델      │
│  - 음성 결과 수신     │    │  - Firebase 그래프 업로드     │
│  - 히스토리 조회     │    │  - 음성 파이프라인 제어       │
└──────────┬───────────┘    └──────────────┬───────────────┘
           │                               │ 서브프로세스
           ▼                               ▼
┌─────────────────────┐    ┌──────────────────────────────┐
│  PostgreSQL DB       │    │  Python FastAPI (포트 8001)  │
│  - 환자/세션 데이터  │    │  - 마이크 실시간 녹음         │
│  - HRV 측정 이력    │    │  - ReturnZero STT + 화자분리  │
└─────────────────────┘    │  - 음성 ML (KoTE + RF)       │
                           │  - 키워드 추출                │
┌─────────────────────┐    └──────────────────────────────┘
│  Firebase Storage   │◄─── Python HRV 그래프 업로드
│  - RMSSD 차트 이미지│
└─────────────────────┘
```

### 데이터 흐름

```
ECG 데이터(S2.pkl)
    │
    ▼ 1초마다 슬라이딩 윈도우
React ──→ POST /generate-metrics ──→ Python
    ◄── realtime_rmssd, hr, ml_result ──

마이크 (백그라운드)
    │ 1분 단위 녹음
    ▼
ReturnZero STT + 화자분리
    │ 환자 발화만 추출
    ▼
KoTE 감정분류 → RF Regressor → 음성 스트레스 점수
    │
    ▼ 키워드 추출 (kiwipiepy)
Node /api/voice-stress ──→ 인메모리 저장
    ◄── React 30초 폴링

최종 통합:
HRV × 0.486 + 음성 × 0.333 + PSS × 0.181 = 통합 스트레스 지수
```

---

## 폴더 구조

```
mental/
├── node/                          # Node.js Express 백엔드 (포트 3001)
│   ├── server.js                  # 메인 서버 진입점
│   ├── config/
│   │   ├── db.js                  # PostgreSQL 연결 풀
│   │   └── schema.sql             # 데이터베이스 스키마 정의
│   ├── routes/
│   │   └── monitorRouter.js       # 모니터링/스트레스 데이터 라우터
│   ├── .env                       # 환경변수 (DB 접속 정보 등)
│   └── package.json
│
├── python/                        # Python 분석 서버
│   ├── hrv_main.py                # HRV FastAPI 서버 (포트 8000)
│   ├── voice_main.py              # 음성 분석 FastAPI 서버 (포트 8001)
│   ├── voice_pipeline.py          # 실시간 음성 파이프라인
│   ├── stress_main.py             # 통합 스트레스 계산 모듈
│   ├── config.py                  # CORS 등 공통 설정
│   ├── S2.pkl                     # ECG 샘플 데이터 (700Hz)
│   ├── stress_bundle.pkl          # HRV ML 모델 (SHAP + XGBoost)
│   ├── voice_stress_model.pkl     # 음성 ML 모델 (RF Regressor)
│   ├── label_encoder.pkl          # MFCC 레이블 인코더
│   ├── requirements.txt           # Python 의존성
│   └── .env                       # 환경변수 (API 키 등)
│
├── react/                         # React 프론트엔드 (포트 5173)
│   ├── src/
│   │   ├── component/
│   │   │   ├── Monitor.jsx        # 실시간 모니터링 대시보드
│   │   │   ├── Report.jsx         # 진단 결과 리포트
│   │   │   ├── PatientSchedule.jsx # 환자 스케줄 관리
│   │   │   ├── PatientList.jsx    # 환자 목록
│   │   │   ├── PatientHistory.jsx # 환자 방문 히스토리
│   │   │   ├── Login.jsx          # 로그인
│   │   │   ├── Join.jsx           # 회원가입
│   │   │   ├── DoctorProfile.jsx  # 의사 프로필 조회
│   │   │   └── DoctorProfileEdit.jsx # 의사 프로필 수정
│   │   ├── styles/
│   │   │   └── monitor.css        # 전체 스타일
│   │   ├── utils/
│   │   │   └── stressUtils.js     # 스트레스 레벨 색상 분류
│   │   ├── App.jsx                # 라우팅 설정
│   │   └── main.jsx               # React 진입점
│   ├── .env                       # 환경변수 (API URL 등)
│   └── package.json
│
├── start.bat                      # 3개 서버 동시 실행 스크립트
└── README.md
```

---

## 설치 및 실행 방법

### 사전 요구사항

- **Node.js** v18 이상
- **Python** 3.10 이상
- **PostgreSQL** 설치 및 실행 중
- **마이크** 연결 (음성 분석 기능 사용 시)

---

### 1. 저장소 클론

```bash
git clone <repository-url>
cd mental
```

---

### 2. Node.js 백엔드 설치

```bash
cd node
npm install
```

---

### 3. Python 서버 설치

```bash
cd python

# 가상환경 생성 (권장)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# 의존성 설치
pip install -r requirements.txt
```

> **주의**: `kiwipiepy`, `librosa`, `neurokit2` 등은 설치 시간이 다소 소요될 수 있습니다.

---

### 4. React 프론트엔드 설치

```bash
cd react
npm install
```

---

### 5. 데이터베이스 초기화

PostgreSQL에 접속하여 스키마를 생성합니다.

```bash
psql -U <username> -d <database_name> -f node/config/schema.sql
```

---

### 6. 전체 서버 실행

루트 디렉토리에서 배치 파일을 실행하면 세 서버가 동시에 실행됩니다.

```batch
start.bat
```

또는 각 서버를 개별적으로 실행합니다.

```bash
# 터미널 1 - React (포트 5173)
cd react && npm run dev

# 터미널 2 - Node.js (포트 3001)
cd node && node server.js

# 터미널 3 - Python HRV 서버 (포트 8000, 음성 파이프라인 포함)
cd python && python hrv_main.py
```

---

## 환경변수 설정

> **보안 주의**: `.env` 파일에는 API 키, DB 비밀번호 등 민감한 정보가 포함됩니다.  
> `.env` 파일은 절대 Git에 커밋하지 마세요. `.gitignore`에 반드시 포함되어야 합니다.

### node/.env

```env
# PostgreSQL 데이터베이스 접속 정보
DB_HOST=localhost
DB_PORT=5432
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_database_name

# 서버 포트
PORT=3001
```

### python/.env

```env
# ReturnZero STT API (화자분리 지원 음성인식)
RTZR_CLIENT_ID=your_returnzero_client_id
RTZR_CLIENT_SECRET=your_returnzero_client_secret

# 네이버 클로바 Speech API (보조 STT)
CLOVA_API_KEY=your_clova_api_key
CLOVA_INVOKE_URL=your_clova_invoke_url

# Node.js 백엔드 URL
NODE_API_URL=http://localhost:3001

# Firebase 서비스 계정 키 파일 경로
FIREBASE_CREDENTIAL_PATH=./your-firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
```

### react/.env

```env
# API 서버 URL
VITE_NODE_API_URL=http://localhost:3001
VITE_PYTHON_API_URL=http://localhost:8000
```

### Firebase 설정

1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트 생성
2. **Storage** 활성화
3. **프로젝트 설정 > 서비스 계정**에서 JSON 키 파일 다운로드
4. 다운로드한 파일을 `python/` 폴더에 위치시키고 `FIREBASE_CREDENTIAL_PATH` 환경변수에 경로 설정

---

## 사용 방법

### 1. 회원가입 / 로그인

- `/join` 페이지에서 의사 계정을 생성합니다.
- `/login` 페이지에서 로그인 후 세션이 시작됩니다.

### 2. 환자 스케줄 확인

- 로그인 후 환자 스케줄 페이지(`/schedule`)에서 당일 예약 환자 목록을 확인합니다.
- 환자 카드를 클릭하면 모니터링 화면으로 이동합니다.

### 3. 실시간 모니터링 세션

모니터링 화면(`/monitor/:patientId`)에서 아래 순서로 진행합니다.

```
① 세션 시작  →  ② 베이스라인 측정 (1분 대기)
     ↓
③ [선택] 의사 캘리브레이션 (4초 녹음으로 의사 음성 등록)
     ↓
④ PSS 사전 설문 점수 입력 (0~40점)
     ↓
⑤ 실시간 RMSSD 차트, 스트레스 지수, 키워드 확인
     ↓
⑥ 의사 소견 작성
     ↓
⑦ 진단 완료 → 리포트 페이지로 이동
```

#### 화면 구성

| 영역 | 내용 |
|------|------|
| 상단 | 현재 HR, RMSSD, 스트레스 레벨 (낮음/보통/높음) |
| 중앙 차트 | 실시간 RMSSD 추이 그래프 |
| 우측 | 분당 통합 스트레스 지수, 음성 키워드 |
| 하단 | 의사 소견 입력란, 진단 완료 버튼 |

### 4. 진단 리포트 확인

리포트 화면(`/report/:patientId`)에서 세션 전체 요약을 확인합니다.

- **스트레스 원형 게이지**: 평균/최고/임계치 비교
- **HRV 추이 차트**: 세션 전체 RMSSD 변화
- **키워드 타임라인**: 시간대별 핵심 발화 키워드
- **주요 상황 요약**: 스트레스가 높았던 구간 자동 요약
- **의사 소견**: 작성된 소견 확인

### 5. 환자 히스토리

`/history/:patientId` 에서 환자의 이전 방문 기록과 소견을 조회합니다.

---

## API 엔드포인트 요약

### Node.js (포트 3001)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/join` | 의사 회원가입 |
| POST | `/login` | 의사 로그인 |
| GET/PUT | `/api/doctor/:doc_id` | 의사 프로필 조회/수정 |
| GET/POST | `/api/patients` | 환자 목록 조회/등록 |
| POST | `/api/questionnaire` | PSS 문진 저장 |
| GET | `/api/questionnaire/:patientId` | PSS 점수 조회 |
| POST | `/api/notes` | 의사 소견 저장 |
| GET | `/api/hrv/:sessionId` | HRV 데이터 조회 |
| GET | `/api/history/:patientId` | 환자 방문 히스토리 |
| POST | `/api/voice-stress` | 음성 분석 결과 수신 |
| GET | `/api/voice-stress/:sessionId` | 음성 분석 결과 조회 |
| GET | `/api/recent-visits` | 최근 진료 완료 환자 |

### Python FastAPI (포트 8000)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/generate-metrics` | HRV 메트릭 실시간 계산 |
| POST | `/reset-baseline` | 베이스라인 초기화 |
| POST | `/upload-graph` | RMSSD 그래프 Firebase 업로드 |
| POST | `/start-voice` | 음성 파이프라인 시작 |
| POST | `/stop-voice` | 음성 파이프라인 중지 |
| POST | `/update-voice` | 임계치 실시간 업데이트 |
| POST | `/api/calibrate` | 의사 화자 캘리브레이션 |
| POST | `/api/reset-calibration` | 캘리브레이션 초기화 |

---

## 라이선스

본 프로젝트는 교육 및 연구 목적으로 개발되었습니다.
# MentalLog

## 기술스택 
<!-- Frontend -->
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![CSS Modules](https://img.shields.io/badge/CSS_Modules-000000?style=for-the-badge&logo=css3&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts-22B5BF?style=for-the-badge&logo=react&logoColor=white)
![Axios](https://img.shields.io/badge/Axios-5A29E4?style=for-the-badge&logo=axios&logoColor=white)

<!-- Backend -->
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![sounddevice](https://img.shields.io/badge/sounddevice-3776AB?style=for-the-badge&logo=python&logoColor=white)
![kiwipiepy](https://img.shields.io/badge/kiwipiepy-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Matplotlib](https://img.shields.io/badge/Matplotlib-11557C?style=for-the-badge&logo=python&logoColor=white)

<!-- Database -->
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

<!-- ML/AI -->
![scikit-learn](https://img.shields.io/badge/scikit--learn-F7931E?style=for-the-badge&logo=scikitlearn&logoColor=white)
![HuggingFace](https://img.shields.io/badge/HuggingFace-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)

<!-- API -->
![Firebase](https://img.shields.io/badge/Firebase_Storage-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![ReturnZero](https://img.shields.io/badge/ReturnZero_API-FF4B4B?style=for-the-badge&logoColor=white)

<!-- Tools -->
![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)
![Notion](https://img.shields.io/badge/Notion-000000?style=for-the-badge&logo=notion&logoColor=white)
![Figma](https://img.shields.io/badge/Figma-F24E1E?style=for-the-badge&logo=figma&logoColor=white)
![Miro](https://img.shields.io/badge/Miro-FFD02F?style=for-the-badge&logo=miro&logoColor=black)
<<<<<<< HEAD
=======

>>>>>>> 85c009269f52d651eec490f9e413b346146463e9
