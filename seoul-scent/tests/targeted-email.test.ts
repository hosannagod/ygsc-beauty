import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("targeted email verifies recipients, excludes blocked accounts, and queues only once", async () => {
  const db = openDb(":memory:");
  const previous = Object.fromEntries(
    ["EMAIL_PROVIDER", "EMAIL_FROM", "BREVO_API_KEY", "APP_ORIGIN"].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    EMAIL_PROVIDER: "brevo",
    EMAIL_FROM: "notifications@example.com",
    BREVO_API_KEY: "test-key",
    APP_ORIGIN: "https://seoul-scent.onrender.com",
  });
  try {
    const hash = hashPassword("Test-password-123!");
    db.prepare("INSERT INTO users(id,email,name,role,password_hash) VALUES(1,'hosannagod@gmail.com','Admin','admin',?),(2,'creator@example.com','Creator','influencer',?),(3,'blocked@example.com','Blocked','influencer',?)")
      .run(hash, hash, hash);
    db.prepare("INSERT INTO blocked_emails(email,created_at,actor_id) VALUES('blocked@example.com',1,1)").run();
    const app = createApp(db);
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hosannagod@gmail.com", password: "Test-password-123!" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const send = (payload: Record<string, unknown>) => app.request("/api/work/admin/targeted-email", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ batch_key: "test-batch-2026", subject: "A collaboration inquiry", body: "Please reply if you are interested in this collaboration.", ...payload }),
    });
    assert.equal((await send({ user_ids: [2], expected_emails: ["wrong@example.com"], dry_run: false, expected_count: 1 })).status, 409);
    assert.equal((await send({ user_ids: [3], expected_emails: ["blocked@example.com"], dry_run: false, expected_count: 1 })).status, 409);
    assert.equal((await send({ user_ids: [2, 2], expected_emails: ["creator@example.com", "creator@example.com"], dry_run: false, expected_count: 2 })).status, 400);
    const preview = await send({ user_ids: [2], expected_emails: ["creator@example.com"] });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json() as any).count, 1);
    assert.equal((await send({ user_ids: [2], expected_emails: ["creator@example.com"], dry_run: false, expected_count: 1 })).status, 200);
    assert.equal((await send({ user_ids: [2], expected_emails: ["creator@example.com"], dry_run: false, expected_count: 1 })).status, 409);
    const rows = db.prepare("SELECT user_id,recipient,status FROM broadcast_email_outbox").all() as any[];
    assert.deepEqual(rows, [{ user_id: 2, recipient: "creator@example.com", status: "pending" }]);
    const tomorrow = Date.now() + 86400_000;
    const scheduled = await send({ batch_key: "test-tomorrow-2026", user_ids: [2], expected_emails: ["creator@example.com"], dry_run: false, expected_count: 1, scheduled_at: tomorrow });
    assert.equal(scheduled.status, 200);
    assert.equal((db.prepare("SELECT next_attempt FROM broadcast_email_outbox WHERE event_key=?").get("targeted:test-tomorrow-2026:2") as any).next_attempt, tomorrow);
    assert.equal((await send({ batch_key: "test-invalid-2026", user_ids: [2], expected_emails: ["creator@example.com"], scheduled_at: Date.now() + 8 * 86400_000 })).status, 400);
  } finally {
    db.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
