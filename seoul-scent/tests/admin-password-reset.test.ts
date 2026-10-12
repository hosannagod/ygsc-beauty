import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword, verifyPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
test("admin reset requires exact influencer identity, revokes sessions/locks and forces a new password without altering profile or history", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Strong-password-123!",
      hash = hashPassword(password);
    for (const role of ["admin", "brand", "influencer"])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(role + "@test.com", "Test User", role, hash);
    db.prepare("UPDATE users SET phone='01012345678' WHERE id=3").run();
    db.prepare(
      "UPDATE influencer_profiles SET phone='01012345678',social_url='https://instagram.com/test',followers=1200,nationality='파키스탄',completed_count=1 WHERE user_id=3",
    ).run();
    db.prepare(
      "INSERT INTO historical_activities(user_id,project_key,content_links,submitted_at,imported_at) VALUES(3,'Project','[]','',1)",
    ).run();
    const app = createApp(db),
      path = "/api/work/admin/users/3/reset-password";
    const login = (email: string, pass = password) =>
      app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass }),
      });
    const c = await login("influencer@test.com"),
      oldCookie = c.headers.get("set-cookie")!.split(";")[0];
    const admin = (await login("admin@test.com")).headers
      .get("set-cookie")!
      .split(";")[0];
    const put = (
      cookie = "",
      payload: any = {
        confirm_email: "influencer@test.com",
        temporary_password: "0000",
      },
      url = path,
    ) =>
      app.request(url, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    assert.equal((await put()).status, 401);
    assert.equal((await put(oldCookie)).status, 403);
    assert.equal(
      (
        await put(admin, {
          confirm_email: "wrong@test.com",
          temporary_password: "0000",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await put(
          admin,
          { confirm_email: "brand@test.com", temporary_password: "0000" },
          "/api/work/admin/users/2/reset-password",
        )
      ).status,
      404,
    );
    for (const key of ["influencer@test.com", "login:3", "account:3"])
      db.prepare("INSERT INTO login_attempts VALUES(?,5,?)").run(
        key,
        Date.now() + 900000,
      );
    const before = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=3")
      .get();
    const reset = await put(admin);
    assert.equal(reset.status, 200);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM login_attempts").get() as any).n,
      0,
    );
    assert.equal(
      (await app.request("/api/me", { headers: { Cookie: oldCookie } })).status,
      401,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM influencer_profiles WHERE user_id=3").get(),
      before,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM historical_activities").get() as any)
        .n,
      1,
    );
    const user = db.prepare("SELECT * FROM users WHERE id=3").get() as any;
    assert.equal(user.must_change_password, 1);
    assert.ok(verifyPassword("0000", user.password_hash));
    const audit = db
      .prepare("SELECT note FROM admin_audit WHERE action='password_reset'")
      .get() as any;
    assert.ok(!audit.note.includes("0000"));
    assert.ok(!audit.note.includes(user.password_hash));
    const initial = await login("influencer@test.com", "0000");
    assert.equal(initial.status, 200);
    const initialCookie = initial.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await app.request("/api/work/profile", {
          headers: { Cookie: initialCookie },
        })
      ).status,
      403,
    );
    const changed = await app.request("/api/account", {
      method: "PUT",
      headers: { Cookie: initialCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: "0000",
        new_password: "New-strong-password-123!",
        confirm_password: "New-strong-password-123!",
      }),
    });
    assert.equal(changed.status, 200);
    assert.equal(
      (await login("influencer@test.com", "New-strong-password-123!")).status,
      200,
    );
  } finally {
    db.close();
  }
});
