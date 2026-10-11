import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createApp } from "../src/seoul/app.js";
import { hashPassword, openDb } from "../src/seoul/db.js";

test("roster XLSX is admin-only, exports live follower totals and preserves phone text", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Strong-password-123!";
    const hash = hashPassword(password);
    for (const [email, role] of [
      ["admin@test.com", "admin"],
      ["brand@test.com", "brand"],
      ["creator@test.com", "influencer"],
      ["missing@test.com", "influencer"],
    ])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(email, "Test User", role, hash);
    db.prepare(
      "UPDATE influencer_profiles SET followers=12300,phone='01012345678',social_url='https://instagram.com/creator',completed_count=3 WHERE user_id=3",
    ).run();
    const app = createApp(db),
      path = "/api/work/admin/influencers.xlsx";
    assert.equal((await app.request(path)).status, 401);
    const cookie = async (email: string) => {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    for (const email of ["brand@test.com", "creator@test.com"])
      assert.equal(
        (await app.request(path, { headers: { Cookie: await cookie(email) } }))
          .status,
        403,
      );
    const admin = await cookie("admin@test.com");
    const response = await app.request(path, { headers: { Cookie: admin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      response.headers.get("content-disposition")!,
      /^attachment; filename="seoul-scent-influencers-.*\.xlsx"$/,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
    const roster = book.getWorksheet("전체 명단")!;
    assert.equal(roster.rowCount, 3);
    assert.equal(roster.getCell("C2").value, "01012345678");
    assert.equal(roster.getCell("E2").value, 12300);
    assert.equal(roster.getCell("F2").value, "브론즈");
    assert.equal(book.getWorksheet("팔로워 확인 필요")!.rowCount, 2);
    assert.equal(book.getWorksheet("요약")!.getCell("B6").value, 12300);
    assert.equal(roster.columns.length, 8);
    db.prepare(
      "UPDATE influencer_profiles SET followers=12400 WHERE user_id=3",
    ).run();
    const updated = await app.request(path, { headers: { Cookie: admin } });
    const fresh = new ExcelJS.Workbook();
    await fresh.xlsx.load(Buffer.from(await updated.arrayBuffer()) as any);
    assert.equal(fresh.getWorksheet("요약")!.getCell("B6").value, 12400);
  } finally {
    db.close();
  }
});
