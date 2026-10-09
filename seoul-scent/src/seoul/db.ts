import { initializeWorkflow } from "./workflow-db.js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "admin" | "brand" | "influencer";
export type User = { id: number; email: string; name: string; role: Role };
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','brand','influencer')),
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT PRIMARY KEY, failures INTEGER NOT NULL, locked_until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES (1);
  `);
  initializeWorkflow(db);
  return db;
}
