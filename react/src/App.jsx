import { Routes, Route, Link } from 'react-router-dom'
import Home from './component/Home'
import Join from './component/Join'
import Login from './component/Login'

function App() {
  return (
    <>
        <Link to = "/">홈</Link>
        <Link to = "/join">회원가입</Link>
        <Link to = "/login">로그인</Link>
        

        <Routes>
          <Route path = "/join" element = {<Join />} />
          <Route path = "/login" element = {<Login />} />
          <Route path = "/" element = {<Home />} />
        </Routes>
    </>
  )
}

export default App
