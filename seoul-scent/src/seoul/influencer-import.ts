import ExcelJS from "exceljs";
import { hashPassword } from "./db.js";
import { validateWorkbookArchive } from "./xlsx-safety.js";
import { socialProfileUrl } from "./profile.js";
import { fail, type DB } from "./workflow.js";
export async function readInfluencerWorkbook(buffer: Buffer) {
  validateWorkbookArchive(buffer);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as any);
  } catch {
    fail("엑셀 파일을 읽을 수 없습니다.");
  }
  const sheet = book.worksheets[0];
  if (
    !sheet ||
    sheet.rowCount < 2 ||
    sheet.rowCount > 501 ||
    sheet.columnCount > 30
  )
    fail("1~500명의 응답이 담긴 엑셀 파일을 선택해 주세요.");
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((c, i) =>
    headers.set(
      String(c.text ?? "")
        .trim()
        .toLowerCase(),
      i,
    ),
  );
  const column = (names: string[]) =>
    names.map((n) => headers.get(n.toLowerCase())).find(Boolean);
  const cols = {
    name: column(["Name / 이름", "성함", "이름", "name"]),
    email: column(["Email / 이메일", "이메일", "email"]),
    phone: column(["연락처(Contact number)", "연락처", "phone"]),
    social: column(["Profile URL / 채널 링크", "SNS 프로필 URL", "social_url"]),
    followers: column([
      "Current follower count on this channel / 해당 채널 팔로워 수",
      "팔로워 수",
      "followers",
    ]),
  };
  if (!cols.name || !cols.email) fail("이름과 이메일 열을 찾을 수 없습니다.");
  const rows = [];
  const issues: { row: number; reason: string }[] = [];
  const seen = new Set<string>();
  for (let row = 2; row <= sheet.rowCount; row++) {
    const cell = (col: number | undefined) =>
      col ? String(sheet.getRow(row).getCell(col).text ?? "").trim() : "";
    const name = cell(cols.name),
      email = cell(cols.email).toLowerCase();
    if (!name && !email) continue;
    if (
      name.length < 2 ||
      name.length > 60 ||
      email.length > 254 ||
      !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)
    ) {
      issues.push({ row, reason: "이름 또는 이메일 형식 오류" });
      continue;
    }
    if (seen.has(email)) {
      issues.push({ row, reason: "파일 내 중복 이메일" });
      continue;
    }
    seen.add(email);
    let phone = cell(cols.phone).replace(/^(?:\+82|0082)[ -]?0?/, "0");
    if (/^10\d{8}$/.test(phone)) phone = "0" + phone;
    if (!/^[+0-9 ()-]{8,30}$/.test(phone)) phone = "";
    let social = cell(cols.social);
    if (!social.startsWith("https://"))
      social = "https://" + social.replace(/^http:\/\//, "");
    if (!socialProfileUrl(social)) social = "";
    const raw = cell(cols.followers).replace(/,/g, "").toLowerCase(),
      match = raw.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
    const followers = match
      ? Math.round(
          Number(match[1]) *
            (match[2] === "k" ? 1000 : match[2] === "m" ? 1000000 : 1),
        )
      : 0;
    rows.push({
      row,
      name,
      email,
      phone,
      social,
      followers: followers <= 100_000_000 ? followers : 0,
      needs_profile: !phone || !social || !match,
    });
  }
  return { rows, issues, total: sheet.rowCount - 1 };
}
export async function importInfluencers(
  db: DB,
  buffer: Buffer,
  password: string,
  dryRun = true,
  actor?: number,
) {
  if (
    typeof password !== "string" ||
    password.length < 4 ||
    password.length > 128
  )
    fail("임시 비밀번호는 4~128자로 입력해 주세요.");
  const parsed = await readInfluencerWorkbook(buffer);
  const existing = parsed.rows.filter((r) =>
    db.prepare("SELECT id FROM users WHERE email=?").get(r.email),
  );
  const fresh = parsed.rows.filter((r) => !existing.includes(r));
  if (dryRun)
    return {
      total: parsed.total,
      ready: fresh.length,
      imported: 0,
      existing: existing.length,
      needs_profile: fresh.filter((r) => r.needs_profile).length,
      issues: parsed.issues,
    };
  const hashes = fresh.map((r) => ({ r, hash: hashPassword(password) }));
  return db.transaction(() => {
    let imported = 0,
      skipped = existing.length;
    for (const { r, hash } of hashes) {
      if (db.prepare("SELECT id FROM users WHERE email=?").get(r.email)) {
        skipped++;
        continue;
      }
      const result = db
        .prepare(
          "INSERT INTO users(email,name,phone,role,password_hash,must_change_password) VALUES(?,?,?,'influencer',?,1)",
        )
        .run(r.email, r.name, r.phone, hash);
      db.prepare(
        "UPDATE influencer_profiles SET phone=?,social_url=?,followers=?,import_review_required=? WHERE user_id=?",
      ).run(
        r.phone,
        r.social,
        r.followers,
        r.needs_profile ? 1 : 0,
        result.lastInsertRowid,
      );
      imported++;
    }
    if (actor)
      db.prepare(
        "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
      ).run(
        actor,
        "influencer_import",
        JSON.stringify({
          imported,
          existing: skipped,
          invalid: parsed.issues.length,
        }),
        Date.now(),
      );
    return {
      total: parsed.total,
      ready: fresh.length,
      imported,
      existing: skipped,
      needs_profile: fresh.filter((r) => r.needs_profile).length,
      issues: parsed.issues,
    };
  })();
}
