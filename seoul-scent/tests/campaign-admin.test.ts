import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { sweepDeadlines } from "../src/seoul/workflow.js";
test("admin capacity changes are independent of dates; deletion preserves history and stops penalties/mail", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Test-password-123!",
      hash = hashPassword(password);
    for (const [email, role] of [
      ["admin@test.com", "admin"],
      ["brand@test.com", "brand"],
      ["creator@test.com", "influencer"],
      ["other@test.com", "influencer"],
    ])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(email, "Test User", role, hash);
    db.prepare(
      "INSERT INTO campaigns(id,brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,is_draft,status) VALUES(1,2,'Test campaign','Product','Description','Guidelines',50,'gifted','','','',0,0,0,1,'closed')",
    ).run();
    db.prepare(
      "INSERT INTO applications(id,campaign_id,influencer_id,status,consent_at,phone,address) VALUES(1,1,3,'completed',1,'01012345678',''),(2,1,4,'selected',1,'01012345678','')",
    ).run();
    db.prepare(
      "UPDATE influencer_profiles SET completed_count=1 WHERE user_id=3",
    ).run();
    db.prepare(
      "INSERT INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at) VALUES(2,'test','other@test.com','Subject','Body',0,0)",
    ).run();
    const app = createApp(db);
    const cookies: Record<string, string> = {};
    for (const role of ["admin", "brand", "creator"]) {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: role + "@test.com", password }),
      });
      cookies[role] = r.headers.get("set-cookie")!.split(";")[0];
    }
    const call = (role: string, path: string, method = "GET", body?: any) =>
      app.request("/api/work" + path, {
        method,
        headers: { Cookie: cookies[role], "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal(
      (await call("brand", "/campaigns/1/capacity", "PUT", { capacity: 100 }))
        .status,
      403,
    );
    assert.equal(
      (await call("admin", "/campaigns/1/capacity", "PUT", { capacity: 100 }))
        .status,
      200,
    );
    let campaign = db
      .prepare("SELECT * FROM campaigns WHERE id=1")
      .get() as any;
    assert.equal(campaign.capacity, 100);
    assert.equal(campaign.final_date, "");
    assert.equal(campaign.final_due, 0);
    assert.equal(
      (await call("admin", "/campaigns/1/capacity", "PUT", { capacity: 1 }))
        .status,
      409,
    );
    assert.equal(
      (await call("admin", "/campaigns/1/capacity", "PUT", { capacity: 501 }))
        .status,
      400,
    );
    assert.equal((await call("brand", "/campaigns/1", "DELETE")).status, 403);
    assert.equal((await call("admin", "/campaigns/1", "DELETE")).status, 200);
    campaign = db.prepare("SELECT * FROM campaigns WHERE id=1").get() as any;
    assert.ok(campaign.deleted_at > 0);
    assert.equal(
      (db.prepare("SELECT count(*) n FROM applications").get() as any).n,
      2,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT completed_count FROM influencer_profiles WHERE user_id=3",
          )
          .get() as any
      ).completed_count,
      1,
    );
    assert.equal(
      (db.prepare("SELECT status FROM email_outbox").get() as any).status,
      "failed",
    );
    assert.equal(
      ((await (await call("admin", "/campaigns")).json()) as any).campaigns
        .length,
      0,
    );
    assert.equal((await call("admin", "/campaigns/1")).status, 404);
    assert.equal(
      (await call("admin", "/campaigns/1/capacity", "PUT", { capacity: 10 }))
        .status,
      404,
    );
    assert.equal(
      (await call("admin", "/admin/email/1/retry", "POST", {})).status,
      409,
    );
    assert.equal(
      (
        await call("brand", "/applications/2/action", "POST", {
          action: "reject",
        })
      ).status,
      409,
    );
    assert.equal(
      ((await (await call("creator", "/certificate")).json()) as any)
        .completed_count,
      1,
    );
    assert.equal(
      ((await (await call("admin", "/admin/users/3/history")).json()) as any)
        .applications.length,
      1,
    );
    db.prepare("UPDATE campaigns SET is_draft=0 WHERE id=1").run();
    assert.equal(sweepDeadlines(db, Date.now() + 86400000).penalized, 0);
    assert.equal(
      (
        db
          .prepare(
            "SELECT no_show_count FROM influencer_profiles WHERE user_id=4",
          )
          .get() as any
      ).no_show_count,
      0,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) n FROM admin_audit WHERE action IN ('campaign_delete','campaign_capacity')",
          )
          .get() as any
      ).n,
      2,
    );
  } finally {
    db.close();
  }
});
