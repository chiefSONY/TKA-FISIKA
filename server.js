import express from "express";
import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import cookieParser from "cookie-parser";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=process.env.PORT||3000;
const db=new Database(path.join(__dirname,"exam.db"));
db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS attempts(
 id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL,
 username TEXT NOT NULL,name TEXT,kelas TEXT,absen TEXT,sekolah TEXT,
 started_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL,submitted_at INTEGER,
 score INTEGER,status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS answers(id INTEGER PRIMARY KEY AUTOINCREMENT,
 attempt_id INTEGER NOT NULL,question_id INTEGER NOT NULL,answer TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,
 attempt_id INTEGER,action TEXT,created_at INTEGER);`);

const QUESTIONS=JSON.parse(fs.readFileSync(path.join(__dirname,"questions.json"),"utf8"));
const DURATION=30*60*1000;

app.use(helmet({contentSecurityPolicy:false}));
app.use(cookieParser());
app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"public")));

const clean=s=>String(s||"").trim().slice(0,100);
const norm=a=>Array.isArray(a)?[...a].sort().join(","):String(a||"");
function getAttempt(req){const t=req.cookies.tka_attempt;return t?db.prepare("SELECT * FROM attempts WHERE token=?").get(t):null}
function cookie(res,t){res.cookie("tka_attempt",t,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:DURATION+3600000,path:"/"})}
function calculate(a){
 const rows=db.prepare("SELECT question_id,answer FROM answers WHERE attempt_id=?").all(a.id);let s=0;
 for(const q of QUESTIONS){const r=rows.find(x=>x.question_id===q.id);if(r&&norm(JSON.parse(r.answer))===norm(q.answer))s++}
 return s;
}
app.get("/api/questions",(req,res)=>res.json({durationSeconds:1800,questions:QUESTIONS.map(q=>{
 const x={id:q.id,topic:q.topic,type:q.type,stimulus:q.stimulus,question:q.question};
 if(q.type==="Benar-Salah")x.statements=q.statements.map(s=>s[0]);else x.options=q.options;return x;
})}));

app.post("/api/start",(req,res)=>{
 const name=clean(req.body.name),kelas=clean(req.body.kelas),absen=clean(req.body.absen),sekolah=clean(req.body.sekolah);
 if(!name||!kelas||!absen||!sekolah)return res.status(400).json({error:"Nama, kelas, nomor absen, dan asal sekolah wajib diisi."});
 const username=`${name}-${kelas}-${absen}-${sekolah}`.replace(/\s+/g,"-");
 const active=db.prepare("SELECT * FROM attempts WHERE username=? AND status='active' AND deadline_at>? ORDER BY id DESC LIMIT 1").get(username,Date.now());
 if(active){cookie(res,active.token);return res.json({attemptId:active.id,deadlineAt:active.deadline_at,username:active.username,resumed:true})}
 const token=crypto.randomBytes(32).toString("hex"),now=Date.now(),deadline=now+DURATION;
 const info=db.prepare("INSERT INTO attempts(token,username,name,kelas,absen,sekolah,started_at,deadline_at) VALUES(?,?,?,?,?,?,?,?)").run(token,username,name,kelas,absen,sekolah,now,deadline);
 cookie(res,token);db.prepare("INSERT INTO audit(attempt_id,action,created_at) VALUES(?,?,?)").run(info.lastInsertRowid,"START",now);
 res.json({attemptId:info.lastInsertRowid,deadlineAt:deadline,username});
});

app.get("/api/attempt",(req,res)=>{
 const a=getAttempt(req);if(!a)return res.status(401).json({error:"Belum memulai ujian"});
 if(a.status==="active"&&Date.now()>=a.deadline_at){
   const sc=calculate(a);db.prepare("UPDATE attempts SET status='expired',submitted_at=?,score=? WHERE id=?").run(Date.now(),sc,a.id);a.status="expired";a.score=sc;
 }
 res.json({id:a.id,username:a.username,name:a.name,kelas:a.kelas,absen:a.absen,sekolah:a.sekolah,deadlineAt:a.deadline_at,status:a.status,score:a.score});
});

app.post("/api/save-answer",(req,res)=>{
 const a=getAttempt(req);if(!a)return res.status(401).json({error:"Session tidak ditemukan"});
 if(a.status!=="active")return res.status(409).json({error:"Ujian sudah berakhir"});
 if(Date.now()>=a.deadline_at)return res.status(409).json({error:"Waktu telah habis"});
 const qid=Number(req.body.questionId),answer=Array.isArray(req.body.answer)?req.body.answer:String(req.body.answer||"");
 if(!QUESTIONS.some(q=>q.id===qid))return res.status(400).json({error:"Nomor soal tidak valid"});
 const old=db.prepare("SELECT id FROM answers WHERE attempt_id=? AND question_id=?").get(a.id,qid);
 if(old)db.prepare("UPDATE answers SET answer=? WHERE id=?").run(JSON.stringify(answer),old.id);
 else db.prepare("INSERT INTO answers(attempt_id,question_id,answer) VALUES(?,?,?)").run(a.id,qid,JSON.stringify(answer));
 res.json({ok:true});
});

app.post("/api/submit",(req,res)=>{
 const a=getAttempt(req);if(!a)return res.status(401).json({error:"Session tidak ditemukan"});
 if(a.status!=="active")return res.json({score:a.score,status:a.status});
 const now=Date.now(),sc=calculate(a),status=now>=a.deadline_at?"expired":"submitted";
 db.prepare("UPDATE attempts SET status=?,submitted_at=?,score=? WHERE id=?").run(status,now,sc,a.id);
 db.prepare("INSERT INTO audit(attempt_id,action,created_at) VALUES(?,?,?)").run(a.id,status.toUpperCase(),now);
 res.json({score:sc,status});
});

app.post("/api/unlock",(req,res)=>{
 const a=getAttempt(req);if(!a)return res.status(401).json({error:"Session tidak ditemukan"});
 if(!["submitted","expired"].includes(a.status))return res.status(403).json({error:"Pembahasan belum tersedia"});
 if(String(req.body.password||"").trim()!==String(a.score))return res.status(403).json({error:"Password pembahasan salah"});
 res.json({ok:true,questions:QUESTIONS});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`TKA Online running on port ${PORT}`));
