import React from 'react'
import { useState, useRef } from 'react'
// useRef : 태그를 참조 할 수 있는 변수 생성 기능

const Join = () => {

    const inputIdRef = useRef();
    const inputPwRef = useRef();
    const inputNickRef = useRef();
    
    const tryJoin = () => {
        // 사용자가 입력한 값을 DB에 저장
        // 사용자가 입력한 값 가지고 오기
        let inputId = inputIdRef.current.value
        let inputPw = inputPwRef.current.value
        let inputNick = inputNickRef.current.value // 참조하고 있는 태그를 가져와주세요
        // 얘들을 DB로 넘겨야함 근데 바로 DB로 연결 불가 -> node로 넘기자
    
    }
  return (
    <div>
        <h1>회원가입 페이지</h1>
        ID : <input type = "text" ref ={inputIdRef}></input>
        <br></br>
        PW : <input type = "password" ref ={inputPwRef}></input>
        <br></br>
        NICK : <input type = "text" ref ={inputNickRef}></input>
        <br></br>
        <button onClick = {tryJoin}>회원가입</button>
    </div>
  )
}

export default Join