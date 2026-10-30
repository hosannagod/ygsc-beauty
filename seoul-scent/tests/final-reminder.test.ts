import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { deadline } from "../src/seoul/workflow.js";

test("final reminder queues one bilingual email per shipped application without a final link", async () => {
  const envKeys = ["EMAIL_PROVIDER", "EMAIL_FROM", "APP_ORIGIN", "BREVO_API_KEY"] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    EMAIL_PROVIDER: "brevo",
    EMAIL_FROM: "sender@example.com",
    APP_ORIGIN: "https://example.com",
    BREVO_API_KEY: "test-key",
  });
  const db = openDb(":memory:");
  try {
    const app = createApp(db);
    const user = db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)");
    const adminId = Number(user.run("admin@example.com", "Admin", "admin", hashPassword("Admin-password-123!")).lastInsertRowid);
    const brandId = Number(user.run("brand@example.com", "Brand", "brand", hashPassword("Brand-password-123!")).lastInsertRowid);
    const creatorId = Number(user.run("creator@example.com", "Creator", "influencer", hashPassword("Creator-password-123!")).lastInsertRowid);
    const otherId = Number(user.run("other@example.com", "Other", "influencer", hashPassword("Other-password-123!")).lastInsertRowid);
    const finalDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.now() + 10 * 86400_000));
    const campaignId = Number(db.prepare(
      "INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status) VALUES(?,?,?,?,?,50,'gifted',?,?,?,?,?,?,'closed')",
    ).run(brandId, "Test campaign", "Product", "Product description", "Content guide", finalDate, finalDate, finalDate,
      deadline(finalDate) - 86400_000, deadline(finalDate), deadline(finalDate)).lastInsertRowid);
    const insert = db.prepare("INSERT INTO applications(campaign_id,influencer_id,status,consent_at,phone,address,tracking_number,final_url) VALUES(?,?,'shipping',1,'01012345678','Address',?,?)");
    insert.run(campaignId, creatorId, "TRACK123", "");
    insert.run(campaignId, otherId, "TRACK456", "https://tiktok.com/video");
    const login = await app.request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "Admin-password-123!" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const send = (payload: object) => app.request(`/api/work/admin/campaigns/${campaignId}/final-reminder-email`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal((await send({ final_date: finalDate, expected_count: 2 })).status, 409);
    assert.deepEqual(await (await send({ final_date: finalDate, expected_count: 1 })).json(), { recipients: 1, queued: 0, applied: false });
    assert.deepEqual(await (await send({ final_date: finalDate, expected_count: 1, dry_run: false })).json(), { recipients: 1, queued: 1, applied: true });
    assert.deepEqual(await (await send({ final_date: finalDate, expected_count: 1, dry_run: false })).json(), { recipients: 1, queued: 0, applied: true });
    assert.deepEqual(await (await send({ final_date: finalDate, expected_count: 1, reminder_round: 2, dry_run: false })).json(), { recipients: 1, queued: 1, applied: true });
    assert.deepEqual(await (await send({ final_date: finalDate, expected_count: 1, reminder_round: 2, dry_run: false })).json(), { recipients: 1, queued: 0, applied: true });
    const queued = db.prepare("SELECT recipient,body FROM email_outbox").all() as any[];
    assert.equal(queued.length, 2);
    assert.equal(queued[0].recipient, "creator@example.com");
    assert.match(queued[0].body, /English[\s\S]*한국어/);
    assert.match(queued[0].body, /제품을 아직 받지 못하셨다면/);
    assert.equal((db.prepare("SELECT actor_id FROM admin_audit WHERE action='campaign_final_reminder_email' LIMIT 1").get() as any).actor_id, adminId);
  } finally {
    db.close();
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
