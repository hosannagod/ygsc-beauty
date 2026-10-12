import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("introduction files download correctly and are accessible only to administrators", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Strong-password-123!",
      hash = hashPassword(password);
    for (const role of ["admin", "brand", "influencer"])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(role + "@test.com", "Test User", role, hash);
    const app = createApp(db);
    const login = async (role: string) => {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: role + "@test.com", password }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    const cookies = {
      admin: await login("admin"),
      brand: await login("brand"),
      influencer: await login("influencer"),
    };
    for (const ext of ["pdf", "pptx"]) {
      const path = "/api/work/admin/brand-introduction." + ext;
      assert.equal((await app.request(path)).status, 401);
      for (const cookie of [cookies.brand, cookies.influencer])
        assert.equal(
          (await app.request(path, { headers: { Cookie: cookie } })).status,
          403,
        );
      const response = await app.request(path, {
        headers: { Cookie: cookies.admin },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(
        response.headers.get("content-disposition")!,
        /^attachment;/,
      );
      const content = Buffer.from(await response.arrayBuffer());
      assert.equal(
        content.subarray(0, ext === "pdf" ? 4 : 2).toString(),
        ext === "pdf" ? "%PDF" : "PK",
      );
    }
    const preview = await app.request(
      "/api/work/admin/brand-introduction.pdf?view=1",
      { headers: { Cookie: cookies.admin } },
    );
    assert.match(preview.headers.get("content-disposition")!, /^inline;/);
  } finally {
    db.close();
  }
});
