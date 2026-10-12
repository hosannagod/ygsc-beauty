import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
test("admin login diagnostics reveal lock status without passwords, hashes or session tokens and do not modify attempts", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Strong-password-123!",
      hash = hashPassword(password);
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('admin@test.com','Admin','admin',?),('creator@test.com','Creator','influencer',?)",
    ).run(hash, hash);
    const app = createApp(db),
      path = "/api/work/admin/users/2/login-status";
    const login = async (email: string) => {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    assert.equal((await app.request(path)).status, 401);
    const creator = await login("creator@test.com");
    assert.equal(
      (await app.request(path, { headers: { Cookie: creator } })).status,
      403,
    );
    const admin = await login("admin@test.com");
    const locked = Date.now() + 15 * 60000;
    db.prepare("INSERT INTO login_attempts VALUES('creator@test.com',5,?)").run(
      locked,
    );
    const response = await app.request(path, { headers: { Cookie: admin } });
    assert.equal(response.status, 200);
    const data = (await response.json()) as any;
    assert.equal(data.login_locked, true);
    assert.equal(data.login_failures, 5);
    assert.equal(data.uses_initial_password, false);
    assert.equal(data.active_sessions, 1);
    assert.ok(data.retry_after_seconds > 0);
    assert.equal(data.password_hash, undefined);
    assert.equal(data.password, undefined);
    assert.equal(data.token_hash, undefined);
    assert.equal(
      (
        db
          .prepare(
            "SELECT locked_until FROM login_attempts WHERE email='creator@test.com'",
          )
          .get() as any
      ).locked_until,
      locked,
    );
    db.prepare(
      "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=2",
    ).run(hashPassword("0000"));
    const initial = (await (
      await app.request(path, { headers: { Cookie: admin } })
    ).json()) as any;
    assert.equal(initial.uses_initial_password, true);
    assert.equal(initial.must_change_password, true);
  } finally {
    db.close();
  }
});
