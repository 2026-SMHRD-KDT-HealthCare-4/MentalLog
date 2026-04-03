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
    let doc_id = req.body.doc_id
    let password = req.body.passward
    let doc_name = req.body.doc_name
    let hospital_name = req.body.hospital_name
    let license_no = req.body.license_no

    // DB에 저장
    let sql = "insert into TB_DOCTOR( doc_id, password, doc_name, hospital_name, license_no )"
    conn.query(sql,[doc_id, password, doc_name, hospital_name, license_no], (err, rows)=>{
        // err : 쿼리문 실행 실패시 이유가 여기에 담겨짐
        // rows : 쿼리문 성공 정보가 담겨짐
        if(err == null){
            // rows.affectedRows : 영향을 받은 행의 개수
            if(rows.rowCount > 0){
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