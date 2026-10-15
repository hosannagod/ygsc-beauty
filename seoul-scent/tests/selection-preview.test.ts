import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword, verifyPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";

test("admin can create a private selected-state preview without sending mail or changing real campaigns", async () => {
  const db = openDb(":memory:");
  try {
    const pass = "Existing-strong-password-123!";
    for (const role of ["admin", "brand"])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(`${role}@test.com`, role, role, hashPassword(pass));
    const app = createApp(db);
    const login = (email: string, password: string) =>
      app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    const post = (cookie = "") =>
      app.request("/api/work/admin/selection-preview", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: "{}",
      });
    assert.equal((await post()).status, 401);
    const brandCookie = (await login("brand@test.com", pass)).headers
      .get("set-cookie")!
      .split(";")[0];
    assert.equal((await post(brandCookie)).status, 403);
    const adminCookie = (await login("admin@test.com", pass)).headers
      .get("set-cookie")!
      .split(";")[0];
    const response = await post(adminCookie);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const created = (await response.json()) as any;
    assert.equal(created.email, "preview.influencer@example.invalid");
    assert.ok(created.password.length >= 20);
    const user = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(created.email) as any;
    assert.equal(user.role, "influencer");
    assert.equal(user.username, "influtest");
    assert.ok(verifyPassword(created.password, user.password_hash));
    const campaign = db
      .prepare("SELECT * FROM campaigns WHERE id=?")
      .get(created.campaign_id) as any;
    assert.equal(campaign.is_draft, 1);
    assert.equal(campaign.status, "closed");
    assert.equal(campaign.capacity, 1);
    const application = db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(created.application_id) as any;
    assert.equal(application.status, "selected");
    assert.equal(application.influencer_id, user.id);
    assert.equal(application.participation_confirmed_at, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM email_outbox").get() as any).n,
      0,
    );
    assert.equal((await post(adminCookie)).status, 409);
    const previewLogin = await login(created.email, created.password);
    assert.equal(previewLogin.status, 200);
    const previewCookie = previewLogin.headers.get("set-cookie")!.split(";")[0];
    const request = (path: string) =>
      app.request(`/api/work${path}`, { headers: { Cookie: previewCookie } });
    const listing = (await (await request("/applications")).json()) as any;
    assert.equal(listing.applications.length, 1);
    assert.equal(listing.applications[0].status, "selected");
    const detail = (await (
      await request(`/applications/${created.application_id}`)
    ).json()) as any;
    assert.equal(detail.application.status, "selected");
    assert.equal(detail.application.participation_confirmed_at, 0);
    const profile = (await (await request("/profile")).json()) as any;
    assert.equal(profile.profile.postal_code, "00000");
    const catalog = (await (await request("/campaigns")).json()) as any;
    assert.equal(catalog.campaigns.length, 0);
    db.prepare("UPDATE users SET username=NULL WHERE id=?").run(user.id);
    const rename = (cookie = "") =>
      app.request("/api/work/admin/selection-preview/username", {
        method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: "{}",
      });
    assert.equal((await rename()).status, 401);
    assert.equal((await rename(brandCookie)).status, 403);
    assert.equal((await rename(adminCookie)).status, 200);
    assert.equal((await rename(adminCookie)).status, 200);
    assert.equal(
      (db.prepare("SELECT username FROM users WHERE id=?").get(user.id) as any)
        .username,
      "influtest",
    );
    assert.equal((await login("influtest", created.password)).status, 200);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM admin_audit WHERE action='selection_preview_username'",
          )
          .get() as any
      ).n,
      1,
    );
  } finally {
    db.close();
  }
});
