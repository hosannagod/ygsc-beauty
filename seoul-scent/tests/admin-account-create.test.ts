import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword, verifyPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("only admins can create an admin with a one-time password and forced change", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Existing-strong-password-123!";
    for (const role of ["admin", "brand", "influencer"])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(`${role}@test.com`, "Existing User", role, hashPassword(password));
    const app = createApp(db);
    const login = (email: string, pass: string) =>
      app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass }),
      });
    const cookie = async (email: string, pass = password) =>
      (await login(email, pass)).headers.get("set-cookie")!.split(";")[0];
    const post = (auth: string, payload: unknown) =>
      app.request("/api/work/admin/users", {
        method: "POST",
        headers: { Cookie: auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    const input = { email: "NEWADMIN@TEST.COM", name: "길민선" };
    assert.equal((await post("", input)).status, 401);
    assert.equal(
      (await post(await cookie("brand@test.com"), input)).status,
      403,
    );
    assert.equal(
      (await post(await cookie("influencer@test.com"), input)).status,
      403,
    );
    const adminCookie = await cookie("admin@test.com");
    assert.equal(
      (await post(adminCookie, { ...input, email: "invalid" })).status,
      400,
    );
    assert.equal(
      (await post(adminCookie, { ...input, email: "brand@test.com" })).status,
      409,
    );
    const result = await post(adminCookie, input);
    assert.equal(result.status, 201);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const created = (await result.json()) as any;
    assert.equal(created.email, "newadmin@test.com");
    assert.equal(created.name, "길민선");
    assert.equal(created.role, "admin");
    assert.equal(created.must_change_password, true);
    assert.ok(created.temporary_password.length >= 32);
    assert.equal((await post(adminCookie, input)).status, 409);
    const row = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(created.id) as any;
    assert.equal(row.role, "admin");
    assert.equal(row.must_change_password, 1);
    assert.ok(verifyPassword(created.temporary_password, row.password_hash));
    assert.notEqual(row.password_hash, created.temporary_password);
    const audit = db
      .prepare("SELECT * FROM admin_audit WHERE action='admin_account_create'")
      .all() as any[];
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_id, 1);
    assert.equal(audit[0].target_user_id, created.id);
    assert.ok(!audit[0].note.includes(created.temporary_password));
    assert.ok(!audit[0].note.includes(row.password_hash));
    const firstLogin = await login(created.email, created.temporary_password);
    assert.equal(firstLogin.status, 200);
    assert.equal(((await firstLogin.json()) as any).redirect, "/account");
    const firstCookie = firstLogin.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await app.request("/api/work/admin/users", {
          headers: { Cookie: firstCookie },
        })
      ).status,
      403,
    );
    const changed = await app.request("/api/account", {
      method: "PUT",
      headers: { Cookie: firstCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: "01012345678",
        current_password: created.temporary_password,
        new_password: "New-strong-password-123!",
        confirm_password: "New-strong-password-123!",
      }),
    });
    assert.equal(changed.status, 200);
    assert.equal(
      (await login(created.email, created.temporary_password)).status,
      401,
    );
    const activeCookie = await cookie(
      created.email,
      "New-strong-password-123!",
    );
    assert.equal(
      (
        await app.request("/api/work/admin/users", {
          headers: { Cookie: activeCookie },
        })
      ).status,
      200,
    );
  } finally {
    db.close();
  }
});
