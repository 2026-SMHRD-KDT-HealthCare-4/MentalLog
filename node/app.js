const express = require("express");
const app = express();

app.use(express.static("public"));
// post 방식
app.use(express.urlencoded({extended : true}));

// EJS 사용할때
app.set("view engine", "ejs");
app.set("views", __dirname+"/views");

app.listen(3000);