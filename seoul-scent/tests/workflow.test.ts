import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import {
  deadline,
  externalLink,
  sweepDeadlines,
} from "../src/seoul/workflow.js";
const password = "Test-password-123!";
const future = (days: number) =>
  new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const campaign = {
  title: "서울 향기 협업",
  product: "테스트 향수",
  description: "서울의 향기를 담은 테스트 제품입니다.",
  guidelines: "원본 영상과 제품 사용 장면을 포함해 주세요.",
  capacity: 2,
  pay_type: "gifted",
  compensation: 0,
  recruit_date: future(2),
  draft_date: future(5),
  final_date: future(10),
};
async function fixture() {
  const db = openDb(":memory:"),
    app = createApp(db),
    cookies: Record<string, string> = {},
    ids: Record<string, number> = {};
  for (const [key, role] of Object.entries({
    brand: "brand",
    otherbrand: "brand",
    influencer: "influencer",
    other: "influencer",
    admin: "admin",
  })) {
    const r = db
      .prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      )
      .run(key + "@test.com", key, role, hashPassword(password));
    ids[key] = Number(r.lastInsertRowid);
    const response = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: key + "@test.com", password }),
    });
    cookies[key] = response.headers.get("set-cookie")!.split(";")[0];
  }
  const req = (key: string, path: string, method = "GET", data?: any) =>
    app.request("/api/work" + path, {
      method,
      headers: {
        Cookie: cookies[key] || "",
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  for (const key of ["influencer", "other"])
    assert.equal(
      (
        await req(key, "/profile", "PUT", {
          phone: "01012345678",
          address: "서울시 테스트구 테스트로 123",
          social_url: "https://instagram.com/test",
          followers: 10000,
        })
      ).status,
      200,
    );
  const create = async (extra = {}) => {
    const r = await req("brand", "/campaigns", "POST", {
      ...campaign,
      ...extra,
    });
    assert.equal(r.status, 201, await r.clone().text());
    return ((await r.json()) as any).id;
  };
  const apply = async (id: number, key = "influencer") => {
    const r = await req(key, `/campaigns/${id}/apply`, "POST", {
      consent: true,
    });
    assert.equal(r.status, 201, await r.clone().text());
    return ((await r.json()) as any).id;
  };
  const action = (id: number, name: string, data = {}, key = "brand") =>
    req(key, `/applications/${id}/action`, "POST", { action: name, ...data });
  return { db, app, req, create, apply, action, ids };
}
test("full lifecycle with revision history, consent, notifications, completion exactly once", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    assert.equal(
      (
        await f.req("influencer", `/campaigns/${c}/apply`, "POST", {
          consent: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.action(
          a,
          "final",
          { url: "https://instagram.com/p/test" },
          "influencer",
        )
      ).status,
      409,
    );
    assert.equal((await f.action(a, "select")).status, 200);
    assert.equal(
      (
        await f.action(a, "ship", {
          carrier: "CJ대한통운",
          tracking_number: "00123456789",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.action(
          a,
          "draft",
          {
            url: "https://drive.google.com/file/d/test/view",
            public_confirmed: false,
          },
          "influencer",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.action(
          a,
          "draft",
          {
            url: "https://drive.google.com/file/d/test/view",
            public_confirmed: true,
          },
          "influencer",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.action(a, "revision", {
          feedback: "제품을 더 가까이 촬영해 주세요.",
          revision_date: future(7),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.action(
          a,
          "draft",
          {
            url: "https://drive.google.com/file/d/revised/view",
            public_confirmed: true,
          },
          "influencer",
        )
      ).status,
      200,
    );
    assert.equal((await f.action(a, "approve")).status, 200);
    assert.equal(
      (
        await f.action(
          a,
          "final",
          { url: "https://www.instagram.com/reel/approved" },
          "influencer",
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.action(a, "complete", { views: 20000, best: true })).status,
      200,
    );
    assert.equal(
      (await f.action(a, "complete", { views: 20000, best: true })).status,
      409,
    );
    const p = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(f.ids.influencer) as any;
    assert.equal(p.completed_count, 1);
    assert.equal(p.total_views, 20000);
    const { application, events } = (await (
      await f.req("influencer", `/applications/${a}`)
    ).json()) as any;
    assert.equal(application.status, "completed");
    assert.equal(application.best, 1);
    assert.ok(application.consent_at);
    assert.equal(
      events.filter((e: any) => e.status === "draft_submitted").length,
      2,
    );
    assert.ok(
      events.some((e: any) => e.note === "제품을 더 가까이 촬영해 주세요."),
    );
    assert.ok(
      ((await (await f.req("influencer", "/notifications")).json()) as any)
        .unread >= 5,
    );
    await f.req("influencer", "/notifications/read", "POST", {});
    assert.equal(
      ((await (await f.req("influencer", "/notifications")).json()) as any)
        .unread,
      0,
    );
    assert.equal(
      (await f.req("brand", `/campaigns/${c}/complete`, "POST", {})).status,
      409,
    );
    await f.req("brand", `/campaigns/${c}/close`, "POST", {});
    assert.equal(
      (await f.req("brand", `/campaigns/${c}/complete`, "POST", {})).status,
      200,
    );
  } finally {
    f.db.close();
  }
});
test("ownership, role escalation, recruitment deadline, required consent and capacity", async () => {
  const f = await fixture();
  try {
    const c = await f.create({ capacity: 1 });
    assert.equal(
      (
        await f.req("influencer", `/campaigns/${c}/apply`, "POST", {
          consent: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.req("influencer", "/campaigns", "POST", campaign)).status,
      403,
    );
    const a = await f.apply(c),
      other = await f.apply(c, "other");
    for (const path of [
      `/campaigns/${c}`,
      `/applications/${a}`,
      `/campaigns/${c}/shipments.xlsx`,
    ])
      assert.equal((await f.req("otherbrand", path)).status, 403);
    assert.equal((await f.req("other", `/applications/${a}`)).status, 403);
    assert.equal((await f.action(a, "select", {}, "influencer")).status, 403);
    assert.equal((await f.action(a, "select", {}, "otherbrand")).status, 403);
    assert.equal((await f.action(a, "select")).status, 200);
    assert.equal((await f.action(other, "select")).status, 409);
    assert.equal((await f.req("brand", "/admin/users")).status, 403);
    assert.equal(
      (await f.req("brand", "/admin/settings", "PUT", {})).status,
      403,
    );
    const third = await f.create();
    f.db
      .prepare("UPDATE campaigns SET recruit_due=? WHERE id=?")
      .run(Date.now() - 1, third);
    assert.equal(
      (
        await f.req("influencer", `/campaigns/${third}/apply`, "POST", {
          consent: true,
        })
      ).status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("Asia/Seoul midnight and safe external link validation", () => {
  assert.equal(deadline("2026-10-09"), Date.parse("2026-10-09T15:00:00Z"));
  assert.throws(() => deadline("2026-02-30"));
  for (const url of [
    "javascript:alert(1)",
    "https://drive.google.com.evil.test/file/d/a/view",
    "https://drive.google.com/drive/folders/abc",
    "https://user:pass@drive.google.com/file/d/a/view",
  ])
    assert.throws(() => externalLink(url, true));
  for (const url of [
    "https://instagram.com/username",
    "https://youtube.com/watch",
    "http://instagram.com/p/abc",
    "https://evil.test/video",
  ])
    assert.throws(() => externalLink(url, false));
  assert.ok(externalLink("https://youtu.be/12345", false));
  assert.ok(externalLink("https://drive.google.com/open?id=12345", true));
});
test("no-show is idempotent, blocks new applications, demotes, blacklists on second campaign", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    await f.action(a, "select");
    f.db
      .prepare("UPDATE influencer_profiles SET tier=3 WHERE user_id=?")
      .run(f.ids.influencer);
    const now = Date.now();
    f.db.prepare("UPDATE campaigns SET draft_due=? WHERE id=?").run(now - 1, c);
    assert.equal(sweepDeadlines(f.db, now).penalized, 1);
    assert.equal(sweepDeadlines(f.db, now).penalized, 0);
    let p = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(f.ids.influencer) as any;
    assert.equal(p.no_show_count, 1);
    assert.equal(p.tier, 2);
    assert.equal(p.blacklisted, 0);
    assert.ok(p.blocked_until > now);
    const next = await f.create();
    assert.equal(
      (
        await f.req("influencer", `/campaigns/${next}/apply`, "POST", {
          consent: true,
        })
      ).status,
      403,
    );
    f.db
      .prepare("UPDATE influencer_profiles SET blocked_until=0 WHERE user_id=?")
      .run(f.ids.influencer);
    const b = await f.apply(next);
    await f.action(b, "select");
    f.db
      .prepare("UPDATE campaigns SET draft_due=? WHERE id=?")
      .run(now - 1, next);
    sweepDeadlines(f.db, now);
    p = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(f.ids.influencer) as any;
    assert.equal(p.no_show_count, 2);
    assert.equal(p.blacklisted, 1);
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS n FROM application_events WHERE status='no_show'",
          )
          .get() as any
      ).n,
      2,
    );
  } finally {
    f.db.close();
  }
});
test("brand review delay is not no-show; revised deadline and reminder deduplication", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    await f.action(a, "select");
    await f.action(a, "ship", {
      carrier: "택배사",
      tracking_number: "0123456",
    });
    await f.action(
      a,
      "draft",
      { url: "https://drive.google.com/file/d/a/view", public_confirmed: true },
      "influencer",
    );
    f.db
      .prepare("UPDATE campaigns SET draft_due=? WHERE id=?")
      .run(Date.now() - 1, c);
    assert.equal(sweepDeadlines(f.db).penalized, 0);
    await f.action(a, "revision", {
      feedback: "제품 장면을 다시 촬영해 주세요.",
      revision_date: future(7),
    });
    assert.equal(sweepDeadlines(f.db).penalized, 0);
    const due = Date.now() + 3600_000;
    f.db
      .prepare("UPDATE applications SET revision_due=? WHERE id=?")
      .run(due, a);
    sweepDeadlines(f.db);
    sweepDeadlines(f.db);
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS n FROM notifications WHERE event_key LIKE 'reminder:%'",
          )
          .get() as any
      ).n,
      1,
    );
    assert.equal(sweepDeadlines(f.db, due).penalized, 1);
  } finally {
    f.db.close();
  }
});
test("XLSX export and atomic import preserve text tracking and reject foreign applications", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    await f.action(a, "select");
    const download = await f.req("brand", `/campaigns/${c}/shipments.xlsx`);
    assert.equal(download.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await download.arrayBuffer()) as any);
    const sheet = book.worksheets[0];
    assert.equal(sheet.getCell("A2").value, a);
    assert.equal(sheet.getCell("C2").value, "01012345678");
    sheet.getCell("E2").value = "CJ대한통운";
    sheet.getCell("F2").value = "00123456789";
    const file = Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
    const imported = await f.req(
      "brand",
      `/campaigns/${c}/shipments/import`,
      "POST",
      { file },
    );
    assert.equal(imported.status, 200);
    assert.equal(
      (
        f.db
          .prepare("SELECT tracking_number FROM applications WHERE id=?")
          .get(a) as any
      ).tracking_number,
      "00123456789",
    );
    const other = await f.create(),
      b = await f.apply(other);
    await f.action(b, "select");
    sheet.addRow([
      b,
      "타 캠페인",
      "01000000000",
      "다른 주소",
      "택배사",
      "99999999",
    ]);
    sheet.getCell("F2").value = "changed123";
    assert.equal(
      (
        await f.req("brand", `/campaigns/${c}/shipments/import`, "POST", {
          file: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT tracking_number FROM applications WHERE id=?")
          .get(a) as any
      ).tracking_number,
      "00123456789",
    );
  } finally {
    f.db.close();
  }
});
test("admin tier settings validate, recalculate and retain penalty history", async () => {
  const f = await fixture();
  try {
    const { settings } = (await (
      await f.req("admin", "/admin/settings")
    ).json()) as any;
    assert.equal(
      (
        await f.req("admin", "/admin/settings", "PUT", {
          ...settings,
          demotion: 3,
        })
      ).status,
      400,
    );
    f.db
      .prepare(
        "UPDATE influencer_profiles SET completed_count=12,total_views=25000 WHERE user_id=?",
      )
      .run(f.ids.influencer);
    assert.equal(
      (await f.req("admin", "/admin/settings", "PUT", settings)).status,
      200,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT tier FROM influencer_profiles WHERE user_id=?")
          .get(f.ids.influencer) as any
      ).tier,
      2,
    );
  } finally {
    f.db.close();
  }
});
test("final deadline penalty, manual release authorization and immutable no-show history", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    await f.action(a, "select");
    await f.action(a, "ship", {
      carrier: "택배사",
      tracking_number: "1234567",
    });
    await f.action(
      a,
      "draft",
      { url: "https://drive.google.com/file/d/a/view", public_confirmed: true },
      "influencer",
    );
    await f.action(a, "approve");
    const due = Date.now() - 1;
    f.db.prepare("UPDATE campaigns SET final_due=? WHERE id=?").run(due, c);
    assert.equal(sweepDeadlines(f.db).penalized, 1);
    assert.equal(
      (
        await f.action(
          a,
          "final",
          { url: "https://instagram.com/reel/late" },
          "influencer",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.req(
          "brand",
          `/admin/users/${f.ids.influencer}/release`,
          "POST",
          { note: "예외 사항 확인 후 해제" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.req(
          "admin",
          `/admin/users/${f.ids.influencer}/release`,
          "POST",
          { note: "짧음" },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.req(
          "admin",
          `/admin/users/${f.ids.influencer}/release`,
          "POST",
          { note: "예외 사항 확인 후 해제" },
        )
      ).status,
      200,
    );
    const p = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(f.ids.influencer) as any;
    assert.equal(p.blocked_until, 0);
    assert.equal(p.blacklisted, 0);
    assert.equal(p.no_show_count, 1);
    assert.equal(
      (f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit").get() as any).n,
      1,
    );
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS n FROM application_events WHERE status='no_show'",
          )
          .get() as any
      ).n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("profile updates cannot overwrite tier, penalty or participation counters", async () => {
  const f = await fixture();
  try {
    await f.req("influencer", "/profile", "PUT", {
      phone: "01099999999",
      address: "서울시 다른 테스트로 123",
      social_url: "https://instagram.com/test",
      followers: 123,
      tier: 3,
      completed_count: 100,
      blacklisted: 0,
    });
    const p = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(f.ids.influencer) as any;
    assert.equal(p.tier, 0);
    assert.equal(p.completed_count, 0);
    const c = await f.create(),
      a = await f.apply(c);
    await f.req("influencer", "/profile", "PUT", {
      phone: "01088888888",
      address: "변경된 배송지 테스트 주소 123",
      social_url: "https://instagram.com/test",
      followers: 456,
    });
    assert.equal(
      (f.db.prepare("SELECT phone FROM applications WHERE id=?").get(a) as any)
        .phone,
      "01099999999",
    );
  } finally {
    f.db.close();
  }
});
test("XLSX expansion guard rejects non-archives and oversized central-directory entries", async () => {
  const { validateWorkbookArchive } =
    await import("../src/seoul/xlsx-safety.js");
  assert.throws(() => validateWorkbookArchive(Buffer.from("not a zip")));
  const book = new ExcelJS.Workbook();
  book.addWorksheet("test").addRow(["ok"]);
  const good = Buffer.from(await book.xlsx.writeBuffer());
  assert.doesNotThrow(() => validateWorkbookArchive(good));
  const bad = Buffer.from(good);
  const central = bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bad.writeUInt32LE(100 * 1024 * 1024, central + 24);
  assert.throws(() => validateWorkbookArchive(bad));
});
