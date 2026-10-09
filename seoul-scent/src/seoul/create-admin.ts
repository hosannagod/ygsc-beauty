import { openDb, hashPassword } from "./db.js";
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  !password ||
  password.length < 12 ||
  password.length > 128
) {
  console.error(
    "ADMIN_EMAIL과 12~128자 ADMIN_PASSWORD를 환경 변수로 지정해 주세요. 비밀번호를 로그나 저장소에 남기지 마세요.",
  );
  process.exit(1);
}
const db = openDb(process.env.DATABASE_PATH || "./data/seoul-scent.db");
try {
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    throw new Error(
      "이미 존재하는 이메일입니다. 기존 계정의 권한은 변경하지 않습니다.",
    );
  db.prepare(
    "INSERT INTO users (email,name,role,password_hash) VALUES (?,?,?,?)",
  ).run(
    email,
    process.env.ADMIN_NAME || "Seoul Scent 운영자",
    "admin",
    hashPassword(password),
  );
  console.log("운영사 계정이 생성되었습니다.");
} finally {
  db.close();
}
