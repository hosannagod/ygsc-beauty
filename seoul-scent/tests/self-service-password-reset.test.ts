import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword, verifyPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("registered brand and influencer accounts can reset by email with one-use expiring links", async () => {
  const saved = Object.fromEntries(
    ["EMAIL_PROVIDER", "EMAIL_FROM", "APP_ORIGIN", "EMAIL_DAILY_LIMIT", "BREVO_API_KEY"].map(
      (key) => [key, process.env[key]],
    ),
  );
  Object.assign(process.env, {
    EMAIL_PROVIDER: "brevo",
    EMAIL_FROM: "hello@example.com",
    APP_ORIGIN: "https://example.com",
    EMAIL_DAILY_LIMIT: "300",
    BREVO_API_KEY: "test-only-key",
  });
  const db = openDb(":memory:");
  try {
    const sent: any[] = [];
    const mailFetch = async (_url: any, options: any) => {
      sent.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ messageId: "sent" }), { status: 201 });
    };
    const app = createApp(db, false, undefined, [], mailFetch as typeof fetch);
    assert.match(await (await app.request("/login")).text(), /\/forgot-password/);
    assert.match(await (await app.request("/forgot-password")).text(), /reset-request-form/);
    assert.match(await (await app.request("/password-reset")).text(), /password-reset-form/);
    const post = (path: string, payload: any) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    for (const [email, role] of [
      ["brand@test.com", "brand"],
      ["creator@test.com", "influencer"],
      ["admin@test.com", "admin"],
    ])
      db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)")
        .run(email, "Test", role, hashPassword("Old-password-123!"));
    const login = await post("/api/login", {
      email: "brand@test.com",
      password: "Old-password-123!",
    });
    const oldCookie = login.headers.get("set-cookie")!.split(";")[0];
    const request = (email: string) =>
      post("/api/password-reset/request", { email });
    const unknown = await request("unknown@test.com");
    const admin = await request("admin@test.com");
    const brand = await request("brand@test.com");
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), await admin.json());
    assert.deepEqual(await brand.json(), { success: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].textContent, /password-reset#token=[a-f0-9]{64}/);
    const token = sent[0].textContent.match(/password-reset#token=([a-f0-9]{64})/)[1];
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM password_reset_tokens").all()).includes(token));
    assert.equal((await request("brand@test.com")).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(
      (
        await post("/api/password-reset/confirm", {
          token,
          new_password: "short",
          confirm_password: "short",
        })
      ).status,
      400,
    );
    const updated = await post("/api/password-reset/confirm", {
      token,
      new_password: "New-password-123!",
      confirm_password: "New-password-123!",
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (await app.request("/api/me", { headers: { Cookie: oldCookie } })).status,
      401,
    );
    assert.equal(
      (await post("/api/login", { email: "brand@test.com", password: "Old-password-123!" })).status,
      401,
    );
    assert.equal(
      (await post("/api/login", { email: "brand@test.com", password: "New-password-123!" })).status,
      200,
    );
    assert.equal(
      (await post("/api/password-reset/confirm", {
        token,
        new_password: "Another-password-123!",
        confirm_password: "Another-password-123!",
      })).status,
      400,
    );
    assert.equal((await request("creator@test.com")).status, 200);
    assert.equal(sent.length, 2);
    db.prepare("UPDATE password_reset_tokens SET expires_at=0 WHERE user_id=2").run();
    const expired = sent[1].textContent.match(/password-reset#token=([a-f0-9]{64})/)[1];
    assert.equal((await post("/api/password-reset/confirm", {
      token: expired,
      new_password: "New-password-123!",
      confirm_password: "New-password-123!",
    })).status, 400);
    const creator = db.prepare("SELECT password_hash FROM users WHERE id=2").get() as any;
    assert.ok(verifyPassword("Old-password-123!", creator.password_hash));
  } finally {
    db.close();
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
