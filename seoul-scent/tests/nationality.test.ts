import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { importInfluencers } from "../src/seoul/influencer-import.js";

test("nationality is optional, editable by creator or admin, exposed to owning brand and preserves other profile data", async () => {
  const db = openDb(":memory:");
  try {
    const password = "Strong-password-123!",
      hash = hashPassword(password);
    for (const role of ["admin", "brand", "influencer"])
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      ).run(role + "@test.com", "Test User", role, hash);
    db.prepare(
      "UPDATE influencer_profiles SET phone='01012345678',social_url='https://instagram.com/test',followers=1234,completed_count=2,import_review_required=1 WHERE user_id=3",
    ).run();
    db.prepare(
      "INSERT INTO campaigns(id,brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,is_draft,status) VALUES(1,2,'Project','Product','Description','Guide',50,'gifted','','','',0,0,0,1,'closed')",
    ).run();
    db.prepare(
      "INSERT INTO applications(campaign_id,influencer_id,status,consent_at,phone,address) VALUES(1,3,'applied',0,'','')",
    ).run();
    const app = createApp(db);
    const login = async (role: string) => {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: role + "@test.com", password }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    const cookies = {
      admin: await login("admin"),
      brand: await login("brand"),
      influencer: await login("influencer"),
    };
    const call = (role: keyof typeof cookies, path: string, body?: any) =>
      app.request("/api/work" + path, {
        method: body ? "PUT" : "GET",
        headers: { Cookie: cookies[role], "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal(
      (await call("brand", "/admin/users/3/profile", { nationality: "한국" }))
        .status,
      403,
    );
    assert.equal(
      (await call("admin", "/admin/users/3/profile", { nationality: "베트남" }))
        .status,
      200,
    );
    let p = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=3")
      .get() as any;
    assert.equal(p.nationality, "베트남");
    assert.equal(p.followers, 1234);
    assert.equal(p.completed_count, 2);
    assert.equal(p.import_review_required, 1);
    assert.equal(
      (
        await call("admin", "/admin/users/3/profile", {
          nationality: "a".repeat(81),
          followers: 20,
        })
      ).status,
      400,
    );
    p = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=3")
      .get() as any;
    assert.equal(p.followers, 1234);
    assert.equal(p.nationality, "베트남");
    const list = (await (await call("brand", "/campaigns/1")).json()) as any;
    assert.equal(list.applications[0].nationality, "베트남");
    const data = {
      phone: "01012345678",
      social_url: "https://instagram.com/test",
      followers: 1234,
    };
    assert.equal(
      (
        await call("influencer", "/profile", {
          ...data,
          nationality: "Indonesia",
        })
      ).status,
      200,
    );
    assert.equal((await call("influencer", "/profile", data)).status, 200);
    assert.equal(
      ((await (await call("influencer", "/profile")).json()) as any).profile
        .nationality,
      "Indonesia",
    );
    assert.equal(
      (
        await call("admin", "/admin/users/3/profile", {
          nationality: "China\nJapan",
        })
      ).status,
      400,
    );
  } finally {
    db.close();
  }
});

test("nationality import and on-disk restart keep existing profiles and historical records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seoul-nationality-"));
  let db = openDb(join(dir, "test.db"));
  try {
    const book = new ExcelJS.Workbook(),
      s = book.addWorksheet("명단");
    s.addRow(["성함", "이메일", "국적 (Nationality)", "Nationality / 국적"]);
    s.addRow(["Creator", "creator@test.com", "", "Nepal"]);
    const result = await importInfluencers(
      db,
      Buffer.from(await book.xlsx.writeBuffer()),
      "0000",
      false,
    );
    assert.equal(result.imported, 1);
    const u = db
      .prepare("SELECT id FROM users WHERE email='creator@test.com'")
      .get() as any;
    db.prepare(
      "INSERT INTO historical_activities(user_id,project_key,content_links,submitted_at,imported_at) VALUES(?,'Project','[]','',1)",
    ).run(u.id);
    db.close();
    db = openDb(join(dir, "test.db"));
    assert.equal(
      (
        db
          .prepare(
            "SELECT nationality FROM influencer_profiles WHERE user_id=?",
          )
          .get(u.id) as any
      ).nationality,
      "Nepal",
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM historical_activities WHERE user_id=?",
          )
          .get(u.id) as any
      ).n,
      1,
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
