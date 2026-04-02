// 서버를 만들 수 있는 express 프레임워크 모듈 가져오기
const express = require('express');

// express 프레임워크로 서버 생성
// 서버의 정보를 app변수에 저장
const app = express();

// 외부 서버와 통신 허용
const cors = require('cors');
app.use(cors());

// DB 연결 정보 가져오기
// -> DB연결 통로 가져오기
const conn = require('./config/db')

// post -> body 영역 사용
app.use(express.urlencoded({extended:true}))
app.use(express.json())

// http://localhost:3001
app.get('/', (req, res) => {
    console.log("서버접근 확인!");
})

// app.get('/join', (req, res) => {
app.post('/join', (req, res) => {
    // 쿼리스트링으로 받은 데이터 꺼내기 
    // console.log(req.query)
    // let id = req.query.id
    // let pw = req.query.pw
    // let nick = req.query.nick

    let id = req.body.id
    let pw = req.body.pw
    let nick = req.body.nick

    // DB에 저장
    let sql = "insert into member values( ?, ?, ? )"
    conn.query(sql,[id, pw, nick], (err, rows)=>{
        // err : 쿼리문 실행 실패시 이유가 여기에 담겨짐
        // rows : 쿼리문 성공 정보가 담겨짐
        if(err == null){
            // rows.affectedRows : 영향을 받은 행의 개수
            if(rows.affectedRows>0){
                res.send(1)
            }else{
                res.send(0)
            }
        }
    })

    // console.log("서버접근 확인!");
    // res.send("통신성공")
})

// 만들어진 서버를 3001 포트(작업공간)에서 실행시키겠다
app.listen(3001);