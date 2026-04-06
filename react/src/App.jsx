import { Routes, Route, Navigate } from 'react-router-dom'
import Monitor        from './component/Monitor'
import PatientSchedule from './component/PatientSchedule'
import Report         from './component/Report'
import Join           from './component/Join'
import Login          from './component/Login'

function App() {
  return (
    <Routes>
      {/* 인증 */}
      <Route path="/join"  element={<Join />} />
      <Route path="/login" element={<Login />} />

      {/* 환자 스케줄 / 검색 */}
      <Route path="/schedule" element={<PatientSchedule />} />

      {/* 메인 모니터링 대시보드 */}
      <Route path="/monitor/:patientId" element={<Monitor />} />
      <Route path="/monitor"            element={<Monitor />} />

      {/* 결과 레포트 */}
      <Route path="/report/:patientId" element={<Report />} />

      {/* 루트 → 로그인 */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App
