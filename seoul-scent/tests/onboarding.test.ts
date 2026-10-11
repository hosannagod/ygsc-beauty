import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
import { tierLabel } from "../src/seoul/tier.js";
const password = "Test-password-123!";
const jpeg = () => {
  const b = Buffer.alloc(40);
  Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 2, 0, 2, 3, 1, 0x11, 0, 2, 0x11, 0, 3,
    0x11, 0,
  ]).copy(b);
  b[38] = 0xff;
  b[39] = 0xd9;
  return b.toString("base64");
};
test("promotion review authorizes Bronze without campaign/certificate credit; private evidence and resubmission", async () => {
  const db = openDb(":memory:"),
    app = createApp(db),
    cookies: Record<string, string> = {},
    ids: Record<string, number> = {};
  const req = (who: string, path: string, method = "GET", data?: any) =>
    app.request("/api/work" + path, {
      method,
      headers: { Cookie: cookies[who], "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
  try {
    for (const [key, role] of Object.entries({
      admin: "admin",
      brand: "brand",
      creator: "influencer",
      other: "influencer",
    })) {
      ids[key] = Number(
        db
          .prepare(
            "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
          )
          .run(key + "@test.com", key, role, hashPassword(password))
          .lastInsertRowid,
      );
      const login = await app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: key + "@test.com", password }),
      });
      cookies[key] = login.headers.get("set-cookie")!.split(";")[0];
    }
    await req("creator", "/profile", "PUT", {
      phone: "01012345678",
      social_url: "https://instagram.com/creator",
      followers: 2500,
      onboarding_approved: 1,
    });
    let profile: any = (
      (await (await req("creator", "/profile")).json()) as any
    ).profile;
    assert.equal(profile.onboarding_approved, 0);
    assert.equal(profile.campaign_eligible, false);
    assert.equal(
      tierLabel(profile.tier, 0, profile.onboarding_approved),
      "기본",
    );
    const future = (days: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() + days * 86400000));
    const campaign: any = await (
      await req("brand", "/campaigns", "POST", {
        title: "Test campaign",
        product: "Product",
        description: "Product description here",
        guidelines: "Content guidelines here",
        capacity: 10,
        pay_type: "gifted",
        compensation: 0,
        recruit_date: future(2),
        draft_date: future(5),
        final_date: future(10),
      })
    ).json();
    const consent = {
      secondary_use_consent: true,
      original_delivery_consent: true,
    };
    assert.equal(
      (await req("creator", `/campaigns/${campaign.id}/apply`, "POST", consent))
        .status,
      409,
    );
    assert.equal((await req("brand", "/admin/onboarding")).status, 403);
    assert.equal(
      (await req("creator", "/onboarding", "POST", { confirmation: true }))
        .status,
      400,
    );
    assert.equal(
      (
        await req("creator", "/onboarding", "POST", {
          confirmation: true,
          url: "javascript:alert(1)",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("creator", "/onboarding", "POST", {
          confirmation: true,
          image: Buffer.from("bad").toString("base64"),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("admin", "/admin/onboarding/promotion-image", "POST", {
          image: jpeg(),
        })
      ).status,
      200,
    );
    assert.equal(
      (await req("creator", "/onboarding/promotion-image")).headers.get(
        "content-type",
      ),
      "image/jpeg",
    );
    let result = await req("creator", "/onboarding", "POST", {
      confirmation: true,
      image: jpeg(),
    });
    assert.equal(result.status, 201);
    const first = ((await result.json()) as any).id;
    assert.equal(
      (await req("creator", `/onboarding/${first}/image`)).status,
      200,
    );
    assert.equal(
      (await req("other", `/onboarding/${first}/image`)).status,
      403,
    );
    assert.equal(
      (await req("brand", `/onboarding/${first}/image`)).status,
      403,
    );
    assert.equal(
      (
        await req("creator", "/onboarding", "POST", {
          confirmation: true,
          url: "https://instagram.com/p/again",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("creator", `/admin/onboarding/${first}/review`, "POST", {
          decision: "approved",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await req("admin", `/admin/onboarding/${first}/review`, "POST", {
          decision: "rejected",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("admin", `/admin/onboarding/${first}/review`, "POST", {
          decision: "rejected",
          feedback: "Please include the link",
        })
      ).status,
      200,
    );
    result = await req("creator", "/onboarding", "POST", {
      confirmation: true,
      url: "https://instagram.com/p/proof",
    });
    assert.equal(result.status, 201);
    const second = ((await result.json()) as any).id;
    assert.equal(
      (
        await req("admin", `/admin/onboarding/${second}/review`, "POST", {
          decision: "approved",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req("admin", `/admin/onboarding/${second}/review`, "POST", {
          decision: "approved",
        })
      ).status,
      409,
    );
    profile = ((await (await req("creator", "/profile")).json()) as any)
      .profile;
    assert.equal(profile.campaign_eligible, true);
    assert.equal(profile.completed_count, 0);
    assert.equal(
      tierLabel(profile.tier, 0, profile.onboarding_approved),
      "브론즈",
    );
    assert.equal((await req("creator", "/certificate", "POST")).status, 409);
    assert.equal(
      (await req("creator", `/campaigns/${campaign.id}/apply`, "POST", consent))
        .status,
      201,
    );
    db.prepare(
      "UPDATE influencer_profiles SET blacklisted=1 WHERE user_id=?",
    ).run(ids.creator);
    assert.equal(
      (await req("creator", `/campaigns/${campaign.id}/apply`, "POST", consent))
        .status,
      403,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM onboarding_submissions WHERE user_id=?",
          )
          .get(ids.creator) as any
      ).n,
      2,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM email_outbox").get() as any).n,
      0,
    );
  } finally {
    db.close();
  }
});
