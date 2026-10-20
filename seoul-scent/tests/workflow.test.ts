import { readFileSync } from "node:fs";
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
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 86400_000));
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
  db.prepare("UPDATE influencer_profiles SET onboarding_approved=1").run();
  const create = async (extra = {}) => {
    const r = await req("brand", "/campaigns", "POST", {
      ...campaign,
      ...extra,
    });
    assert.equal(r.status, 201, await r.clone().text());
    const id = ((await r.json()) as any).id;
    const published = await req("brand", `/campaigns/${id}/details`, "PUT", { publish: true });
    assert.equal(published.status, 200, await published.clone().text());
    return id;
  };
  const apply = async (id: number, key = "influencer") => {
    const r = await req(key, `/campaigns/${id}/apply`, "POST", {
      secondary_use_consent: true,
      original_delivery_consent: true,
    });
    assert.equal(r.status, 201, await r.clone().text());
    return ((await r.json()) as any).id;
  };
  const action = async (id: number, name: string, data = {}, key = "brand") => {
    const response = await req(key, `/applications/${id}/action`, "POST", {
      action: name,
      ...data,
    });
    if (name === "select" && response.status === 200) {
      const row = db
        .prepare("SELECT influencer_id FROM applications WHERE id=?")
        .get(id) as any;
      const owner = Object.keys(ids).find((k) => ids[k] === row.influencer_id)!;
      const address = await req(owner, `/applications/${id}/action`, "POST", {
        action: "address",
        recipient_name: "테스트 수령인",
        phone: "01012345678",
        postal_code: "06234",
        address: "서울시 강남구 테스트로 123",
        address_detail: "101호",
        participation_confirmed: true,
        guidelines_confirmed: true,
        deadline_confirmed: true,
      });
      assert.equal(address.status, 200);
    }
    return response;
  };
  return { db, app, req, create, apply, action, ids };
}
test("new campaigns stay private until reviewed and explicitly published", async () => {
  const f = await fixture();
  try {
    const response = await f.req("brand", "/campaigns", "POST", campaign);
    assert.equal(response.status, 201);
    const id = ((await response.json()) as any).id;
    const path = `/campaigns/${id}`;
    assert.equal((await (await f.req("brand", path)).json() as any).campaign.is_draft, 1);
    assert.equal((await f.req("influencer", path)).status, 404);
    assert.ok(!(await (await f.req("influencer", "/campaigns")).json() as any).campaigns.some((row: any) => row.id === id));
    assert.equal((await f.req("brand", `${path}/details`, "PUT", { title: "검토한 캠페인" })).status, 200);
    assert.equal((await (await f.req("brand", path)).json() as any).campaign.is_draft, 1);
    assert.equal((await f.req("otherbrand", `${path}/details`, "PUT", { publish: true })).status, 403);
    assert.equal((await f.req("brand", `${path}/details`, "PUT", { publish: true })).status, 200);
    assert.equal((await (await f.req("influencer", path)).json() as any).campaign.title, "검토한 캠페인");
    assert.equal((await f.req("brand", `${path}/details`, "PUT", { publish: true })).status, 409);
  } finally {
    f.db.close();
  }
});
test("campaign guide documents support link-only content, safe URLs and partial edits", async () => {
  const f = await fixture();
  try {
    const url = "https://docs.google.com/document/d/guide/edit?usp=sharing";
    const id = await f.create({ guidelines: "", guidelines_url: url });
    const detail = async () =>
      (await (await f.req("influencer", `/campaigns/${id}`)).json()) as any;
    assert.equal((await detail()).campaign.guidelines_url, url);
    assert.equal((await detail()).campaign.guidelines, "");
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          title: "가이드 문서 캠페인",
        })
      ).status,
      200,
    );
    assert.equal((await detail()).campaign.guidelines_url, url);
    for (const invalid of [
      "javascript:alert(1)",
      "https://secret:password@example.com",
      "invalid-url",
    ]) {
      assert.equal(
        (
          await f.req("brand", `/campaigns/${id}/details`, "PUT", {
            guidelines_url: invalid,
          })
        ).status,
        400,
      );
      assert.equal((await detail()).campaign.guidelines_url, url);
    }
    assert.equal(
      (
        await f.req("otherbrand", `/campaigns/${id}/details`, "PUT", {
          guidelines_url: "https://example.com/other",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          guidelines_url: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          guidelines: campaign.guidelines,
          guidelines_url: "",
        })
      ).status,
      200,
    );
    assert.equal((await detail()).campaign.guidelines, campaign.guidelines);
    assert.equal((await detail()).campaign.guidelines_url, "");
    const legacyId = await f.create();
    assert.equal(
      (
        f.db
          .prepare("SELECT guidelines_url FROM campaigns WHERE id=?")
          .get(legacyId) as any
      ).guidelines_url,
      "",
    );
    assert.equal(
      (
        await f.req("brand", "/campaigns", "POST", {
          ...campaign,
          guidelines: "",
          guidelines_url: "",
        })
      ).status,
      400,
    );
  } finally {
    f.db.close();
  }
});
test("admin address corrections require identity confirmation and preserve pending consent", async () => {
  const f = await fixture();
  try {
    const id = await f.create(),
      a = await f.apply(id);
    assert.equal(
      (
        await f.req("brand", `/applications/${a}/action`, "POST", {
          action: "select",
        })
      ).status,
      200,
    );
    f.db
      .prepare(
        "UPDATE applications SET consent_version='external-form-v2-original-pending',original_delivery_consent=0 WHERE id=?",
      )
      .run(a);
    const address = {
      action: "address",
      confirm_email: "influencer@test.com",
      recipient_name: "테스트 수령인",
      phone: "01012345678",
      postal_code: "46282",
      address: "부산광역시 금정구 장전동 158-24",
      address_detail: "모림원룸 302호",
    };
    const path = `/applications/${a}/action`;
    assert.equal((await f.req("brand", path, "POST", address)).status, 403);
    assert.equal(
      (
        await f.req("admin", path, "POST", {
          ...address,
          confirm_email: "wrong@test.com",
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.req("influencer", path, "POST", address)).status,
      409,
    );
    assert.equal((await f.req("admin", path, "POST", address)).status, 200);
    const row = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(a) as any;
    assert.equal(row.address, address.address);
    assert.equal(row.address_detail, address.address_detail);
    assert.equal(row.postal_code, address.postal_code);
    assert.equal(row.original_delivery_consent, 0);
    assert.equal(row.status, "selected");
    assert.equal(
      (
        await f.req("brand", path, "POST", {
          action: "ship",
          carrier: "CJ대한통운",
          tracking_number: "123456789",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) n FROM admin_audit WHERE action='shipping_address_edit' AND target_user_id=?",
          )
          .get(f.ids.influencer) as any
      ).n,
      1,
    );
    f.db.prepare("UPDATE applications SET status='shipping' WHERE id=?").run(a);
    assert.equal((await f.req("admin", path, "POST", address)).status, 409);
  } finally {
    f.db.close();
  }
});
test("admin consent recording identifies the account and records the administrator without changing selection or grade", async () => {
  const f = await fixture();
  try {
    const id = await f.create(),
      a = await f.apply(id);
    assert.equal(
      (
        await f.req("brand", `/applications/${a}/action`, "POST", {
          action: "select",
        })
      ).status,
      200,
    );
    f.db
      .prepare(
        "UPDATE applications SET consent_version='external-form-v2-original-pending',original_delivery_consent=0 WHERE id=?",
      )
      .run(a);
    const path = `/applications/${a}/consent`,
      data = {
        confirm_email: "influencer@test.com",
        secondary_use_consent: true,
        original_delivery_consent: true,
      };
    assert.equal((await f.req("brand", path, "POST", data)).status, 403);
    assert.equal((await f.req("other", path, "POST", data)).status, 403);
    assert.equal(
      (
        await f.req("admin", path, "POST", {
          ...data,
          confirm_email: "wrong@test.com",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.req("admin", path, "POST", {
          ...data,
          original_delivery_consent: false,
        })
      ).status,
      400,
    );
    const profile = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(f.ids.influencer);
    assert.equal((await f.req("admin", path, "POST", data)).status, 200);
    const row = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(a) as any;
    assert.equal(row.secondary_use_consent, 1);
    assert.equal(row.original_delivery_consent, 1);
    assert.equal(row.consent_version, "secondary-use-v2-admin-recorded");
    assert.equal(row.status, "selected");
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
        .get(f.ids.influencer),
      profile,
    );
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT actor_id FROM application_events WHERE application_id=? ORDER BY id DESC LIMIT 1",
          )
          .get(a) as any
      ).actor_id,
      f.ids.admin,
    );
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) n FROM admin_audit WHERE action='application_consent_recorded' AND target_user_id=?",
          )
          .get(f.ids.influencer) as any
      ).n,
      1,
    );
    assert.equal(
      (
        await f.req("influencer", `/applications/${a}/action`, "POST", {
          action: "address",
          recipient_name: "테스트 수령인",
          phone: "01012345678",
          postal_code: "01234",
          address: "서울시 테스트로 123",
          participation_confirmed: true,
          guidelines_confirmed: true,
          deadline_confirmed: true,
        })
      ).status,
      200,
    );
    assert.equal((await f.req("admin", path, "POST", data)).status, 409);
  } finally {
    f.db.close();
  }
});
test("default shipping address is owned by the influencer and does not overwrite campaign delivery", async () => {
  const f = await fixture();
  try {
    const data = {
      recipient_name: "테스트 수령인",
      shipping_phone: "01012345678",
      postal_code: "46282",
      address: "부산광역시 금정구 장전동 158-24",
      address_detail: "모림원룸 302호",
    };
    assert.equal(
      (await f.req("brand", "/profile/shipping", "PUT", data)).status,
      403,
    );
    assert.equal(
      (
        await f.req("influencer", "/profile/shipping", "PUT", {
          ...data,
          postal_code: "!!",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.req("influencer", "/profile/shipping", "PUT", data)).status,
      200,
    );
    const profile = (await (
      await f.req("influencer", "/profile")
    ).json()) as any;
    for (const key of Object.keys(data))
      assert.equal(profile.profile[key], (data as any)[key]);
    const id = await f.create(),
      appId = await f.apply(id);
    const before = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(appId) as any;
    assert.notEqual(before.address, data.address);
    assert.equal(before.postal_code, "");
    assert.equal(
      (
        await f.req("brand", `/applications/${appId}/action`, "POST", {
          action: "select",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.req("influencer", "/profile/shipping", "PUT", {
          ...data,
          address: "서울특별시 강남구 테스트로 123",
        })
      ).status,
      200,
    );
    const after = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(appId) as any;
    assert.equal(after.address, before.address);
    assert.equal(after.postal_code, before.postal_code);
  } finally {
    f.db.close();
  }
});
test("certificates require completed activity and protect ownership with stable escaped snapshots", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.req("influencer", "/certificate", "POST", {})).status,
      409,
    );
    assert.equal(
      (await f.req("brand", "/certificate", "POST", {})).status,
      403,
    );
    const c = await f.create({ review_required: false, draft_date: "" });
    const a = await f.apply(c);
    assert.equal((await f.action(a, "select")).status, 200);
    assert.equal(
      (
        await f.action(a, "ship", {
          carrier: "CJ대한통운",
          tracking_number: "123456789",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.action(
          a,
          "final",
          { url: "https://instagram.com/reel/test" },
          "influencer",
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.req("influencer", "/certificate", "POST", {})).status,
      409,
    );
    assert.equal(
      (await f.action(a, "complete", { views: 0, best: false })).status,
      200,
    );
    f.db
      .prepare("UPDATE users SET name=? WHERE id=?")
      .run("<script>alert(1)</script>", f.ids.influencer);
    const r = await f.req("influencer", "/certificate", "POST", {});
    assert.equal(r.status, 200);
    const { url } = (await r.json()) as any;
    assert.equal(
      (
        (await (
          await f.req("influencer", "/certificate", "POST", {})
        ).json()) as any
      ).url,
      url,
    );
    const login = async (key: string) => {
      const r = await f.app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: key + "@test.com", password }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    const page = await f.app.request(url, {
      headers: { Cookie: await login("influencer") },
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Certificate of Participation/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes("influencer@test.com"));
    assert.equal((await f.app.request(url)).status, 401);
    assert.equal(
      (await f.app.request(url, { headers: { Cookie: await login("other") } }))
        .status,
      403,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT COUNT(*) AS n FROM activity_certificates")
          .get() as any
      ).n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("applying requires a web profile link; saving it enables application and syncs contact", async () => {
  const { db, req, create, apply, ids } = await fixture();
  try {
    const campaignId = await create();
    db.prepare(
      "UPDATE influencer_profiles SET social_url='' WHERE user_id=?",
    ).run(ids.influencer);
    const consent = {
      secondary_use_consent: true,
      original_delivery_consent: true,
    };
    assert.equal(
      (
        await req(
          "influencer",
          `/campaigns/${campaignId}/apply`,
          "POST",
          consent,
        )
      ).status,
      409,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM applications").get() as any).n,
      0,
    );
    assert.equal(
      (
        await req("influencer", "/profile", "PUT", {
          phone: "01011112222",
          social_url: "javascript:alert(1)",
          followers: 100,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("influencer", "/profile", "PUT", {
          phone: "invalid123",
          social_url: "https://xhslink.cn/m/5XecEtzbF0m",
          followers: 100,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("influencer", "/profile", "PUT", {
          phone: "01011112222",
          social_url: "https://xhslink.cn/m/5XecEtzbF0m",
          followers: 0,
        })
      ).status,
      200,
    );
    const profile = (await (await req("influencer", "/profile")).json()) as any;
    assert.equal(profile.profile.complete, true);
    assert.equal(
      profile.profile.social_url,
      "https://xhslink.cn/m/5XecEtzbF0m",
    );
    assert.equal(
      (
        db
          .prepare("SELECT phone FROM users WHERE id=?")
          .get(ids.influencer) as any
      ).phone,
      "01011112222",
    );
    const applicationId = await apply(campaignId);
    assert.equal(
      (
        db
          .prepare("SELECT phone,address FROM applications WHERE id=?")
          .get(applicationId) as any
      ).phone,
      "01011112222",
    );
  } finally {
    db.close();
  }
});
test("selection queues email atomically; mail history and retry are admin-only", async () => {
  const previous = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_PROVIDER = "brevo";
  const { db, req, create, apply, action } = await fixture();
  try {
    const campaignId = await create();
    const applicationId = await apply(campaignId);
    assert.equal(
      (await action(applicationId, "select", {}, "otherbrand")).status,
      403,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM email_outbox").get() as any).n,
      0,
    );
    assert.equal((await action(applicationId, "select")).status, 200);
    assert.equal((await action(applicationId, "select")).status, 409);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM email_outbox").get() as any).n,
      1,
    );
    assert.equal((await req("influencer", "/admin/email")).status, 403);
    assert.equal((await req("brand", "/admin/email")).status, 403);
    assert.equal((await req("", "/admin/email")).status, 401);
    const response = await req("admin", "/admin/email");
    assert.equal(response.status, 200);
    const info = (await response.json()) as any;
    assert.equal(info.messages.length, 1);
    const id = info.messages[0].id;
    assert.equal(
      (await req("admin", `/admin/email/${id}/retry`, "POST", {})).status,
      409,
    );
    db.prepare(
      "UPDATE email_outbox SET status='failed',attempts=5 WHERE id=?",
    ).run(id);
    assert.equal(
      (await req("brand", `/admin/email/${id}/retry`, "POST", {})).status,
      403,
    );
    assert.equal(
      (await req("admin", `/admin/email/${id}/retry`, "POST", {})).status,
      200,
    );
    assert.equal(
      (db.prepare("SELECT status FROM email_outbox WHERE id=?").get(id) as any)
        .status,
      "pending",
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM admin_audit WHERE action='email_retry'",
          )
          .get() as any
      ).n,
      1,
    );
  } finally {
    db.close();
    if (previous === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previous;
  }
});
test("admin sends a campaign guide only once to shipped participants", async () => {
  const keys = ["EMAIL_PROVIDER", "EMAIL_FROM", "BREVO_API_KEY", "APP_ORIGIN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    EMAIL_PROVIDER: "brevo",
    EMAIL_FROM: "notifications@example.com",
    BREVO_API_KEY: "test-only",
    APP_ORIGIN: "https://example.com",
  });
  const f = await fixture();
  try {
    const campaignId = await f.create();
    const shippedId = await f.apply(campaignId);
    const pendingId = await f.apply(campaignId, "other");
    assert.equal((await f.action(shippedId, "select")).status, 200);
    assert.equal((await f.action(pendingId, "select")).status, 200);
    assert.equal((await f.action(shippedId, "ship", { carrier: "우체국택배", tracking_number: "123456789" })).status, 200);
    const path = `/admin/campaigns/${campaignId}/guide-email`;
    const payload = { expected_count: 1, message: "English guide\n\n--------------------\n\n한국어 가이드" };
    assert.equal((await f.req("brand", path, "POST", payload)).status, 403);
    assert.equal((await f.req("admin", path, "POST", { ...payload, expected_count: 2 })).status, 409);
    const sent = await f.req("admin", path, "POST", payload);
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.deepEqual(await sent.json(), { recipients: 1, queued: 1 });
    assert.deepEqual(await (await f.req("admin", path, "POST", payload)).json(), { recipients: 1, queued: 0 });
    const guides = f.db.prepare("SELECT application_id,body FROM email_outbox WHERE event_key LIKE 'content-guide:%'").all() as any[];
    assert.equal(guides.length, 1);
    assert.equal(guides[0].application_id, shippedId);
    assert.match(guides[0].body, /English guide/);
    assert.deepEqual(await (await f.req("admin", path)).json(), { campaign_id: campaignId, counts: [{ status: "pending", count: 1 }] });
  } finally {
    f.db.close();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
test("full lifecycle with revision history, consent, notifications, completion exactly once", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    assert.equal(
      (
        await f.req("influencer", `/campaigns/${c}/apply`, "POST", {
          secondary_use_consent: true,
          original_delivery_consent: true,
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
    await f.req("brand", `/campaigns/${c}/close`, "POST", { confirm_close: true });
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
          secondary_use_consent: false,
          original_delivery_consent: false,
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
          secondary_use_consent: true,
          original_delivery_consent: true,
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
          secondary_use_consent: true,
          original_delivery_consent: true,
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
      1,
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

test("product links and recruitment start dates validate and block early applications", async () => {
  const f = await fixture();
  try {
    const id = await f.create({
      product_url: "https://example.com/product",
      recruit_start_date: future(1),
    });
    const { campaign: c } = (await (
      await f.req("influencer", `/campaigns/${id}`)
    ).json()) as any;
    assert.equal(c.product_url, "https://example.com/product");
    assert.equal(c.recruit_start_date, future(1));
    assert.equal(c.recruit_start, deadline(future(1)) - 86400_000);
    assert.equal(
      (
        await f.req("influencer", `/campaigns/${id}/apply`, "POST", {
          secondary_use_consent: true,
          original_delivery_consent: true,
        })
      ).status,
      409,
    );
    f.db
      .prepare("UPDATE campaigns SET recruit_start=? WHERE id=?")
      .run(Date.now() - 1, id);
    await f.apply(id);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "https://username:password@example.com/",
    ])
      assert.equal(
        (
          await f.req("brand", "/campaigns", "POST", {
            ...campaign,
            product_url: url,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await f.req("brand", "/campaigns", "POST", {
          ...campaign,
          recruit_start_date: future(3),
        })
      ).status,
      400,
    );
    const same = await f.create({ recruit_start_date: campaign.recruit_date });
    assert.ok(same);
  } finally {
    f.db.close();
  }
});

test("campaign link and schedule editing enforces ownership and allows dates after applications", async () => {
  const f = await fixture();
  try {
    const id = await f.create({ product_url: "https://example.com/original" });
    assert.equal(
      (
        await f.req("otherbrand", `/campaigns/${id}/details`, "PUT", {
          product_url: "https://example.com/other",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          recruit_start_date: future(-1),
          recruit_date: future(3),
        })
      ).status,
      200,
    );
    let row = f.db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.product_url, "https://example.com/original");
    await f.apply(id);
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          product_url: "https://example.com/updated",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          recruit_date: future(4),
          final_date: future(12),
        })
      ).status,
      200,
    );
    row = f.db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.recruit_date, future(4));
    assert.equal(row.final_date, future(12));
    assert.equal(row.final_due, deadline(future(12)));
    assert.equal(row.product_url, "https://example.com/updated");
    assert.equal(
      (
        await f.req("brand", `/campaigns/${id}/details`, "PUT", {
          recruit_date: future(13),
        })
      ).status,
      400,
    );
    assert.equal(
      (f.db.prepare("SELECT recruit_date FROM campaigns WHERE id=?").get(id) as any)
        .recruit_date,
      future(4),
    );
  } finally {
    f.db.close();
  }
});

test("admin can disable draft review after applications but before any selection", async () => {
  const f = await fixture();
  try {
    const id = await f.create();
    const applicationId = await f.apply(id);
    const path = `/campaigns/${id}/details`;
    assert.equal(
      (await f.req("brand", path, "PUT", { review_required: false })).status,
      409,
    );
    assert.equal(
      (await f.req("admin", path, "PUT", { review_required: false })).status,
      200,
    );
    let row = f.db.prepare("SELECT review_required,draft_date,draft_due,final_date,final_due FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.review_required, 0);
    assert.equal(row.draft_date, row.final_date);
    assert.equal(row.draft_due, row.final_due);
    f.db.prepare("UPDATE applications SET status='selected' WHERE id=?").run(applicationId);
    assert.equal(
      (await f.req("admin", path, "PUT", { review_required: true })).status,
      409,
    );
    row = f.db.prepare("SELECT review_required FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.review_required, 0);
  } finally {
    f.db.close();
  }
});

test("a manually closed campaign can reopen before its recruitment deadline", async () => {
  const f = await fixture();
  try {
    const id = await f.create();
    assert.equal((await f.req("brand", `/campaigns/${id}/close`, "POST", {})).status, 409);
    assert.equal((await f.req("brand", `/campaigns/${id}/close`, "POST", { confirm_close: true })).status, 200);
    assert.equal(
      ((await (await f.req("brand", `/campaigns/${id}`)).json()) as any).campaign.status,
      "closed",
    );
    assert.equal((await f.req("otherbrand", `/campaigns/${id}/reopen`, "POST", {})).status, 403);
    assert.equal((await f.req("brand", `/campaigns/${id}/reopen`, "POST", {})).status, 200);
    assert.equal(
      ((await (await f.req("brand", `/campaigns/${id}`)).json()) as any).campaign.status,
      "recruiting",
    );
    await f.apply(id);
    assert.equal((await f.req("brand", `/campaigns/${id}/close`, "POST", { confirm_close: true })).status, 200);
    const log = f.db.prepare("SELECT action,actor_id FROM admin_audit WHERE action IN ('campaign_close','campaign_reopen') ORDER BY id").all() as any[];
    assert.deepEqual(log.map((row) => row.action), ["campaign_close", "campaign_reopen", "campaign_close"]);
    assert.ok(log.every((row) => row.actor_id === f.ids.brand));
    f.db.prepare("UPDATE campaigns SET recruit_due=? WHERE id=?").run(Date.now() - 1, id);
    assert.equal((await f.req("brand", `/campaigns/${id}/reopen`, "POST", {})).status, 409);
  } finally {
    f.db.close();
  }
});

test("existing campaigns migrate once without losing applications or schedule data", async () => {
  const f = await fixture();
  try {
    const id = await f.create(),
      application = await f.apply(id);
    f.db.exec(
      "ALTER TABLE campaigns DROP COLUMN product_url; ALTER TABLE campaigns DROP COLUMN guidelines_url; ALTER TABLE campaigns DROP COLUMN recruit_start_date; ALTER TABLE campaigns DROP COLUMN recruit_start; ALTER TABLE campaigns DROP COLUMN review_required;",
    );
    f.db
      .prepare("UPDATE campaigns SET created_at=? WHERE id=?")
      .run("2026-01-01 16:00:00", id);
    f.db
      .prepare(
        "UPDATE applications SET address=?,consent_version='secondary-use-v1' WHERE id=?",
      )
      .run("서울시 기존 주소 123", application);
    for (const column of ["brand_name", "contact_name", "phone"])
      f.db.exec(`ALTER TABLE users DROP COLUMN ${column}`);
    for (const column of [
      "recipient_name",
      "postal_code",
      "address_detail",
      "shipping_address_at",
      "participation_confirmed_at",
      "secondary_use_consent",
      "original_delivery_consent",
    ])
      f.db.exec(`ALTER TABLE applications DROP COLUMN ${column}`);
    const { initializeWorkflow } = await import("../src/seoul/workflow-db.js");
    initializeWorkflow(f.db);
    let row = f.db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.recruit_start_date, "2026-01-02");
    assert.equal(row.recruit_start, Date.parse("2026-01-01T15:00:00Z"));
    assert.equal(row.product_url, "");
    assert.equal(row.guidelines_url, "");
    assert.equal(row.review_required, 1);
    f.db
      .prepare("UPDATE campaigns SET product_url=?,guidelines_url=? WHERE id=?")
      .run(
        "https://example.com/preserved",
        "https://docs.google.com/document/d/preserved",
        id,
      );
    initializeWorkflow(f.db);
    row = f.db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.product_url, "https://example.com/preserved");
    assert.equal(
      row.guidelines_url,
      "https://docs.google.com/document/d/preserved",
    );
    assert.ok(
      f.db.prepare("SELECT id FROM applications WHERE id=?").get(application),
    );
    const migrated = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(application) as any;
    assert.equal(migrated.address, "서울시 기존 주소 123");
    assert.equal(migrated.secondary_use_consent, 1);
    assert.equal(migrated.original_delivery_consent, 1);
    assert.equal(migrated.participation_confirmed_at, 0);
    const brand = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(f.ids.brand) as any;
    assert.equal(brand.brand_name, "brand");
    assert.equal(brand.contact_name, "");
    assert.equal(row.recruit_date, campaign.recruit_date);
  } finally {
    f.db.close();
  }
});

test("separate consents and address registration only after selection", async () => {
  const f = await fixture();
  try {
    const c = await f.create();
    for (const missing of [
      "secondary_use_consent",
      "original_delivery_consent",
    ]) {
      assert.equal(
        (
          await f.req("influencer", `/campaigns/${c}/apply`, "POST", {
            secondary_use_consent: true,
            original_delivery_consent: true,
            [missing]: false,
          })
        ).status,
        400,
      );
    }
    const a = await f.apply(c);
    const row = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(a) as any;
    assert.equal(row.address, ""); // Do not share a legacy profile address at application time.
    assert.equal(row.secondary_use_consent, 1);
    assert.equal(row.original_delivery_consent, 1);
    assert.ok(row.consent_at > 0);
    const address = {
      action: "address",
      recipient_name: "김수령",
      phone: "01012345678",
      postal_code: "01234",
      address: "서울시 테스트로 123",
      address_detail: "101호",
      participation_confirmed: true,
      guidelines_confirmed: true,
      deadline_confirmed: true,
    };
    assert.equal(
      (await f.req("influencer", `/applications/${a}/action`, "POST", address))
        .status,
      409,
    );
    assert.equal(
      (
        await f.req("brand", `/applications/${a}/action`, "POST", {
          action: "select",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.action(a, "ship", {
          carrier: "CJ대한통운",
          tracking_number: "123456789",
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.req("other", `/applications/${a}/action`, "POST", address))
        .status,
      403,
    );
    assert.equal(
      (await f.req("influencer", `/applications/${a}/action`, "POST", address))
        .status,
      200,
    );
    const saved = f.db
      .prepare("SELECT * FROM applications WHERE id=?")
      .get(a) as any;
    assert.equal(saved.postal_code, "01234");
    assert.equal(saved.address_detail, "101호");
    assert.ok(saved.shipping_address_at > 0);
    assert.equal(
      (
        await f.action(a, "ship", {
          carrier: "CJ대한통운",
          tracking_number: "123456789",
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.req("influencer", `/applications/${a}/action`, "POST", address))
        .status,
      409,
    );
  } finally {
    f.db.close();
  }
});

test("saved addresses do not count as campaign participation confirmation", async () => {
  const f = await fixture();
  try {
    const campaignId = await f.create();
    const applicationId = await f.apply(campaignId);
    assert.equal(
      (
        await f.req("brand", `/applications/${applicationId}/action`, "POST", {
          action: "select",
        })
      ).status,
      200,
    );
    f.db
      .prepare(
        "UPDATE applications SET recipient_name='기존 수령인',phone='01012345678',postal_code='01234',address='기존 배송지 123',shipping_address_at=? WHERE id=?",
      )
      .run(Date.now(), applicationId);
    const path = `/applications/${applicationId}`;
    for (const viewer of ["brand", "admin"]) {
      const detail = (await (await f.req(viewer, path)).json()) as any;
      assert.equal(detail.application.participation_confirmed_at, 0);
      const list = (await (
        await f.req(viewer, `/campaigns/${campaignId}`)
      ).json()) as any;
      assert.equal(list.applications[0].participation_confirmed_at, 0);
    }
    const ship = {
      action: "ship",
      carrier: "CJ대한통운",
      tracking_number: "123456789",
    };
    assert.equal(
      (await f.req("brand", `${path}/action`, "POST", ship)).status,
      409,
    );
    const address = {
      action: "address",
      recipient_name: "기존 수령인",
      phone: "01012345678",
      postal_code: "01234",
      address: "기존 배송지 123",
      participation_confirmed: true,
      guidelines_confirmed: true,
      deadline_confirmed: true,
    };
    for (const field of [
      "participation_confirmed",
      "guidelines_confirmed",
      "deadline_confirmed",
    ])
      assert.equal(
        (
          await f.req("influencer", `${path}/action`, "POST", {
            ...address,
            [field]: false,
          })
        ).status,
        400,
      );
    assert.equal(
      (await f.req("influencer", `${path}/action`, "POST", address)).status,
      200,
    );
    const confirmed = (await (await f.req("brand", path)).json()) as any;
    assert.ok(confirmed.application.participation_confirmed_at > 0);
    assert.equal(
      (await f.req("brand", `${path}/action`, "POST", ship)).status,
      200,
    );
  } finally {
    f.db.close();
  }
});

test("campaign editing validates all fields, retains participant conditions and notifies applicants", async () => {
  const f = await fixture();
  try {
    const id = await f.create();
    const path = `/campaigns/${id}/details`;
    assert.equal(
      (
        await f.req("brand", path, "PUT", {
          title: "수정된 캠페인",
          product: "신제품 향수",
          description: "신제품에 관한 자세한 설명입니다.",
          guidelines: "촬영 시 패키지와 제품을 함께 보여 주세요.",
          capacity: 3,
          pay_type: "paid",
          compensation: 100000,
          draft_date: future(6),
          final_date: future(12),
        })
      ).status,
      200,
    );
    let row = f.db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.title, "수정된 캠페인");
    assert.equal(row.draft_due, deadline(future(6)));
    assert.equal(row.compensation, 100000);
    assert.equal(
      (await f.req("brand", path, "PUT", { description: "짧음" })).status,
      400,
    );
    assert.equal(
      (await f.req("brand", path, "PUT", { draft_date: future(13) })).status,
      400,
    );
    const a = await f.apply(id);
    assert.equal(
      (await f.req("brand", path, "PUT", { compensation: 1 })).status,
      409,
    );
    assert.equal(
      (await f.req("brand", path, "PUT", { final_date: future(13) })).status,
      200,
    );
    assert.equal(
      (f.db.prepare("SELECT final_date FROM campaigns WHERE id=?").get(id) as any)
        .final_date,
      future(13),
    );
    assert.equal(
      (await f.req("otherbrand", path, "PUT", { title: "다른 브랜드 수정" }))
        .status,
      403,
    );
    assert.equal(
      (await f.req("influencer", path, "PUT", { title: "인플루언서 수정" }))
        .status,
      403,
    );
    assert.equal(
      (
        await f.req("brand", path, "PUT", {
          title: "참여자 있는 캠페인 수정",
          guidelines: "변경된 콘텐츠 가이드라인을 확인해 주세요.",
        })
      ).status,
      200,
    );
    assert.ok(
      f.db
        .prepare(
          "SELECT id FROM notifications WHERE user_id=? AND message LIKE '%캠페인 정보가 수정%' ",
        )
        .get(f.ids.influencer),
    );
    await f.action(a, "select");
    const other = await f.apply(id, "other");
    await f.action(other, "select");
    assert.equal(
      (await f.req("brand", path, "PUT", { capacity: 1 })).status,
      409,
    );
    row = f.db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) as any;
    assert.equal(row.capacity, 3);
    assert.equal(row.compensation, 100000);
    assert.equal(row.final_date, future(13));
    f.db.prepare("UPDATE campaigns SET status='completed' WHERE id=?").run(id);
    assert.equal(
      (await f.req("brand", path, "PUT", { title: "종료 후 수정" })).status,
      409,
    );
  } finally {
    f.db.close();
  }
});

test("optional review skips drafts and uses final deadline for penalties", async () => {
  const f = await fixture();
  try {
    const c = await f.create({ review_required: false, draft_date: undefined });
    const a = await f.apply(c);
    assert.equal(
      (
        await f.req("brand", `/campaigns/${c}/details`, "PUT", {
          review_required: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.action(
          a,
          "final",
          { url: "https://instagram.com/p/direct" },
          "influencer",
        )
      ).status,
      409,
    );
    await f.action(a, "select");
    await f.action(a, "ship", {
      carrier: "CJ대한통운",
      tracking_number: "123456789",
    });
    assert.equal(
      (
        await f.action(
          a,
          "draft",
          { url: "https://example.com/review", public_confirmed: true },
          "influencer",
        )
      ).status,
      409,
    );
    f.db
      .prepare("UPDATE campaigns SET draft_due=? WHERE id=?")
      .run(Date.now() - 1, c);
    assert.equal(sweepDeadlines(f.db).penalized, 0);
    assert.equal(
      (
        await f.action(
          a,
          "final",
          { url: "https://instagram.com/p/direct" },
          "influencer",
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.action(a, "complete", { views: 1, best: false })).status,
      200,
    );
    const c2 = await f.create({ review_required: false }),
      a2 = await f.apply(c2);
    await f.action(a2, "select");
    f.db
      .prepare("UPDATE campaigns SET final_due=? WHERE id=?")
      .run(Date.now() - 1, c2);
    assert.equal(sweepDeadlines(f.db).penalized, 1);
    assert.equal(
      (
        f.db
          .prepare("SELECT status FROM applications WHERE id=?")
          .get(a2) as any
      ).status,
      "no_show",
    );
  } finally {
    f.db.close();
  }
});
test("drafts accept arbitrary web hosts, ports and fragments but reject unsafe schemes", async () => {
  const f = await fixture();
  try {
    const c = await f.create(),
      a = await f.apply(c);
    await f.action(a, "select");
    await f.action(a, "ship", {
      carrier: "CJ대한통운",
      tracking_number: "123456789",
    });
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///tmp/video",
      "https://user:password@example.com/video",
    ])
      assert.equal(
        (
          await f.action(
            a,
            "draft",
            { url, public_confirmed: true },
            "influencer",
          )
        ).status,
        400,
      );
    const url = "http://example.com:8080/shared/video#preview";
    assert.equal(
      (
        await f.action(
          a,
          "draft",
          { url, public_confirmed: true },
          "influencer",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT draft_url FROM applications WHERE id=?")
          .get(a) as any
      ).draft_url,
      url,
    );
  } finally {
    f.db.close();
  }
});

test("English campaign copy is authorized, editable and cleared when its source changes", async () => {
  const f = await fixture();
  try {
    const id = await f.create({
      title_en: "Skincare creator campaign",
      product_en: "Air Mood skincare",
      description_en: "English product description",
      guidelines_en: "English filming guidelines",
    });
    const path = `/campaigns/${id}`;
    assert.equal((await f.req("otherbrand", path + "/english")).status, 403);
    assert.equal((await f.req("", path + "/english")).status, 401);
    let en = (await (
      await f.req("influencer", path + "/english")
    ).json()) as any;
    assert.equal(en.translated.title, "Skincare creator campaign");
    assert.equal(en.translated.guidelines, "English filming guidelines");
    assert.deepEqual(en.unavailable, []);
    assert.equal(
      (
        await f.req("brand", path + "/details", "PUT", {
          title: "변경된 캠페인 제목",
          title_en: "Skincare creator campaign",
        })
      ).status,
      200,
    );
    assert.equal(
      (f.db.prepare("SELECT title_en FROM campaigns WHERE id=?").get(id) as any)
        .title_en,
      "",
    );
    assert.equal(
      (
        await f.req("brand", path + "/details", "PUT", {
          title_en: "Updated skincare campaign",
        })
      ).status,
      200,
    );
    en = (await (
      await f.req("influencer", path + "/english?scope=summary")
    ).json()) as any;
    assert.equal(en.translated.title, "Updated skincare campaign");
    assert.equal(en.translated.guidelines, undefined);
  } finally {
    f.db.close();
  }
});

test("campaign photos enforce limits and ownership, support replacement and roll back invalid changes", async () => {
  const f = await fixture();
  const photo = readFileSync(
    new URL("./fixtures/campaign-photo.jpg", import.meta.url),
  ).toString("base64");
  try {
    const invalid = await f.req("brand", "/campaigns", "POST", {
      ...campaign,
      images: [{ data: "not-an-image" }],
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      (f.db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as any).n,
      0,
    );
    const c = await f.create({
      images: Array.from({ length: 4 }, () => ({ data: photo })),
    });
    let detail = (await (
      await f.req("influencer", `/campaigns/${c}`)
    ).json()) as any;
    assert.equal(detail.campaign.images.length, 4);
    const images = detail.campaign.images;
    let listed = (await (await f.req("influencer", "/campaigns")).json()) as any;
    assert.equal(listed.campaigns.find((row: any) => row.id === c).thumbnail_id, images[0].id);
    const imagePath = images[0].url.replace("/api/work", "");
    const image = await f.req("influencer", imagePath);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(
      Buffer.from(await image.arrayBuffer()).toString("base64"),
      photo,
    );
    assert.equal((await f.req("", imagePath)).status, 401);
    assert.equal((await f.req("otherbrand", imagePath)).status, 403);
    assert.equal(
      (
        await f.req("otherbrand", `/campaigns/${c}/details`, "PUT", {
          images: [],
        })
      ).status,
      403,
    );
    const path = `/campaigns/${c}/details`;
    assert.equal(
      (
        await f.req("brand", path, "PUT", {
          title: "잘못된 사진 수정",
          images: Array.from({ length: 5 }, () => ({ data: photo })),
        })
      ).status,
      400,
    );
    assert.equal(
      (f.db.prepare("SELECT title FROM campaigns WHERE id=?").get(c) as any)
        .title,
      campaign.title,
    );
    const other = await f.create({ images: [{ data: photo }] });
    const foreign = (
      (await (await f.req("brand", `/campaigns/${other}`)).json()) as any
    ).campaign.images[0].id;
    assert.equal(
      (await f.req("brand", path, "PUT", { images: [{ id: foreign }] })).status,
      400,
    );
    assert.equal(
      (
        await f.req("brand", path, "PUT", {
          images: [{ id: images[0].id }, { id: images[0].id }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.req("brand", path, "PUT", {
          images: [{ id: images[2].id }, { data: photo }],
        })
      ).status,
      200,
    );
    detail = (await (
      await f.req("influencer", `/campaigns/${c}`)
    ).json()) as any;
    assert.equal(detail.campaign.images.length, 2);
    assert.equal(detail.campaign.images[0].id, images[2].id);
    listed = (await (await f.req("influencer", "/campaigns")).json()) as any;
    assert.equal(listed.campaigns.find((row: any) => row.id === c).thumbnail_id, images[2].id);
    assert.equal((await f.req("influencer", imagePath)).status, 404);
    assert.equal(
      (await f.req("brand", path, "PUT", { images: [] })).status,
      200,
    );
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS n FROM campaign_images WHERE campaign_id=?",
          )
          .get(c) as any
      ).n,
      0,
    );
    listed = (await (await f.req("influencer", "/campaigns")).json()) as any;
    assert.equal(listed.campaigns.find((row: any) => row.id === c).thumbnail_id, null);
  } finally {
    f.db.close();
  }
});

test("admin profile editing authorizes only admins, validates atomically and preserves account and activity fields", async () => {
  const f = await fixture();
  try {
    const target = f.ids.influencer;
    const endpoint = `/admin/users/${target}/profile`;
    const before = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(target) as any;
    const profile = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(target) as any;
    for (const actor of ["brand", "influencer", "other"])
      assert.equal(
        (
          await f.req(actor, endpoint, "PUT", {
            social_url: "https://instagram.com/edited",
          })
        ).status,
        403,
      );
    assert.equal(
      (await f.req("admin", `/admin/users/${f.ids.brand}/profile`, "PUT", {}))
        .status,
      404,
    );
    assert.equal(
      (
        await f.req("admin", endpoint, "PUT", {
          name: "Updated Name",
          social_url: "javascript:alert(1)",
        })
      ).status,
      400,
    );
    assert.equal(
      (f.db.prepare("SELECT name FROM users WHERE id=?").get(target) as any)
        .name,
      before.name,
    );
    const edited = await f.req("admin", endpoint, "PUT", {
      name: "Updated Name",
      phone: "01087654321",
      social_url: "http://creator.example.test/my-account?source=share",
      followers: 25000,
      role: "admin",
      email: "changed@example.test",
      completed_count: 999,
      tier: 4,
      blacklisted: 1,
    });
    assert.equal(edited.status, 200, await edited.text());
    const after = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(target) as any;
    assert.equal(after.name, "Updated Name");
    assert.equal(after.phone, "01087654321");
    for (const field of [
      "email",
      "role",
      "password_hash",
      "must_change_password",
    ])
      assert.equal(after[field], before[field]);
    const p = f.db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(target) as any;
    assert.equal(
      p.social_url,
      "http://creator.example.test/my-account?source=share",
    );
    assert.equal(p.phone, after.phone);
    assert.equal(p.followers, 25000);
    for (const field of [
      "completed_count",
      "tier",
      "blacklisted",
      "blocked_until",
      "no_show_count",
      "onboarding_approved",
      "address",
    ])
      assert.equal(p[field], profile[field]);
    const audit = f.db
      .prepare("SELECT * FROM admin_audit WHERE action='profile_edit'")
      .get() as any;
    assert.equal(audit.actor_id, f.ids.admin);
    assert.equal(audit.target_user_id, target);
    assert.equal(
      (await f.req("admin", endpoint, "PUT", { social_url: "", phone: "" }))
        .status,
      200,
    );
  } finally {
    f.db.close();
  }
});

test("admin removal verifies identity, revokes sessions and removes unselected applications while protecting activity history", async () => {
  const f = await fixture();
  try {
    const campaignId = await f.create();
    await f.apply(campaignId);
    const target = f.ids.influencer;
    const endpoint = `/admin/users/${target}`;
    const confirm = {
      confirm_email: "influencer@test.com",
      confirm_name: "influencer",
    };
    for (const actor of ["influencer", "brand"])
      assert.equal(
        (await f.req(actor, endpoint, "DELETE", confirm)).status,
        403,
      );
    assert.equal(
      (
        await f.req("admin", endpoint, "DELETE", {
          ...confirm,
          confirm_name: "Wrong person",
        })
      ).status,
      409,
    );
    f.db
      .prepare(
        "UPDATE influencer_profiles SET completed_count=1 WHERE user_id=?",
      )
      .run(target);
    assert.equal(
      (await f.req("admin", endpoint, "DELETE", confirm)).status,
      409,
    );
    f.db
      .prepare(
        "UPDATE influencer_profiles SET completed_count=0 WHERE user_id=?",
      )
      .run(target);
    f.db
      .prepare(
        "UPDATE applications SET status='selected' WHERE influencer_id=?",
      )
      .run(target);
    assert.equal(
      (await f.req("admin", endpoint, "DELETE", confirm)).status,
      409,
    );
    f.db
      .prepare("UPDATE applications SET status='applied' WHERE influencer_id=?")
      .run(target);
    const beforeOther = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(f.ids.other);
    const removed = await f.req("admin", endpoint, "DELETE", confirm);
    assert.equal(removed.status, 200, await removed.text());
    assert.equal(
      f.db.prepare("SELECT id FROM users WHERE id=?").get(target),
      undefined,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT count(*) n FROM applications WHERE influencer_id=?")
          .get(target) as any
      ).n,
      0,
    );
    assert.equal((await f.req("influencer", "/profile")).status, 401);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM users WHERE id=?").get(f.ids.other),
      beforeOther,
    );
    const audit = f.db
      .prepare("SELECT * FROM admin_audit WHERE action='influencer_delete'")
      .get() as any;
    assert.equal(audit.actor_id, f.ids.admin);
    assert.equal(JSON.parse(audit.note).user_id, target);
    assert.equal(f.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    f.db.close();
  }
});

test("admin email corrections preserve participant identity and history, reject collisions and revoke old sessions", async () => {
  const f = await fixture();
  try {
    const target = f.ids.influencer,
      endpoint = `/admin/users/${target}/email`;
    const payload = {
      confirm_email: "influencer@test.com",
      email: "corrected@test.com",
    };
    const before = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(target) as any;
    f.db
      .prepare(
        "INSERT INTO historical_activities(user_id,project_key,content_links,submitted_at,imported_at) VALUES(?,'Archive','[]','',1)",
      )
      .run(target);
    const historyBefore = f.db
      .prepare("SELECT * FROM historical_activities WHERE user_id=?")
      .all(target);
    const campaignId = await f.create(),
      appId = await f.apply(campaignId);
    f.db
      .prepare(
        "INSERT INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at) VALUES(?,'test-correction','influencer@test.com','Test','Test',1,1)",
      )
      .run(appId);
    for (const actor of ["influencer", "brand"])
      assert.equal((await f.req(actor, endpoint, "PUT", payload)).status, 403);
    assert.equal(
      (
        await f.req("admin", endpoint, "PUT", {
          ...payload,
          confirm_email: "wrong@test.com",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.req("admin", endpoint, "PUT", {
          ...payload,
          email: "other@test.com",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.req("admin", endpoint, "PUT", {
          ...payload,
          email: "not-an-email",
        })
      ).status,
      400,
    );
    const corrected = await f.req("admin", endpoint, "PUT", payload);
    assert.equal(corrected.status, 200, await corrected.text());
    const after = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(target) as any;
    assert.equal(after.email, payload.email);
    for (const field of [
      "id",
      "name",
      "role",
      "password_hash",
      "must_change_password",
    ])
      assert.equal(after[field], before[field]);
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM historical_activities WHERE user_id=?")
        .all(target),
      historyBefore,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT influencer_id FROM applications WHERE id=?")
          .get(appId) as any
      ).influencer_id,
      target,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT recipient FROM email_outbox WHERE application_id=?")
          .get(appId) as any
      ).recipient,
      payload.email,
    );
    assert.equal((await f.req("influencer", "/profile")).status, 401);
    const login = await f.app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: payload.email, password }),
    });
    assert.equal(login.status, 200);
    assert.equal(((await login.json()) as any).user.id, target);
  } finally {
    f.db.close();
  }
});
