import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("admin creates an assignment-only brand without an external email address", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Test-password-123!";
    db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES('admin@example.com','Admin','admin',?),('creator@example.com','Creator','influencer',?)")
      .run(hashPassword(password), hashPassword(password));
    const app = createApp(db);
    const login = async (email: string) => {
      const response = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const admin = await login("admin@example.com");
    const creator = await login("creator@example.com");
    const create = (cookie: string) => app.request("/api/work/admin/brands/managed", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "서울센트(SeoulScent)", username: "seoulscent-managed" }),
    });
    assert.equal((await create(creator)).status, 403);
    const response = await create(admin);
    assert.equal(response.status, 201, await response.clone().text());
    const result = await response.json() as any;
    const row = db.prepare("SELECT name,email,username,role FROM users WHERE id=?").get(result.id) as any;
    assert.deepEqual(row, { name: "서울센트(SeoulScent)", email: "seoulscent-managed", username: "seoulscent-managed", role: "brand" });
    assert.equal((await create(admin)).status, 409);
    const brands = await app.request("/api/work/admin/brands", { headers: { Cookie: admin } });
    assert.ok((await brands.json() as any).brands.some((brand: any) => brand.id === result.id));
  } finally {
    db.close();
  }
});
