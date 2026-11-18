import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("new campaign invitation queues each active influencer once across three days", async () => {
  const keys = ["EMAIL_PROVIDER", "EMAIL_FROM", "BREVO_API_KEY", "APP_ORIGIN", "EMAIL_DAILY_LIMIT"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalNow = Date.now;
  const db = openDb(":memory:");
  try {
    Object.assign(process.env, {
      EMAIL_PROVIDER: "brevo", EMAIL_FROM: "notifications@example.com",
      BREVO_API_KEY: "test-key", APP_ORIGIN: "https://example.com", EMAIL_DAILY_LIMIT: "300",
    });
    Date.now = () => Date.parse("2026-11-18T08:00:00Z");
    db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)")
      .run("hosannagod@gmail.com", "Admin", "admin", hashPassword("Test-password-123!"));
    for (let i = 1; i <= 5; i++)
      db.prepare("INSERT INTO users(email,name,role,password_hash,suspended_at) VALUES(?,?,?,?,?)")
        .run(`creator${i}@example.com`, `Creator ${i}`, "influencer", hashPassword("Test-password-123!"), i === 5 ? 1 : 0);
    const app = createApp(db);
    const login = await app.request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hosannagod@gmail.com", password: "Test-password-123!" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (payload: object) => app.request("/api/work/admin/new-campaigns-three-day-email", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const preview = await (await post({})).json() as any;
    assert.equal(preview.count, 4);
    assert.deepEqual(preview.batches, [2, 1, 1]);
    for (const link of ["https://seoul-scent.onrender.com/campaigns", "https://seoul-scent.onrender.com/", "https://open.kakao.com/o/gKM5lLKi"])
      assert.ok(preview.body.includes(link));
    assert.ok(preview.body.includes("1101"));
    const queued = await post({ dry_run: false, expected_count: 4 });
    assert.equal(queued.status, 200, await queued.clone().text());
    const rows = db.prepare("SELECT user_id,next_attempt,status FROM broadcast_email_outbox ORDER BY user_id").all() as any[];
    assert.deepEqual(rows.map(row => row.next_attempt), [preview.schedule[0], preview.schedule[0], preview.schedule[1], preview.schedule[2]]);
    assert.ok(rows.every(row => row.status === "pending"));
    assert.equal((await post({ dry_run: false, expected_count: 4 })).status, 409);
  } finally {
    Date.now = originalNow;
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    db.close();
  }
});
