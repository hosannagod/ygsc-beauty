import type { Hono, Context } from "hono";
import type { User } from "./db.js";
import {
  type DB,
  WorkflowError,
  fail,
  text,
  externalLink,
  integer,
  notify,
} from "./workflow.js";
import { parseCampaignImages } from "./campaign-images.js";
export const promotionLink = "https://bit.ly/4glyo5O";
export function campaignEligible(p: any) {
  return p.completed_count > 0 || p.onboarding_approved === 1 || p.campaign_access_granted === 1;
}
export function onboardingStatus(db: DB, user: number) {
  const row = db
    .prepare(
      "SELECT id,status,url,feedback,created_at,reviewed_at,image IS NOT NULL AS has_image FROM onboarding_submissions WHERE user_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(user) as any;
  return row
    ? {
        ...row,
        image_url: row.has_image
          ? `/api/work/onboarding/${row.id}/image`
          : null,
      }
    : null;
}
export function registerOnboarding(
  app: Hono<{ Variables: { user: User | null } }>,
  db: DB,
) {
  const guard =
    (
      fn: (
        c: Context<{ Variables: { user: User | null } }>,
        u: User,
      ) => Response | Promise<Response>,
      role?: string,
    ) =>
    async (c: Context<{ Variables: { user: User | null } }>) => {
      try {
        const u = c.get("user");
        if (!u) fail("로그인이 필요합니다.", 401);
        if (role && u!.role !== role) fail("접근 권한이 없습니다.", 403);
        return await fn(c, u!);
      } catch (e) {
        if (e instanceof WorkflowError)
          return c.json({ error: e.message }, e.status as any);
        throw e;
      }
    };
  const body = async (c: any) => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object" || Array.isArray(b))
      fail("입력 내용을 확인해 주세요.");
    return b;
  };
  const imageResponse = (data: Buffer) =>
    new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  app.get(
    "/api/work/onboarding",
    guard(
      (c, u) =>
        c.json({
          submission: onboardingStatus(db, u.id),
          promotion_link: promotionLink,
          has_promotion_image: !!db
            .prepare("SELECT id FROM promotion_asset WHERE id=1")
            .get(),
        }),
      "influencer",
    ),
  );
  app.get(
    "/api/work/onboarding/promotion-image",
    guard((c) => {
      const r = db
        .prepare("SELECT data FROM promotion_asset WHERE id=1")
        .get() as any;
      if (!r) fail("사진을 찾을 수 없습니다.", 404);
      return imageResponse(r.data);
    }),
  );
  app.post(
    "/api/work/admin/onboarding/promotion-image",
    guard(async (c, u) => {
      const b = await body(c),
        image = parseCampaignImages(db, [{ data: b.image }])![0].data!;
      db.transaction(() => {
        db.prepare(
          "INSERT INTO promotion_asset(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        ).run(image);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
        ).run(u.id, "promotion_image", "홍보 이미지 변경", Date.now());
      })();
      return c.json({ success: true });
    }, "admin"),
  );
  app.post(
    "/api/work/onboarding",
    guard(async (c, u) => {
      const b = await body(c);
      if (b.confirmation !== true)
        fail("홍보 이미지와 필수 링크를 포함했는지 확인해 주세요.");
      const url = b.url ? externalLink(b.url, true) : "";
      const image = b.image
        ? parseCampaignImages(db, [{ data: b.image }])![0].data!
        : null;
      if (!url && !image)
        fail("홍보 게시물 링크 또는 스크린샷을 제출해 주세요.");
      const result = db.transaction(() => {
        const p = db
          .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
          .get(u.id) as any;
        if (campaignEligible(p)) fail("이미 캠페인 지원 자격이 있습니다.", 409);
        if (p.blacklisted || p.blocked_until > Date.now())
          fail("노쇼 제재로 신규 캠페인 지원이 제한되어 있습니다.", 403);
        if (onboardingStatus(db, u.id)?.status === "pending")
          fail("이미 홍보 인증을 검토 중입니다.", 409);
        return db
          .prepare(
            "INSERT INTO onboarding_submissions(user_id,url,image,status,created_at) VALUES(?,?,?,'pending',?)",
          )
          .run(u.id, url, image, Date.now());
      })();
      return c.json({ id: Number(result.lastInsertRowid) }, 201);
    }, "influencer"),
  );
  app.get(
    "/api/work/onboarding/:id/image",
    guard((c, u) => {
      const row = db
        .prepare("SELECT user_id,image FROM onboarding_submissions WHERE id=?")
        .get(integer(Number(c.req.param("id")), "ID", 1)) as any;
      if (!row || !row.image) fail("사진을 찾을 수 없습니다.", 404);
      if (u.role !== "admin" && u.id !== row.user_id)
        fail("접근 권한이 없습니다.", 403);
      return imageResponse(row.image);
    }),
  );
  app.get(
    "/api/work/admin/onboarding",
    guard(
      (c) =>
        c.json({
          submissions: db
            .prepare(
              `SELECT s.id,s.user_id,s.url,s.status,s.feedback,s.created_at,s.reviewed_at,s.image IS NOT NULL AS has_image,u.name,u.email FROM onboarding_submissions s JOIN users u ON u.id=s.user_id WHERE s.id=(SELECT MAX(x.id) FROM onboarding_submissions x WHERE x.user_id=s.user_id) ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.id DESC`,
            )
            .all(),
          has_promotion_image: !!db
            .prepare("SELECT id FROM promotion_asset WHERE id=1")
            .get(),
          promotion_link: promotionLink,
        }),
      "admin",
    ),
  );
  app.post(
    "/api/work/admin/onboarding/:id/review",
    guard(async (c, u) => {
      const b = await body(c);
      if (!["approved", "rejected"].includes(b.decision))
        fail("승인 또는 반려를 선택해 주세요.");
      const feedback = text(
          b.feedback || "",
          "피드백",
          b.decision === "rejected" ? 2 : 0,
          2000,
        ),
        id = integer(Number(c.req.param("id")), "ID", 1);
      db.transaction(() => {
        const row = db
          .prepare("SELECT * FROM onboarding_submissions WHERE id=?")
          .get(id) as any;
        if (!row) fail("홍보 인증을 찾을 수 없습니다.", 404);
        if (row.status !== "pending") fail("이미 검토한 홍보 인증입니다.", 409);
        db.prepare(
          "UPDATE onboarding_submissions SET status=?,feedback=?,reviewed_at=?,reviewer_id=? WHERE id=?",
        ).run(b.decision, feedback, Date.now(), u.id, id);
        if (b.decision === "approved")
          db.prepare(
            "UPDATE influencer_profiles SET onboarding_approved=1 WHERE user_id=?",
          ).run(row.user_id);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          u.id,
          row.user_id,
          "onboarding_review",
          JSON.stringify({ decision: b.decision, feedback }),
          Date.now(),
        );
        notify(
          db,
          row.user_id,
          b.decision === "approved"
            ? "홍보 인증이 승인되었습니다. 브론즈 등급으로 캠페인에 지원할 수 있습니다."
            : "홍보 인증이 반려되었습니다. 피드백을 확인하고 다시 제출해 주세요.",
          "/profile",
        );
      })();
      return c.json({ success: true });
    }, "admin"),
  );
}
