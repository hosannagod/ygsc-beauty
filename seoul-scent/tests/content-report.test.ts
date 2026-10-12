import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createApp } from "../src/seoul/app.js";
import { openDb, hashPassword } from "../src/seoul/db.js";

test("private content report upload/download persists beside DB and rejects unauthorized or invalid replacements", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seoul-report-"));
  const path = join(dir, "data.db");
  let db = openDb(path);
  try {
    const password = "Strong-password-123!",
      hash = hashPassword(password);
    for (const role of ["admin", "brand", "influencer"])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(role + "@test.com", "Test User", role, hash);
    const app = createApp(db),
      upload = "/api/work/admin/reports/content-followers",
      download = upload + ".xlsx";
    const login = async (role: string) => {
      const response = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: role + "@test.com", password }),
      });
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const book = new ExcelJS.Workbook();
    book.addWorksheet("個別案内");
    book.addWorksheet("개별 안내 명단").addRows([
      ["이름", "팔로워"],
      ["Creator", 12300],
    ]);
    book.addWorksheet("인원·팔로워 요약").addRow(["합계", 12300]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const put = (cookie = "", file = bytes.toString("base64")) =>
      app.request(upload, {
        method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
    assert.equal((await put()).status, 401);
    assert.equal((await app.request(download)).status, 401);
    for (const role of ["brand", "influencer"]) {
      const cookie = await login(role);
      assert.equal((await put(cookie)).status, 403);
      assert.equal(
        (await app.request(download, { headers: { Cookie: cookie } })).status,
        403,
      );
    }
    const admin = await login("admin");
    assert.equal(
      (await app.request(download, { headers: { Cookie: admin } })).status,
      404,
    );
    assert.equal((await put(admin)).status, 200);
    assert.equal(
      (await put(admin, Buffer.from("invalid archive").toString("base64")))
        .status,
      400,
    );
    let response = await app.request(download, { headers: { Cookie: admin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-disposition")!, /^attachment;/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    db.close();
    db = openDb(path);
    response = await createApp(db).request(download, {
      headers: { Cookie: admin },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
