import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { emailWorker } from "../src/seoul/email.js";

test("overdue final reminders target confirmed missing submissions and skip links submitted before send", async () => {
  const keys = ["EMAIL_PROVIDER", "EMAIL_FROM", "BREVO_API_KEY", "APP_ORIGIN", "EMAIL_DAILY_LIMIT"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalNow = Date.now;
  const db = openDb(":memory:");
  try {
    Object.assign(process.env, {
      EMAIL_PROVIDER: "brevo", EMAIL_FROM: "notifications@example.com",
      BREVO_API_KEY: "test-key", APP_ORIGIN: "https://example.com", EMAIL_DAILY_LIMIT: "300",
    });
    Date.now = () => Date.parse("2026-11-18T10:00:00Z");
    const insertUser = db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)");
    insertUser.run("hosannagod@gmail.com", "Admin", "admin", hashPassword("Test-password-123!"));
    const brandId = Number(insertUser.run("brand@example.com", "Brand", "brand", hashPassword("Test-password-123!")).lastInsertRowid);
    const firstId = Number(insertUser.run("first@example.com", "First", "influencer", hashPassword("Test-password-123!")).lastInsertRowid);
    const secondId = Number(insertUser.run("second@example.com", "Second", "influencer", hashPassword("Test-password-123!")).lastInsertRowid);
    const thirdId = Number(insertUser.run("third@example.com", "Third", "influencer", hashPassword("Test-password-123!")).lastInsertRowid);
    const campaignId = Number(db.prepare(`INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,
      recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status)
      VALUES(?,?,?,?,?,10,'gifted','2026-11-01','2026-11-10','2026-11-16',1,2,?,'closed')`)
      .run(brandId, "Overdue campaign", "Product", "Description", "Guidelines", Date.parse("2026-11-17T00:00:00+09:00")).lastInsertRowid);
    const secondCampaignId = Number(db.prepare(`INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,
      recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status)
      VALUES(?,?,?,?,?,10,'gifted','2026-11-01','2026-11-10','2026-11-16',1,2,?,'closed')`)
      .run(brandId, "Another overdue campaign", "Product", "Description", "Guidelines", Date.parse("2026-11-17T00:00:00+09:00")).lastInsertRowid);
    db.prepare(`INSERT INTO campaigns(id,brand_id,title,product,description,guidelines,capacity,pay_type,
      recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status)
      VALUES(5,?,?,?,?,?,10,'gifted','2026-11-01','2026-11-10','2026-11-16',1,2,?,'closed')`)
      .run(brandId, "리브하모", "Product", "Description", "Guidelines", Date.parse("2026-11-17T00:00:00+09:00"));
    const insertApplication = db.prepare(`INSERT INTO applications(campaign_id,influencer_id,status,consent_at,phone,address,
      participation_confirmed_at,final_url) VALUES(?,?,?,1,'01012345678','서울시 테스트로 1',?,?)`);
    const firstApplication = Number(insertApplication.run(campaignId, firstId, "selected", 1, "").lastInsertRowid);
    const secondApplication = Number(insertApplication.run(campaignId, secondId, "shipping", 1, "").lastInsertRowid);
    insertApplication.run(campaignId, thirdId, "selected", 0, "");
    const remainingApplication = Number(insertApplication.run(secondCampaignId, secondId, "shipping", 1, "").lastInsertRowid);
    insertApplication.run(5, thirdId, "selected", 1, "");
    const app = createApp(db);
    const login = await app.request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hosannagod@gmail.com", password: "Test-password-123!" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (payload: object) => app.request("/api/work/admin/overdue-final-upload-email", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const preview = await (await post({})).json() as any;
    assert.equal(preview.applications, 3);
    assert.equal(preview.recipients, 2);
    assert.deepEqual(preview.campaigns.map((c: any) => c.count), [2, 1]);
    assert.ok(preview.sample_body.includes(`https://seoul-scent.onrender.com/applications/${firstApplication}`));
    assert.ok(!preview.sample_body.includes("리브하모"));
    assert.equal((await post({ dry_run: false, expected_count: 2, expected_applications: 3 })).status, 200);
    db.prepare(`INSERT INTO broadcast_email_outbox(user_id,event_key,recipient,subject,body,next_attempt,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(thirdId, "overdue-final-2026-11-19:stale", "third@example.com", "Reminder", "리브하모", preview.scheduled_at, Date.now());
    const refreshed = await app.request("/api/work/admin/overdue-final-upload-email/refresh", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expected_pending: 3 }),
    });
    assert.deepEqual(await refreshed.json(), { pending_before: 3, active: 2, canceled: 1, remaining_applications: 3 });
    db.prepare("UPDATE applications SET final_url=? WHERE id=?").run("https://example.com/post", firstApplication);
    db.prepare("UPDATE applications SET final_url=? WHERE id=?").run("https://example.com/other-post", secondApplication);
    const sent: { email: string; body: string }[] = [];
    const worker = emailWorker(db, process.env, (async (_url, options) => {
      const message = JSON.parse(String(options?.body));
      sent.push({ email: message.to[0].email, body: message.textContent });
      return Response.json({ messageId: "accepted" }, { status: 201 });
    }) as typeof fetch);
    await worker(preview.scheduled_at);
    await worker(preview.scheduled_at + 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, "second@example.com");
    assert.ok(sent[0].body.includes(`https://seoul-scent.onrender.com/applications/${remainingApplication}`));
    assert.ok(!sent[0].body.includes(`https://seoul-scent.onrender.com/applications/${secondApplication}`));
    const rows = db.prepare("SELECT user_id,status,last_error FROM broadcast_email_outbox ORDER BY user_id").all() as any[];
    assert.deepEqual(rows, [
      { user_id: firstId, status: "failed", last_error: "no_longer_overdue" },
      { user_id: secondId, status: "sent", last_error: "" },
      { user_id: thirdId, status: "failed", last_error: "campaign_excluded" },
    ]);
  } finally {
    Date.now = originalNow;
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    db.close();
  }
});
