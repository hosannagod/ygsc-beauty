import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { openDb, hashPassword } from "../src/seoul/db.js";
import {
  archiveProjects,
  importActivities,
  historicalActivities,
  readActivityWorkbook,
} from "../src/seoul/activity-import.js";
import { issueCertificate } from "../src/seoul/certificate.js";
import { createApp } from "../src/seoul/app.js";
import { campaignEligible } from "../src/seoul/onboarding.js";
async function workbook(extra = false) {
  const b = new ExcelJS.Workbook();
  for (const project of archiveProjects) {
    const s = b.addWorksheet(project);
    s.addRow(["이메일", "올린 링크", "제출일시"]);
    s.addRow([
      " CREATOR@example.com ",
      "https://instagram.com/p/first",
      "2026-09-01",
    ]);
    s.addRow([
      "creator@example.com",
      "http://xhslink.com/o/valid",
      "2026-09-02",
    ]);
    s.addRow(["missing@example.com", "https://instagram.com/p/unknown", ""]);
    s.addRow(["brand@example.com", "https://instagram.com/p/brand", ""]);
    s.addRow(["creator@example.com", "javascript:alert(1)", ""]);
    if (extra)
      s.addRow(["creator@example.com", "https://youtube.com/shorts/new", ""]);
  }
  return Buffer.from(await b.xlsx.writeBuffer());
}
test("historical import counts each matched influencer/project once, merges links and includes certificates", async () => {
  const db = openDb(":memory:");
  try {
    const uid = Number(
      db
        .prepare(
          "INSERT INTO users(email,name,role,password_hash) VALUES('creator@example.com','Creator','influencer',?)",
        )
        .run(hashPassword("Strong-password-123!")).lastInsertRowid,
    );

    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('brand@example.com','Brand','brand',?)",
    ).run(hashPassword("Strong-password-123!"));
    const file = await workbook();
    const parsed = await readActivityWorkbook(file);
    assert.equal(parsed.rows, 20);
    assert.equal(parsed.groups.length, 12);
    const preview = await importActivities(db, file);
    assert.equal(preview.ready, 4);
    assert.equal(preview.unmatched.length, 8);
    assert.equal(preview.issues.length, 4);
    assert.equal(historicalActivities(db, uid).length, 0);
    const imported = await importActivities(db, file, false);
    assert.equal(imported.imported, 4);
    let profile = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(uid) as any;
    assert.equal(profile.completed_count, 4);
    assert.equal(profile.onboarding_approved, 0);
    assert.equal(campaignEligible(profile), true);
    assert.equal(profile.tier, 0);
    assert.equal(historicalActivities(db, uid)[0].links.length, 2);
    const certificate = issueCertificate(db, {
      id: uid,
      name: "Creator",
      role: "influencer",
      email: "creator@example.com",
    } as any);
    assert.equal(certificate.completed_count, 4);
    assert.equal(JSON.parse(certificate.activities).length, 4);
    const again = await importActivities(db, await workbook(true), false);
    assert.equal(again.imported, 0);
    assert.equal(again.existing, 4);
    assert.equal(historicalActivities(db, uid)[0].links.length, 3);
    profile = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(uid) as any;
    assert.equal(profile.completed_count, 4);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      2,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM email_outbox").get() as any).n,
      0,
    );
  } finally {
    db.close();
  }
});
test("history import is admin only and requires all four project sheets", async () => {
  const db = openDb(":memory:");
  try {
    const app = createApp(db);
    const file = await workbook();
    assert.equal(
      (
        await app.request("/api/work/admin/activities/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: file.toString("base64") }),
        })
      ).status,
      401,
    );
    const b = new ExcelJS.Workbook();
    b.addWorksheet("Other");
    await assert.rejects(
      readActivityWorkbook(Buffer.from(await b.xlsx.writeBuffer())),
    );
  } finally {
    db.close();
  }
});

test("history can create missing accounts with forced initial password change while preserving existing roles", async () => {
  const db = openDb(":memory:");
  try {
    const b = new ExcelJS.Workbook();
    for (const project of archiveProjects) {
      const s = b.addWorksheet(project);
      s.addRow([
        "이메일",
        "올린 링크",
        "제출일시",
        "인플루언서명",
        "인스타그램/SNS",
      ]);
      s.addRow([
        "new@example.com",
        "https://instagram.com/p/content",
        "",
        "New Creator",
        "https://instagram.com/new",
      ]);
      s.addRow([
        "brand@example.com",
        "https://instagram.com/p/brand",
        "",
        "Brand",
        "",
      ]);
    }
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('brand@example.com','Brand','brand','untouched')",
    ).run();
    const file = Buffer.from(await b.xlsx.writeBuffer()),
      options = { createMissing: true, password: "0000" };
    const preview = await importActivities(db, file, true, undefined, options);
    assert.equal(preview.new_accounts.length, 1);
    assert.equal(preview.ready, 4);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      1,
    );
    const result = await importActivities(db, file, false, undefined, options);
    assert.equal(result.accounts_created, 1);
    assert.equal(result.imported, 4);
    assert.equal(result.unmatched.length, 4);
    const user = db
      .prepare("SELECT * FROM users WHERE email='new@example.com'")
      .get() as any;
    assert.equal(user.must_change_password, 1);
    const { verifyPassword } = await import("../src/seoul/db.js");
    assert.ok(verifyPassword("0000", user.password_hash));
    const p = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(user.id) as any;
    assert.equal(p.completed_count, 4);
    assert.equal(p.import_review_required, 1);
    assert.equal(p.social_url, "https://instagram.com/new");
    const second = await importActivities(db, file, false, undefined, options);
    assert.equal(second.accounts_created, 0);
    assert.equal(second.imported, 0);
    assert.equal(
      (
        db
          .prepare(
            "SELECT password_hash FROM users WHERE email='brand@example.com'",
          )
          .get() as any
      ).password_hash,
      "untouched",
    );
  } finally {
    db.close();
  }
});
