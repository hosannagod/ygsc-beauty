import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("public campaigns lead to the selected campaign after authentication", async () => {
  const db = openDb(":memory:");
  try {
    const brand = Number(db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES('brand@test.com','Brand','brand','test')").run().lastInsertRowid);
    const influencer = Number(db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES('creator@test.com','Creator','influencer',?)").run(hashPassword("Test-password-123!")).lastInsertRowid);
    const addCampaign = (title: string, isDraft = 0) => Number(db.prepare(`INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status,recruit_start,is_draft) VALUES(?,?,'Product','Description','Guide',10,'gifted','2030-01-01','2030-01-10','2030-01-20',?,?,?,'recruiting',?,?)`).run(brand, title, Date.now() + 86400000, Date.now() + 864000000, Date.now() + 1728000000, Date.now() - 86400000, isDraft).lastInsertRowid);
    const campaign = addCampaign("Public campaign");
    addCampaign("Hidden draft", 1);
    const app = createApp(db);
    const home = await app.request("/");
    const homeHtml = await home.text();
    assert.equal(home.status, 200);
    assert.match(homeHtml, /Public campaign/);
    assert.match(homeHtml, new RegExp(`href="/continue/${campaign}"`));
    assert.doesNotMatch(homeHtml, /Hidden draft/);
    const gate = await app.request(`/continue/${campaign}`);
    const gateHtml = await gate.text();
    assert.match(gateHtml, new RegExp(`/login\\?campaign=${campaign}`));
    assert.match(gateHtml, new RegExp(`/register\\?campaign=${campaign}`));
    const selectedLogin = await (await app.request(`/login?campaign=${campaign}`)).text();
    assert.match(selectedLogin, /Public campaign/);
    assert.equal((await app.request(`/campaigns/${campaign}`)).headers.get("location"), `/continue/${campaign}`);
    assert.equal((await app.request("/continue/999999")).status, 404);
    const login = await app.request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "creator@test.com", password: "Test-password-123!" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await app.request(`/continue/${campaign}`, { headers: { Cookie: cookie } })).headers.get("location"), `/campaigns/${campaign}`);
    assert.equal((await app.request(`/campaigns/${campaign}`, { headers: { Cookie: cookie } })).status, 200);
    assert.ok(influencer > 0);
  } finally {
    db.close();
  }
});
