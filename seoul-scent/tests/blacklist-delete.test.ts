import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("admin can remove unconfirmed selections and block deleted emails from rejoining", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Test-password-123!";
    for (const [email, role] of [
      ["admin@test.com", "admin"],
      ["brand@test.com", "brand"],
      ["selected@test.com", "influencer"],
      ["applied@test.com", "influencer"],
      ["completed@test.com", "influencer"],
    ])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(email, "Test User", role, hashPassword(password));
    db.prepare(
      "INSERT INTO campaigns(id,brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,is_draft,status) VALUES(1,2,'Test campaign','Product','Description','Guidelines',50,'gifted','','','',0,0,0,1,'closed')",
    ).run();
    db.prepare(
      "INSERT INTO applications(id,campaign_id,influencer_id,status,consent_at,phone,address) VALUES(1,1,3,'selected',1,'01012345678',''),(2,1,4,'applied',1,'01012345678',''),(3,1,5,'completed',1,'01012345678','')",
    ).run();
    db.prepare(
      "INSERT INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at) VALUES(1,'selection:1','selected@test.com','Subject','Body',0,0)",
    ).run();
    const app = createApp(db);
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const call = (body: unknown) =>
      app.request("/api/work/admin/influencers/blacklist-delete", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const emails = ["selected@test.com", "applied@test.com"];
    const preview = await call({ emails });
    assert.equal(preview.status, 200);
    assert.deepEqual(
      ((await preview.json()) as any).selected_removed,
      1,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM blocked_emails").get() as any).n,
      0,
    );
    assert.equal(
      (await call({ emails, dry_run: false })).status,
      400,
    );
    assert.equal(
      (await call({ emails: [...emails, "completed@test.com"], dry_run: false, confirm_delete: true })).status,
      409,
    );
    const response = await call({ emails, dry_run: false, confirm_delete: true });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).applications_removed, 2);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM blocked_emails").get() as any).n,
      2,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM applications").get() as any).n,
      1,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM email_outbox").get() as any).n,
      0,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users WHERE role='influencer'").get() as any).n,
      1,
    );
    assert.throws(() =>
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES('selected@test.com','Blocked','influencer','x')",
      ).run(),
    );
    const register = await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "selected@test.com",
        name: "Blocked User",
        role: "influencer",
        password,
        phone: "01012345678",
      }),
    });
    assert.equal(register.status, 403);
  } finally {
    db.close();
  }
});
