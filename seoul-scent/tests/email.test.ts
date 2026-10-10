import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/seoul/db.js";
import {
  emailConfig,
  emailWorker,
  emailStatus,
  queueSelectionEmail,
} from "../src/seoul/email.js";

const env = {
  EMAIL_PROVIDER: "brevo",
  EMAIL_FROM: "notifications@example.com",
  EMAIL_REPLY_TO: "reply@gmail.com",
  BREVO_API_KEY: "test-secret-never-sent",
  APP_ORIGIN: "https://seoul-scent.onrender.com",
  EMAIL_DAILY_LIMIT: "100",
};
function fixture() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO users(id,email,name,role,password_hash) VALUES(1,'brand@example.com','Brand','brand','unused'),(2,'creator@example.com','Jane','influencer','unused')",
  ).run();
  db.prepare(
    `INSERT INTO campaigns(id,brand_id,title,title_en,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due)
    VALUES(1,1,'테스트 캠페인','Test campaign','Product','Description','Guidelines',2,'gifted','2099-01-01','2099-01-03','2099-01-05',1,2,3)`,
  ).run();
  db.prepare(
    "INSERT INTO applications(id,campaign_id,influencer_id,consent_at,phone,address,status) VALUES(1,1,2,1,'','','selected')",
  ).run();
  return db;
}
test("selection email is opt-in, unique, and rolls back with the selection transaction", () => {
  const db = fixture();
  queueSelectionEmail(db, 1, {});
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM email_outbox").get() as any).n,
    0,
  );
  assert.throws(() =>
    db.transaction(() => {
      queueSelectionEmail(db, 1, env);
      throw new Error("rollback");
    })(),
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM email_outbox").get() as any).n,
    0,
  );
  queueSelectionEmail(db, 1, env);
  queueSelectionEmail(db, 1, env);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM email_outbox").get() as any).n,
    1,
  );
  db.close();
});
test("Brevo receives bilingual text, authenticated URL, reply-to and no shipping details; no resend on success", async () => {
  const db = fixture();
  queueSelectionEmail(db, 1, env, 1000);
  let calls = 0;
  const request = (async (url: any, options: any) => {
    calls++;
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    const body = JSON.parse(options.body);
    assert.equal(body.to[0].email, "creator@example.com");
    assert.equal(body.replyTo.email, "reply@gmail.com");
    assert.match(body.textContent, /Test campaign/);
    assert.match(body.textContent, /테스트 캠페인/);
    assert.match(
      body.textContent,
      /https:\/\/seoul-scent.onrender.com\/applications\/1/,
    );
    assert.equal(body.htmlContent, undefined);
    return Response.json({ messageId: "accepted-1" }, { status: 201 });
  }) as typeof fetch;
  const worker = emailWorker(db, env, request);
  await worker(1000);
  await worker(2000);
  assert.equal(calls, 1);
  assert.equal((emailStatus(db, env).messages[0] as any).status, "sent");
  assert.ok(!JSON.stringify(emailStatus(db, env)).includes(env.BREVO_API_KEY));
  db.close();
});
test("provider quota failures retry with backoff, cap attempts, redact provider errors", async () => {
  const db = fixture();
  queueSelectionEmail(db, 1, env, 1000);
  let calls = 0;
  const worker = emailWorker(db, env, (async () => {
    calls++;
    return new Response("secret detail", { status: 429 });
  }) as typeof fetch);
  await worker(1000);
  await worker(1001);
  assert.equal(calls, 1);
  for (let i = 0; i < 4; i++) await worker(1000 + (i + 1) * 4_000_000);
  const row = emailStatus(db, env).messages[0] as any;
  assert.equal(calls, 5);
  assert.equal(row.status, "failed");
  assert.equal(row.last_error, "provider_http_429");
  await worker(50_000_000);
  assert.equal(calls, 5);
  db.close();
});
test("rolling daily cap includes retries, missing settings do not send, concurrent runs do not double-send", async () => {
  const db = fixture();
  queueSelectionEmail(db, 1, env, 1000);
  let calls = 0;
  const request = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response("", { status: 503 });
  }) as typeof fetch;
  const missing = emailWorker(db, { ...env, BREVO_API_KEY: "" }, request);
  await missing(1000);
  assert.equal(calls, 0);
  const limited = emailWorker(db, { ...env, EMAIL_DAILY_LIMIT: "1" }, request);
  await Promise.all([limited(1000), limited(1000)]);
  assert.equal(calls, 1);
  await limited(200_000);
  assert.equal(calls, 1);
  await limited(86402_000);
  assert.equal(calls, 2);
  db.close();
});
test("permanent provider errors stop retries and abandoned sending claims recover after restart", async () => {
  const db = fixture();
  queueSelectionEmail(db, 1, env, 1000);
  db.prepare(
    "UPDATE email_outbox SET status='sending',last_attempt=1000",
  ).run();
  let calls = 0;
  const worker = emailWorker(db, env, (async () => {
    calls++;
    return new Response("bad address", { status: 400 });
  }) as typeof fetch);
  await worker(1001);
  assert.equal(calls, 0);
  await worker(1_000_000);
  assert.equal(calls, 1);
  assert.equal((emailStatus(db, env).messages[0] as any).status, "failed");
  db.close();
});
test("mail config rejects unsafe origins, header injection and invalid daily limits", () => {
  assert.equal(emailConfig(env).configured, true);
  for (const change of [
    { APP_ORIGIN: "http://example.com" },
    { APP_ORIGIN: "https://user:pass@example.com" },
    { EMAIL_FROM: "mail@example.com\r\nBcc: victim@example.com" },
    { EMAIL_DAILY_LIMIT: "0" },
    { EMAIL_REPLY_TO: "not-email" },
  ])
    assert.equal(emailConfig({ ...env, ...change }).configured, false);
});
