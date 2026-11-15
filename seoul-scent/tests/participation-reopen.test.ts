import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("admin can reopen an expired selection so its influencer can confirm and submit", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Test-password-123!";
    for (const [email, role] of [
      ["admin@test.com", "admin"],
      ["brand@test.com", "brand"],
      ["creator@test.com", "influencer"],
    ])
      db.prepare("INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)")
        .run(email, email, role, hashPassword(password));
    const finalDue = Date.now() + 86400000;
    db.prepare("INSERT INTO campaigns(id,brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,review_required,status) VALUES(1,2,'Cream','Product','Description','Guide',10,'gifted','2026-11-01','2026-11-02','2026-11-16',?,?,?,0,'closed')")
      .run(Date.now() - 86400000, Date.now() - 86400000, finalDue);
    db.prepare("INSERT INTO applications(id,campaign_id,influencer_id,status,consent_at,consent_version,secondary_use_consent,original_delivery_consent,phone,address,postal_code,recipient_name,participation_due) VALUES(1,1,3,'selected',?,'secondary-and-original-v2',1,1,'01012345678','Seoul Street 10','12345','Creator',?)")
      .run(Date.now(), Date.now() - 1000);
    const app = createApp(db);
    const cookie = async (email: string) => {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    const admin = await cookie("admin@test.com"),
      brand = await cookie("brand@test.com"),
      creator = await cookie("creator@test.com");
    const post = (url: string, auth: string, data: object) => app.request(url, {
      method: "POST",
      headers: { Cookie: auth, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const address = {
      action: "address", recipient_name: "Creator", phone: "01012345678",
      postal_code: "12345", address: "Seoul Street 10", address_detail: "",
      participation_confirmed: true, guidelines_confirmed: true,
      deadline_confirmed: true,
    };
    assert.equal((await post("/api/work/applications/1/action", creator, address)).status, 409);
    const route = "/api/work/admin/applications/1/reopen-participation";
    assert.equal((await post(route, brand, { confirm_email: "creator@test.com" })).status, 403);
    assert.equal((await post(route, admin, { confirm_email: "other@test.com" })).status, 409);
    const reopened = await post(route, admin, { confirm_email: "creator@test.com" });
    assert.equal(reopened.status, 200);
    const result = await reopened.json() as any;
    assert.ok(result.participation_due > Date.now());
    assert.ok(result.participation_due <= finalDue);
    assert.equal((await post(route, admin, { confirm_email: "creator@test.com" })).status, 200);
    assert.equal((await post("/api/work/applications/1/action", creator, address)).status, 200);
    const submitted = await post("/api/work/applications/1/action", creator, { action: "final", url: "https://www.instagram.com/p/example/" });
    assert.equal(submitted.status, 200, await submitted.text());
    const application = db.prepare("SELECT status,final_url,participation_confirmed_at FROM applications WHERE id=1").get() as any;
    assert.equal(application.status, "final_submitted");
    assert.equal(application.final_url, "https://www.instagram.com/p/example/");
    assert.ok(application.participation_confirmed_at > 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='application_participation_reopen'").get() as any).n, 1);
  } finally {
    db.close();
  }
});
