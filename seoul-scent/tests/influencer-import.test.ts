import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { openDb, hashPassword, verifyPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { importInfluencers } from "../src/seoul/influencer-import.js";
async function workbook() {
  const b = new ExcelJS.Workbook(),
    s = b.addWorksheet("responses");
  s.addRow([
    "Name / 이름 ",
    "Email / 이메일 ",
    "연락처(Contact number)",
    "Profile URL / 채널 링크 ",
    "Current follower count on this channel / 해당 채널 팔로워 수 ",
  ]);
  s.addRow([
    "Creator One",
    " CREATOR@example.com ",
    1012345678,
    "instagram.com/creator",
    "2.5k",
  ]);
  s.addRow([
    "Duplicate",
    "creator@example.com",
    "01012345678",
    "https://instagram.com/duplicate",
    500,
  ]);
  s.addRow(["Existing Brand", "brand@example.com", "01012345678", "", 0]);
  s.addRow(["Invalid", "bad-email", "01012345678", "", 0]);
  s.addRow([
    "Creator Two",
    "two@example.com",
    "01012345678",
    "https://tiktok.com/@two",
    "2,000–5,000",
  ]);
  return Buffer.from(await b.xlsx.writeBuffer());
}
test("Excel import previews without writes, deduplicates and preserves existing roles/passwords", async () => {
  const db = openDb(":memory:");
  try {
    const hash = hashPassword("Existing-password-123!");
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('brand@example.com','Brand','brand',?)",
    ).run(hash);
    const file = await workbook();
    const preview = await importInfluencers(db, file, "0000", true);
    assert.equal(preview.ready, 2);
    assert.equal(preview.existing, 1);
    assert.equal(preview.issues.length, 2);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n,
      1,
    );
    const result = await importInfluencers(db, file, "0000", false);
    assert.equal(result.imported, 2);
    const user = db
      .prepare("SELECT * FROM users WHERE email='creator@example.com'")
      .get() as any;
    assert.equal(user.must_change_password, 1);
    assert.ok(verifyPassword("0000", user.password_hash));
    assert.notEqual(user.password_hash, "0000");
    const p = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(user.id) as any;
    assert.equal(p.phone, "01012345678");
    assert.equal(p.followers, 2500);
    assert.equal(p.import_review_required, 0);
    const brand = db
      .prepare("SELECT * FROM users WHERE email='brand@example.com'")
      .get() as any;
    assert.equal(brand.role, "brand");
    assert.equal(brand.password_hash, hash);
    assert.equal(
      (await importInfluencers(db, file, "0000", false)).imported,
      0,
    );
  } finally {
    db.close();
  }
});
test("imported accounts are restricted until password change; normal signup cannot use 0000", async () => {
  const db = openDb(":memory:"),
    app = createApp(db);
  const request = (path: string, method: string, data: any, cookie = "") =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(data),
    });
  try {
    assert.equal(
      (
        await request("/api/work/admin/influencers/import", "POST", {
          file: (await workbook()).toString("base64"),
          initial_password: "0000",
        })
      ).status,
      401,
    );
    await importInfluencers(db, await workbook(), "0000", false);
    const response = await request("/api/login", "POST", {
      email: "creator@example.com",
      password: "0000",
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.clone().json()) as any).redirect, "/account");
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await app.request("/api/work/campaigns", {
          headers: { Cookie: cookie },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/dashboard/influencer", {
          headers: { Cookie: cookie },
        })
      ).headers.get("location"),
      "/account",
    );
    assert.equal(
      (
        await request(
          "/api/account",
          "PUT",
          { current_password: "0000" },
          cookie,
        )
      ).status,
      400,
    );
    const changed = await request(
      "/api/account",
      "PUT",
      {
        current_password: "0000",
        new_password: "New-password-123!",
        confirm_password: "New-password-123!",
      },
      cookie,
    );
    assert.equal(changed.status, 200);
    const nextCookie = changed.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await app.request("/api/work/campaigns", {
          headers: { Cookie: nextCookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/login", "POST", {
          email: "creator@example.com",
          password: "0000",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/login", "POST", {
          email: "creator@example.com",
          password: "New-password-123!",
        })
      ).status,
      200,
    );
    await importInfluencers(db, await workbook(), "0000", false);
    assert.equal(
      (
        db
          .prepare(
            "SELECT must_change_password FROM users WHERE email='creator@example.com'",
          )
          .get() as any
      ).must_change_password,
      0,
    );
    assert.equal(
      (
        await request("/api/register", "POST", {
          email: "new@example.com",
          name: "New creator",
          phone: "01012345678",
          role: "influencer",
          password: "0000",
        })
      ).status,
      400,
    );
  } finally {
    db.close();
  }
});
