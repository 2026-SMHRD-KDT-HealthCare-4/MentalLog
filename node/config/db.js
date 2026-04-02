// DB에 연결할 때마다 호출되는 연결정보 코드 작성 공간
const { Pool } = require("pg");

// 1. DB 연결정보를 작성하기
const conn = new Pool({
    host : "project-db-campus.smhrd.com",
    port : 3310,
    user : "campus_25kdt_ha4_p2_3",
    password : "smhrd3",
    database : "campus_25kdt_ha4_p2_3"
})

// 2. 연결 확인 코드 추가
conn.connect((err, client, release) => {
    if(err){
        console.log("DB 연결 실패", err);
    }else{
        console.log("DB 연결 성공");
        release();
    }
})


// 3. 연결정보를 수출
module.exports = conn;
