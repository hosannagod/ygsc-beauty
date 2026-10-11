import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { openDb, hashPassword, verifyPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import {
  importSecondProject,
  secondProjectBrands,
} from "../src/seoul/project-import.js";
import { finalizeSelection } from "../src/seoul/selection.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture() {
  const book = new ExcelJS.Workbook();
  for (const b of secondProjectBrands) {
    const sheet = book.addWorksheet(b.sheet);
    sheet.addRow([
      "타임스탬프",
      "성함",
      "연락처",
      "이메일",
      "주소",
      "SNS",
      "채널",
      "이력",
      "선택",
      "활동",
      "2차 활용",
      "개인정보",
    ]);
    sheet.addRow([
      "2026-10-01",
      "Creator",
      "01012345678",
      "creator@example.test",
      "Seoul address 123",
      "https://instagram.com/creator",
      "Instagram",
      "Yes",
      `[${b.name}]`,
      "동의합니다 / I agree",
      b.username === "varihope"
        ? "동의하지 않습니다 / I disagree"
        : "동의합니다 / I agree",
      "동의합니다 / I agree",
    ]);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("imported drafts survive server restarts without losing accounts, applications or unset schedules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seoul-restart-"));
  const path = join(dir, "db.sqlite");
  let db = openDb(path);
  try {
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('admin@test.com','Admin','admin',?)",
    ).run(hashPassword("Restart-test-password-123!"));
    await importSecondProject(db, await fixture(), 1, false);
    const before = db
      .prepare(
        "SELECT id,email,username,password_hash,must_change_password FROM users ORDER BY id",
      )
      .all();
    const applications = db
      .prepare("SELECT * FROM applications ORDER BY id")
      .all();
    const brand = (
      db.prepare("SELECT id FROM users WHERE username='airmood'").get() as any
    ).id;
    db.prepare(
      "INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due) VALUES(?,'Legacy published','Product','Description','Guidelines',10,'gifted','2030-01-01','2030-01-02','2030-01-03',1,2,3)",
    ).run(brand);
    for (let restart = 0; restart < 2; restart++) {
      db.close();
      db = openDb(path);
      assert.equal((await createApp(db).request("/health")).status, 200);
      assert.deepEqual(
        db
          .prepare(
            "SELECT id,email,username,password_hash,must_change_password FROM users ORDER BY id",
          )
          .all(),
        before,
      );
      assert.deepEqual(
        db.prepare("SELECT * FROM applications ORDER BY id").all(),
        applications,
      );
      const drafts = db
        .prepare("SELECT * FROM campaigns WHERE is_draft=1 ORDER BY id")
        .all() as any[];
      assert.equal(drafts.length, 4);
      assert.ok(
        drafts.every(
          (c) =>
            c.recruit_start_date === "" &&
            c.recruit_start === 0 &&
            c.recruit_date === "" &&
            c.final_due === 0 &&
            c.capacity === 50,
        ),
      );
      assert.ok(
        (
          db
            .prepare("SELECT recruit_start FROM campaigns WHERE is_draft=0")
            .get() as any
        ).recruit_start > 0,
      );
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("project import creates only drafts, preserves existing members and is idempotent", async () => {
  const db = openDb(":memory:");
  try {
    const password = hashPassword("Existing-password-123!");
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('admin@example.test','Admin','admin',?)",
    ).run(password);
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('creator@example.test','Existing Creator','influencer',?)",
    ).run(password);
    db.prepare(
      "UPDATE influencer_profiles SET completed_count=3,followers=12345 WHERE user_id=2",
    ).run();
    const file = await fixture();
    const preview = await importSecondProject(db, file, 1, true);
    assert.equal(preview.applications, 4);
    assert.equal(
      (db.prepare("SELECT count(*) n FROM campaigns").get() as any).n,
      0,
    );
    const imported = await importSecondProject(db, file, 1, false);
    assert.equal(imported.brands_created, 4);
    assert.equal(imported.accounts_created, 0);
    assert.equal(imported.imported, 4);
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) n FROM campaigns WHERE is_draft=1 AND final_due=0",
          )
          .get() as any
      ).n,
      4,
    );
    assert.equal(
      (db.prepare("SELECT password_hash FROM users WHERE id=2").get() as any)
        .password_hash,
      password,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT completed_count FROM influencer_profiles WHERE user_id=2",
          )
          .get() as any
      ).completed_count,
      3,
    );
    assert.equal(
      (db.prepare("SELECT count(*) n FROM email_outbox").get() as any).n,
      0,
    );
    const brand = db
      .prepare("SELECT * FROM users WHERE username='varihope'")
      .get() as any;
    assert.ok(verifyPassword("0000", brand.password_hash));
    assert.equal(brand.must_change_password, 1);
    const repeated = await importSecondProject(db, file, 1, false);
    assert.equal(repeated.imported, 0);
    assert.equal(repeated.brands_created, 0);
    const app = createApp(db, false);
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "creator@example.test",
        password: "Existing-password-123!",
      }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await app.request("/api/work/admin/projects/second/import", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            file: file.toString("base64"),
            dry_run: true,
          }),
        })
      ).status,
      403,
    );
    const list = (await (
      await app.request("/api/work/campaigns", { headers: { Cookie: cookie } })
    ).json()) as any;
    assert.equal(list.campaigns.length, 0);
    assert.equal(
      (
        await app.request("/api/work/campaigns/" + imported.campaigns![0].id, {
          headers: { Cookie: cookie },
        })
      ).status,
      404,
    );
    const loginBrand = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "varihope", password: "0000" }),
    });
    assert.equal(((await loginBrand.json()) as any).redirect, "/account");
    const brandCookie = loginBrand.headers.get("set-cookie")!.split(";")[0];
    const account = (await (
      await app.request("/api/account", { headers: { Cookie: brandCookie } })
    ).json()) as any;
    assert.equal(account.account.email, "");
    assert.equal(account.account.username, "varihope");
    const updated = await app.request("/api/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: brandCookie },
      body: JSON.stringify({
        email: "",
        phone: "",
        contact_name: "",
        current_password: "0000",
        new_password: "Changed-password-123!",
        confirm_password: "Changed-password-123!",
      }),
    });
    assert.equal(updated.status, 200);
    const cookie2 = updated.headers.get("set-cookie")!.split(";")[0];
    const campaignId = imported.campaigns![0].id;
    const publish = await app.request(
      `/api/work/campaigns/${campaignId}/details`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie2 },
        body: JSON.stringify({
          capacity: 10,
          recruit_start_date: "2040-01-01",
          recruit_date: "2040-01-02",
          final_date: "2040-01-03",
          review_required: false,
          publish: true,
        }),
      },
    );
    assert.equal(publish.status, 200);
    const application = db
      .prepare("SELECT * FROM applications WHERE campaign_id=?")
      .get(campaignId) as any;
    assert.equal(
      finalizeSelection(db, brand, campaignId, [application.id]).selected,
      1,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT original_delivery_consent FROM applications WHERE id=?",
          )
          .get(application.id) as any
      ).original_delivery_consent,
      0,
    );
    const addressBeforeConsent = await app.request(
      `/api/work/applications/${application.id}/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          action: "address",
          recipient_name: "Creator",
          phone: "01012345678",
          postal_code: "12345",
          address: "Seoul address 123",
        }),
      },
    );
    assert.equal(addressBeforeConsent.status, 409);
    const agree = await app.request(
      `/api/work/applications/${application.id}/consent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          secondary_use_consent: true,
          original_delivery_consent: true,
        }),
      },
    );
    assert.equal(agree.status, 200);
    assert.equal(
      (
        db
          .prepare("SELECT status FROM applications WHERE id=?")
          .get(application.id) as any
      ).status,
      "selected",
    );
    assert.equal(
      (
        await app.request(`/api/work/applications/${application.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({
            action: "address",
            recipient_name: "Creator",
            phone: "01012345678",
            postal_code: "12345",
            address: "Seoul address 123",
          }),
        })
      ).status,
      200,
    );
  } finally {
    db.close();
  }
});
test("project import rejects account role collisions without partial writes", async () => {
  const db = openDb(":memory:");
  try {
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('creator@example.test','Existing Brand','brand','test')",
    ).run();
    await assert.rejects(
      importSecondProject(db, await fixture(), 1, false),
      /충돌/,
    );
    assert.equal(
      (db.prepare("SELECT count(*) n FROM campaigns").get() as any).n,
      0,
    );
    assert.equal(
      (db.prepare("SELECT count(*) n FROM users").get() as any).n,
      1,
    );
  } finally {
    db.close();
  }
});

test("imported drafts allow selection before consent and list applicants by completed participation", async () => {
  const db = openDb(":memory:");
  const previousProvider = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_PROVIDER = "brevo";
  try {
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES('admin@test.com','Admin','admin','test')",
    ).run();
    const imported = await importSecondProject(db, await fixture(), 1, false);
    const campaignId = imported.campaigns![0].id;
    const brand = db
      .prepare("SELECT * FROM users WHERE username='varihope'")
      .get() as any;
    db.prepare(
      "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",
    ).run(hashPassword("Brand-password-123!"), brand.id);
    const original = db
      .prepare("SELECT id FROM applications WHERE campaign_id=?")
      .get(campaignId) as any;
    const expected: number[] = [];
    for (const count of [10, 50, 3]) {
      const user = Number(
        db
          .prepare(
            "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,'influencer','test')",
          )
          .run(`creator${count}@example.test`, `Creator ${count}`)
          .lastInsertRowid,
      );
      db.prepare(
        "UPDATE influencer_profiles SET completed_count=? WHERE user_id=?",
      ).run(count, user);
      expected.push(
        Number(
          db
            .prepare(
              "INSERT INTO applications(campaign_id,influencer_id,consent_at,phone,address) VALUES(?,?,1,'01012345678','')",
            )
            .run(campaignId, user).lastInsertRowid,
        ),
      );
    }
    const app = createApp(db, false);
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "varihope",
        password: "Brand-password-123!",
      }),
    });
    const Cookie = login.headers.get("set-cookie")!.split(";")[0];
    const detail = (await (
      await app.request(`/api/work/campaigns/${campaignId}`, {
        headers: { Cookie },
      })
    ).json()) as any;
    assert.deepEqual(
      detail.applications.map((a: any) => a.completed_count),
      [50, 10, 3, 0],
    );
    const selected = await app.request(
      `/api/work/campaigns/${campaignId}/selection`,
      {
        method: "POST",
        headers: { Cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ application_ids: [original.id] }),
      },
    );
    assert.equal(selected.status, 200, await selected.text());
    const row = db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(original.id) as any;
    assert.equal(row.status, "selected");
    assert.equal(row.original_delivery_consent, 0);
    assert.equal(row.secondary_use_consent, 0);
    assert.equal(
      (db.prepare("SELECT count(*) n FROM email_outbox").get() as any).n,
      1,
    );
    assert.throws(() =>
      finalizeSelection(db, brand, campaignId, [original.id]),
    );
    assert.equal(
      (db.prepare("SELECT count(*) n FROM email_outbox").get() as any).n,
      1,
    );
  } finally {
    if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previousProvider;
    db.close();
  }
});
