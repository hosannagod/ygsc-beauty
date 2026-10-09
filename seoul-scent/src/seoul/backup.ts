import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
const source = process.env.DATABASE_PATH || "./data/seoul-scent.db";
if (!existsSync(source)) {
  console.error("백업할 데이터베이스가 없습니다.");
  process.exit(1);
}
const target =
  process.env.BACKUP_PATH ||
  `./data/backups/seoul-scent-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
if (existsSync(target)) {
  console.error("기존 백업을 덮어쓰지 않습니다. 새 경로를 지정해 주세요.");
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
  chmodSync(target, 0o600);
  const copy = new Database(target, { readonly: true, fileMustExist: true });
  try {
    if (copy.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("백업 무결성 검사 실패");
  } finally {
    copy.close();
  }
  console.log(`백업 생성 및 무결성 확인 완료: ${target}`);
} finally {
  db.close();
}
