import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { mergeInfluencers } from "../src/seoul/influencer-merge.js";

function fixture() {
  const db = openDb(":memory:");
  const hash = hashPassword("Strong-password-123!");
  for (const [email, role] of [
    ["admin@test.com", "admin"],
    ["main@test.com", "influencer"],
    ["old@test.com", "influencer"],
    ["older@test.com", "influencer"],
    ["brand@test.com", "brand"],
  ])
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
    ).run(email, "Same Person", role, hash);
  db.prepare(
    "UPDATE influencer_profiles SET completed_count=1,followers=1000,social_url='https://xhslink.cn/m/primary' WHERE user_id=2",
  ).run();
  db.prepare(
    "UPDATE influencer_profiles SET phone='01012345678',onboarding_approved=1 WHERE user_id=3",
  ).run();
  for (const [user, project, link] of [
    [2, "로레코", "https://example.com/main"],
    [3, "로레코", "https://example.com/old"],
    [4, "뷰티비티", "https://example.com/older"],
  ])
    db.prepare(
      "INSERT INTO historical_activities(user_id,project_key,content_links,submitted_at,imported_at) VALUES(?,?,?,?,?)",
    ).run(user, project, JSON.stringify([link]), "2026-09-01", 1);
  for (const id of [1, 2])
    db.prepare(
      "INSERT INTO campaigns(id,brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,is_draft,status) VALUES(?,5,'Project','Product','Description','Guide',50,'gifted','','','',0,0,0,1,'closed')",
    ).run(id);
  db.prepare(
    "INSERT INTO applications(id,campaign_id,influencer_id,status,consent_at,phone,address,views) VALUES(1,1,3,'completed',1,'01012345678','Address',200),(2,2,4,'selected',1,'01012345678','Address',0)",
  ).run();
  db.prepare(
    "INSERT INTO application_events(application_id,actor_id,status,note,created_at) VALUES(1,3,'completed','Note',1)",
  ).run();
  db.prepare(
    "INSERT INTO notifications(user_id,message,path,created_at) VALUES(4,'Selected','/applications/2',1)",
  ).run();
  db.prepare(
    "INSERT INTO onboarding_submissions(user_id,status,created_at,reviewer_id) VALUES(3,'approved',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO activity_certificates VALUES('source-cert',3,'Same Person',2,'[]',1)",
  ).run();
  db.prepare(
    "INSERT INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at) VALUES(2,'selection','older@test.com','Subject','Body',0,0)",
  ).run();
  for (const id of [2, 3, 4])
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      "session" + id,
      id,
      Date.now() + 100000,
    );
  return db;
}

test("merge keeps primary login and every linked record, deduplicates projects and revokes sessions", () => {
  const db = fixture();
  try {
    const original = db
      .prepare("SELECT password_hash FROM users WHERE id=2")
      .get() as any;
    const preview = mergeInfluencers(
      db,
      2,
      ["old@test.com", "older@test.com"],
      1,
    );
    assert.equal(preview.completed_count, 3);
    assert.equal(preview.removed_accounts, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      5,
    );
    const result = mergeInfluencers(
      db,
      2,
      ["old@test.com", "older@test.com"],
      1,
      false,
    );
    assert.equal(result.removed_accounts, 2);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      3,
    );
    assert.equal(
      (db.prepare("SELECT password_hash FROM users WHERE id=2").get() as any)
        .password_hash,
      original.password_hash,
    );
    const profile = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=2")
      .get() as any;
    assert.equal(profile.completed_count, 3);
    assert.equal(profile.followers, 1000);
    assert.equal(profile.phone, "01012345678");
    assert.equal(profile.onboarding_approved, 1);
    assert.equal(profile.social_url, "https://xhslink.cn/m/primary");
    const row = db
      .prepare(
        "SELECT content_links FROM historical_activities WHERE user_id=2 AND project_key='로레코'",
      )
      .get() as any;
    assert.deepEqual(JSON.parse(row.content_links), [
      "https://example.com/main",
      "https://example.com/old",
    ]);
    assert.deepEqual(
      (
        db
          .prepare("SELECT influencer_id FROM applications ORDER BY id")
          .all() as any[]
      ).map((r) => r.influencer_id),
      [2, 2],
    );
    assert.equal(
      (db.prepare("SELECT actor_id FROM application_events").get() as any)
        .actor_id,
      2,
    );
    assert.equal(
      (db.prepare("SELECT user_id FROM notifications").get() as any).user_id,
      2,
    );
    assert.equal(
      (db.prepare("SELECT user_id FROM activity_certificates").get() as any)
        .user_id,
      2,
    );
    assert.equal(
      (db.prepare("SELECT recipient FROM email_outbox").get() as any).recipient,
      "main@test.com",
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM sessions").get() as any).n,
      0,
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM admin_audit WHERE action='influencer_merge'",
          )
          .get() as any
      ).n,
      1,
    );
  } finally {
    db.close();
  }
});

test("merge conflicts fail before making any changes; API requires admin and exact canonical email", async () => {
  const db = fixture();
  try {
    db.prepare(
      "INSERT INTO applications(campaign_id,influencer_id,status,consent_at,phone,address) VALUES(1,2,'applied',0,'','')",
    ).run();
    assert.throws(() => mergeInfluencers(db, 2, ["old@test.com"], 1, false));
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      5,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT completed_count FROM influencer_profiles WHERE user_id=2",
          )
          .get() as any
      ).completed_count,
      1,
    );
    db.prepare("DELETE FROM applications WHERE influencer_id=2").run();
    db.prepare("UPDATE email_outbox SET status='sending'").run();
    assert.throws(() => mergeInfluencers(db, 2, ["older@test.com"], 1, false));
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      5,
    );
    db.prepare("UPDATE email_outbox SET status='pending'").run();
    const app = createApp(db),
      path = "/api/work/admin/users/2/merge";
    const payload = {
      source_emails: ["old@test.com"],
      confirm_email: "main@test.com",
      dry_run: false,
    };
    const call = (cookie = "", body = payload) =>
      app.request(path, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await call()).status, 401);
    const login = async (email: string) => {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "Strong-password-123!" }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    assert.equal((await call(await login("main@test.com"))).status, 403);
    const admin = await login("admin@test.com");
    assert.equal(
      (await call(admin, { ...payload, confirm_email: "wrong@test.com" }))
        .status,
      409,
    );
    assert.equal(
      (await call(admin, { ...payload, source_emails: ["brand@test.com"] }))
        .status,
      409,
    );
    assert.equal(
      (await call(admin, { ...payload, source_emails: ["main@test.com"] }))
        .status,
      409,
    );
    assert.equal(
      (await call(admin, { ...payload, dry_run: true })).status,
      200,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n,
      5,
    );
  } finally {
    db.close();
  }
});
