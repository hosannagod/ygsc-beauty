import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("brands see only public recruitment counts for other brands", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Test-password-123!";
    for (const [email, role] of [
      ["brand1@test.com", "brand"],
      ["brand2@test.com", "brand"],
      ["creator@test.com", "influencer"],
    ])
      db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)")
        .run(email, email, role, hashPassword(password));
    const now = Date.now();
    const insert = db.prepare(`INSERT INTO campaigns
      (id,brand_id,title,product,description,guidelines,capacity,pay_type,
       recruit_date,draft_date,final_date,recruit_start,recruit_due,draft_due,final_due,
       is_draft,status,published_at)
      VALUES (?,?,?,?,?,'Private guidelines',10,'gifted','','','',?,?,0,0,?,?,?)`);
    insert.run(1, 1, "Own", "Product", "Private description", now - 1000, now + 100000, 0, "recruiting", now);
    insert.run(2, 2, "Other public", "Product", "Private description", now - 1000, now + 100000, 0, "recruiting", now);
    insert.run(3, 2, "Other draft", "Product", "Private description", now - 1000, now + 100000, 1, "recruiting", 0);
    insert.run(4, 2, "Other closed", "Product", "Private description", now - 1000, now + 100000, 0, "closed", now);
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    for (const campaignId of [1, 2, 3, 4])
      db.prepare("INSERT INTO campaign_images(campaign_id,position,data) VALUES(?,?,?)")
        .run(campaignId, 0, image);
    db.prepare(`INSERT INTO applications(campaign_id,influencer_id,status,consent_at,phone,address)
      VALUES(2,3,'applied',1,'01012345678','')`).run();
    const app = createApp(db);
    const login = async (email: string) => {
      const response = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const brandCookie = await login("brand1@test.com");
    const response = await app.request("/api/work/brand/campaigns-overview", {
      headers: { Cookie: brandCookie },
    });
    assert.equal(response.status, 200);
    const rows = (await response.json() as any).campaigns;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      id: 2,
      title: "Other public",
      title_en: "",
      brand_name: "brand2@test.com",
      capacity: 10,
      recruit_start: now - 1000,
      recruit_due: now + 100000,
      published_at: now,
      thumbnail_id: 2,
      applicant_count: 1,
    });
    const thumbnail = await app.request("/api/work/brand/campaigns-overview/2/thumbnail", {
      headers: { Cookie: brandCookie },
    });
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), image);
    for (const campaignId of [1, 3, 4])
      assert.equal((await app.request(`/api/work/brand/campaigns-overview/${campaignId}/thumbnail`, {
        headers: { Cookie: brandCookie },
      })).status, 404);
    assert.equal((await app.request("/api/work/campaigns/2", { headers: { Cookie: brandCookie } })).status, 403);
    assert.equal((await app.request("/api/work/brand/campaigns-overview", {
      headers: { Cookie: await login("creator@test.com") },
    })).status, 403);
    assert.equal((await app.request("/api/work/brand/campaigns-overview/2/thumbnail", {
      headers: { Cookie: await login("creator@test.com") },
    })).status, 403);
  } finally {
    db.close();
  }
});
