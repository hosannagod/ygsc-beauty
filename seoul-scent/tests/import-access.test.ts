import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { campaignEligible } from "../src/seoul/onboarding.js";

test("admin grants campaign access to complete imported accounts without awarding activity credit", async () => {
  const db = openDb(":memory:");
  const app = createApp(db);
  try {
    const adminId = Number(db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,'admin',?)")
      .run("admin@test.com", "Admin", hashPassword("Admin-password-123!")).lastInsertRowid);
    const creatorId = Number(db.prepare("INSERT INTO users(email,name,role,password_hash,must_change_password) VALUES(?,?,'influencer',?,1)")
      .run("creator@test.com", "Creator", hashPassword("0000")).lastInsertRowid);
    db.prepare("UPDATE influencer_profiles SET phone=?,social_url=?,followers=? WHERE user_id=?")
      .run("01012345678", "https://instagram.com/creator", 100, creatorId);
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "Admin-password-123!" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const request = (payload: object) => app.request("/api/work/admin/influencers/grant-import-access", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal((await request({ expected_count: 2 })).status, 409);
    assert.deepEqual(await (await request({ expected_count: 1 })).json(), { count: 1, applied: false });
    let profile = db.prepare("SELECT * FROM influencer_profiles WHERE user_id=?").get(creatorId) as any;
    assert.equal(campaignEligible(profile), false);
    assert.deepEqual(await (await request({ expected_count: 1, dry_run: false })).json(), { count: 1, applied: true });
    profile = db.prepare("SELECT * FROM influencer_profiles WHERE user_id=?").get(creatorId) as any;
    assert.equal(campaignEligible(profile), true);
    assert.equal(profile.completed_count, 0);
    assert.equal(profile.onboarding_approved, 0);
    assert.equal(profile.tier, 0);
    assert.equal((db.prepare("SELECT must_change_password FROM users WHERE id=?").get(creatorId) as any).must_change_password, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM admin_audit WHERE actor_id=? AND action='campaign_access_grant'").get(adminId) as any).count, 1);
  } finally {
    db.close();
  }
});
