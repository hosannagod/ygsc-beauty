import {
  parseCampaignImages,
  saveCampaignImages,
  campaignImages,
} from "./campaign-images.js";
import { shippingTrackingUrl } from "./shipping-tracking.js";
import { contentTranslator, englishFields } from "./content-translation.js";
import { validateWorkbookArchive } from "./xlsx-safety.js";
import type { Hono, Context } from "hono";
import type { User } from "./db.js";
import ExcelJS from "exceljs";
import {
  type DB,
  WorkflowError,
  fail,
  text,
  integer,
  deadline,
  productLink,
  recruitmentDates,
  seoulToday,
  externalLink,
  campaignFor,
  applicationFor,
  event,
  notify,
  recalculateTier,
  sweepDeadlines,
} from "./workflow.js";
export function registerWorkflow(
  app: Hono<{ Variables: { user: User | null } }>,
  db: DB,
) {
  const translateContent = contentTranslator(db);
  app.get("/api/work/campaigns/:id/english", async (c) => {
    try {
      const u = c.get("user");
      if (!u) return c.json({ error: "Please sign in." }, 401);
      const campaign = campaignFor(db, Number(c.req.param("id")), u);
      return c.json(
        await translateContent(campaign, c.req.query("scope") === "summary"),
      );
    } catch (e) {
      if (e instanceof WorkflowError)
        return c.json({ error: e.message }, e.status as any);
      throw e;
    }
  });
  const current = (c: any): User => {
    const u = c.get("user");
    if (!u) fail("로그인이 필요합니다.", 401);
    return u;
  };
  const role = (c: any, wanted: string): User => {
    const u = current(c);
    if (u.role !== wanted) fail("접근 권한이 없습니다.", 403);
    return u;
  };
  const id = (c: any) => integer(Number(c.req.param("id")), "ID", 1);
  const body = async (c: any) => {
    const data = await c.req.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data))
      fail("입력 내용을 확인해 주세요.");
    return data;
  };
  const wrap =
    (
      fn: (
        c: Context<{ Variables: { user: User | null } }>,
      ) => Response | Promise<Response>,
    ) =>
    async (c: Context<{ Variables: { user: User | null } }>) => {
      try {
        return await fn(c);
      } catch (e) {
        if (e instanceof WorkflowError)
          return c.json({ error: e.message }, e.status as any);
        throw e;
      }
    };
  // Sweep before each authenticated workflow request as well as the background timer.
  app.use("/api/work/*", async (c, next) => {
    if (c.get("user")) sweepDeadlines(db);
    await next();
  });
  app.get(
    "/api/work/profile",
    wrap((c) => {
      const u = role(c, "influencer");
      return c.json({
        profile: db
          .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
          .get(u.id),
      });
    }),
  );
  app.put(
    "/api/work/profile",
    wrap(async (c) => {
      const u = role(c, "influencer"),
        b = await body(c);
      const phone = text(b.phone, "연락처", 8, 30),
        address =
          b.address === undefined
            ? undefined
            : text(b.address, "배송지", 0, 300),
        social = text(b.social_url, "SNS 프로필 URL", 1, 500);
      let url;
      try {
        url = new URL(social);
      } catch {
        fail("SNS 프로필 링크를 확인해 주세요.");
      }
      if (url!.protocol !== "https:" || url!.username || url!.password)
        fail("HTTPS 프로필 링크를 입력해 주세요.");
      const followers = integer(b.followers, "팔로워 수", 0, 100_000_000);
      db.prepare(
        "UPDATE influencer_profiles SET phone=?,address=COALESCE(?,address),social_url=?,followers=? WHERE user_id=?",
      ).run(phone, address ?? null, social, followers, u.id);
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/campaigns",
    wrap((c) => {
      const u = current(c);
      const where = u.role === "brand" ? "WHERE c.brand_id=?" : "";
      const query = db.prepare(`SELECT c.*,u.name AS brand_name,
      (SELECT COUNT(*) FROM applications a WHERE a.campaign_id=c.id) AS applicant_count,
      (SELECT COUNT(*) FROM applications a WHERE a.campaign_id=c.id AND a.status NOT IN ('applied','rejected')) AS selected_count,
      (SELECT COUNT(*) FROM applications a WHERE a.campaign_id=c.id AND a.status='completed') AS completed_count
      FROM campaigns c JOIN users u ON u.id=c.brand_id ${where} ORDER BY c.id DESC`);
      return c.json({
        campaigns: u.role === "brand" ? query.all(u.id) : query.all(),
      });
    }),
  );
  app.post(
    "/api/work/campaigns",
    wrap(async (c) => {
      const u = role(c, "brand"),
        b = await body(c);
      const title = text(b.title, "캠페인명", 2, 100),
        product = text(b.product, "제품", 2, 200),
        description = text(b.description, "제품 소개", 10, 4000),
        guidelines = text(b.guidelines, "가이드라인", 10, 6000);
      const capacity = integer(b.capacity, "모집 인원", 1, 500),
        compensation = integer(b.compensation, "보상 금액", 0, 100_000_000);
      if (!["paid", "gifted"].includes(b.pay_type))
        fail("유가/무가 유형을 확인해 주세요.");
      if (b.pay_type === "paid" && compensation === 0)
        fail("유가 캠페인의 보상 금액을 입력해 주세요.");
      if (
        b.review_required !== undefined &&
        typeof b.review_required !== "boolean"
      )
        fail("초안 검수 설정을 확인해 주세요.");
      const review = b.review_required !== false;
      const productUrl = productLink(b.product_url);
      const startDate = b.recruit_start_date ?? seoulToday();
      const recruit = deadline(b.recruit_date),
        draft = review ? deadline(b.draft_date) : deadline(b.final_date),
        final = deadline(b.final_date);
      if (
        recruit <= Date.now() ||
        draft <= recruit ||
        (review && final <= draft)
      )
        fail(
          "모집 마감 < 초안 마감 < 최종 마감 순서로 미래 날짜를 설정해 주세요.",
        );
      const { start } = recruitmentDates(startDate, b.recruit_date, draft);
      const english = Object.fromEntries(
        englishFields.map((field) => [
          field,
          text(
            b[field + "_en"] ?? "",
            "영어 " + field,
            0,
            field === "guidelines"
              ? 12000
              : field === "description"
                ? 8000
                : 400,
          ),
        ]),
      );
      const images = parseCampaignImages(db, b.images);
      const campaignId = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,compensation,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,product_url,recruit_start_date,recruit_start,review_required) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            u.id,
            title,
            product,
            description,
            guidelines,
            capacity,
            b.pay_type,
            b.pay_type === "gifted" ? 0 : compensation,
            b.recruit_date,
            review ? b.draft_date : b.final_date,
            b.final_date,
            recruit,
            draft,
            final,
            productUrl,
            startDate,
            start,
            review ? 1 : 0,
          );
        for (const field of englishFields)
          db.prepare(`UPDATE campaigns SET ${field}_en=? WHERE id=?`).run(
            english[field],
            result.lastInsertRowid,
          );
        const newId = Number(result.lastInsertRowid);
        saveCampaignImages(db, newId, images);
        return newId;
      })();
      return c.json({ id: campaignId }, 201);
    }),
  );
  app.put(
    "/api/work/campaigns/:id/details",
    wrap(async (c) => {
      const u = current(c),
        b = await body(c);
      db.transaction(() => {
        const campaign = campaignFor(db, id(c), u, true);
        const images = parseCampaignImages(db, b.images, campaign.id);
        if (campaign.status === "completed")
          fail("종료된 캠페인은 수정할 수 없습니다.", 409);
        const applicants = db
          .prepare(
            "SELECT influencer_id,status FROM applications WHERE campaign_id=?",
          )
          .all(campaign.id) as { influencer_id: number; status: string }[];
        const locked =
          applicants.length > 0 || campaign.status !== "recruiting";
        const title = text(b.title ?? campaign.title, "캠페인명", 2, 100),
          product = text(b.product ?? campaign.product, "제품", 2, 200),
          description = text(
            b.description ?? campaign.description,
            "제품 소개",
            10,
            4000,
          ),
          guidelines = text(
            b.guidelines ?? campaign.guidelines,
            "가이드라인",
            10,
            6000,
          ),
          capacity = integer(
            b.capacity ?? campaign.capacity,
            "모집 인원",
            1,
            500,
          );
        const selected = applicants.filter(
          (a) => !["applied", "rejected"].includes(a.status),
        ).length;
        if (capacity < selected)
          fail(
            "모집 인원은 이미 선정된 인원보다 작게 설정할 수 없습니다.",
            409,
          );
        const url = productLink(b.product_url ?? campaign.product_url),
          payType = b.pay_type ?? campaign.pay_type,
          compensation = integer(
            b.compensation ?? campaign.compensation,
            "보상 금액",
            0,
            100_000_000,
          );
        if (
          !["paid", "gifted"].includes(payType) ||
          (payType === "paid" && compensation === 0)
        )
          fail("보상 유형과 유가 캠페인의 활동비를 확인해 주세요.");
        if (
          locked &&
          (payType !== campaign.pay_type ||
            compensation !== campaign.compensation)
        )
          fail(
            "지원자가 있거나 모집이 마감된 캠페인의 보상 조건은 변경할 수 없습니다.",
            409,
          );
        if (
          b.review_required !== undefined &&
          typeof b.review_required !== "boolean"
        )
          fail("초안 검수 설정을 확인해 주세요.");
        const review =
          b.review_required === undefined
            ? !!campaign.review_required
            : b.review_required;
        if (locked && review !== !!campaign.review_required)
          fail(
            "지원자가 있거나 모집이 마감된 캠페인의 검수 방식은 변경할 수 없습니다.",
            409,
          );
        const startDate = b.recruit_start_date ?? campaign.recruit_start_date,
          endDate = b.recruit_date ?? campaign.recruit_date,
          draftDate = review
            ? (b.draft_date ?? campaign.draft_date)
            : (b.final_date ?? campaign.final_date),
          finalDate = b.final_date ?? campaign.final_date;
        const changed =
          startDate !== campaign.recruit_start_date ||
          endDate !== campaign.recruit_date ||
          draftDate !== campaign.draft_date ||
          finalDate !== campaign.final_date ||
          review !== !!campaign.review_required;
        let start = campaign.recruit_start,
          end = campaign.recruit_due,
          draft = campaign.draft_due,
          final = campaign.final_due;
        if (changed) {
          if (locked)
            fail(
              "지원자가 있거나 모집이 마감된 캠페인은 일정을 변경할 수 없습니다.",
              409,
            );
          draft = deadline(draftDate);
          final = deadline(finalDate);
          ({ start, end } = recruitmentDates(startDate, endDate, draft));
          if (final <= draft)
            fail("초안 마감 < 최종 마감 순서로 설정해 주세요.");
        }
        db.prepare(
          "UPDATE campaigns SET title=?,product=?,description=?,guidelines=?,capacity=?,pay_type=?,compensation=?,product_url=?,recruit_start_date=?,recruit_start=?,recruit_date=?,recruit_due=?,draft_date=?,draft_due=?,final_date=?,final_due=?,review_required=? WHERE id=?",
        ).run(
          title,
          product,
          description,
          guidelines,
          capacity,
          payType,
          payType === "gifted" ? 0 : compensation,
          url,
          startDate,
          start,
          endDate,
          end,
          draftDate,
          draft,
          finalDate,
          final,
          review ? 1 : 0,
          campaign.id,
        );
        saveCampaignImages(db, campaign.id, images);
        const sources = { title, product, description, guidelines };
        for (const field of englishFields) {
          const value =
            b[field + "_en"] === undefined ||
            (sources[field] !== campaign[field] &&
              b[field + "_en"] === campaign[field + "_en"])
              ? sources[field] === campaign[field]
                ? campaign[field + "_en"]
                : ""
              : text(
                  b[field + "_en"],
                  "영어 " + field,
                  0,
                  field === "guidelines"
                    ? 12000
                    : field === "description"
                      ? 8000
                      : 400,
                );
          db.prepare(`UPDATE campaigns SET ${field}_en=? WHERE id=?`).run(
            value,
            campaign.id,
          );
        }
        if (
          title !== campaign.title ||
          product !== campaign.product ||
          description !== campaign.description ||
          guidelines !== campaign.guidelines ||
          url !== campaign.product_url ||
          capacity !== campaign.capacity
        ) {
          for (const a of applicants.filter(
            (a) => !["rejected", "completed", "no_show"].includes(a.status),
          ))
            notify(
              db,
              a.influencer_id,
              `${title}: 캠페인 정보가 수정되었습니다. 제품 소개와 가이드라인을 확인해 주세요.`,
              `/campaigns/${campaign.id}`,
            );
        }
      })();
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/campaigns/:id",
    wrap((c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u);
      const applications =
        u.role === "influencer"
          ? db
              .prepare(
                "SELECT * FROM applications WHERE campaign_id=? AND influencer_id=?",
              )
              .all(campaign.id, u.id)
          : db
              .prepare(
                `SELECT a.*,u.name AS influencer_name,u.email AS influencer_email,p.followers,p.tier,p.no_show_count,p.social_url FROM applications a JOIN users u ON u.id=a.influencer_id JOIN influencer_profiles p ON p.user_id=a.influencer_id WHERE a.campaign_id=? ORDER BY a.id DESC`,
              )
              .all(campaign.id);
      return c.json({
        campaign: { ...campaign, images: campaignImages(db, campaign.id) },
        applications,
      });
    }),
  );
  app.get(
    "/api/work/campaigns/:id/images/:imageId",
    wrap((c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u);
      const imageId = integer(Number(c.req.param("imageId")), "사진 ID", 1);
      const row = db
        .prepare(
          "SELECT data FROM campaign_images WHERE id=? AND campaign_id=?",
        )
        .get(imageId, campaign.id) as { data: Buffer } | undefined;
      if (!row) fail("사진을 찾을 수 없습니다.", 404);
      return new Response(new Uint8Array(row!.data), {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Disposition": "inline",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }),
  );
  app.post(
    "/api/work/campaigns/:id/apply",
    wrap(async (c) => {
      const u = role(c, "influencer"),
        b = await body(c);
      const result = db.transaction(() => {
        const campaign = campaignFor(db, id(c), u),
          p = db
            .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
            .get(u.id) as any;
        if (p.blacklisted || p.blocked_until > Date.now())
          fail("노쇼 제재로 신규 캠페인 지원이 제한되어 있습니다.", 403);
        if (
          campaign.status !== "recruiting" ||
          campaign.recruit_due <= Date.now()
        )
          fail("모집이 마감된 캠페인입니다.", 409);
        if (campaign.recruit_start > Date.now())
          fail("아직 모집 시작 전입니다.", 409);
        if (
          b.secondary_use_consent !== true ||
          b.original_delivery_consent !== true
        )
          fail("2차 활용 및 고화질 원본 제공 동의가 필요합니다.");
        if (!p.phone) fail("먼저 내 프로필에 연락처를 입력해 주세요.");
        if (
          db
            .prepare(
              "SELECT id FROM applications WHERE campaign_id=? AND influencer_id=?",
            )
            .get(campaign.id, u.id)
        )
          fail("이미 지원한 캠페인입니다.", 409);
        const r = db
          .prepare(
            "INSERT INTO applications(campaign_id,influencer_id,consent_at,phone,address,consent_version,secondary_use_consent,original_delivery_consent) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            campaign.id,
            u.id,
            Date.now(),
            p.phone,
            "",
            "secondary-and-original-v2",
            1,
            1,
          );
        event(
          db,
          { id: r.lastInsertRowid },
          u.id,
          "applied",
          "2차 저작물 활용 및 고화질 원본 제공에 동의",
        );
        notify(
          db,
          campaign.brand_id,
          `${campaign.title}: 새로운 지원자가 있습니다.`,
          `/campaigns/${campaign.id}`,
        );
        return Number(r.lastInsertRowid);
      })();
      return c.json({ id: result }, 201);
    }),
  );
  app.post(
    "/api/work/campaigns/:id/close",
    wrap((c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true);
      if (campaign.status !== "recruiting")
        fail("모집 중인 캠페인만 마감할 수 있습니다.", 409);
      db.prepare("UPDATE campaigns SET status='closed' WHERE id=?").run(
        campaign.id,
      );
      return c.json({ success: true });
    }),
  );
  app.post(
    "/api/work/campaigns/:id/complete",
    wrap((c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true);
      db.transaction(() => {
        if (campaign.status !== "closed")
          fail("모집 마감 후 캠페인을 종료해 주세요.", 409);
        const active = db
          .prepare(
            "SELECT COUNT(*) AS count FROM applications WHERE campaign_id=? AND status NOT IN ('rejected','completed','no_show')",
          )
          .get(campaign.id) as any;
        if (active.count)
          fail("미처리 지원자와 진행 중인 참여자를 먼저 처리해 주세요.", 409);
        db.prepare("UPDATE campaigns SET status='completed' WHERE id=?").run(
          campaign.id,
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/applications",
    wrap((c) => {
      const u = current(c);
      if (u.role !== "influencer")
        fail("인플루언서만 접근할 수 있습니다.", 403);
      return c.json({
        applications: db
          .prepare(
            `SELECT a.*,c.review_required,c.title,c.product,c.draft_date,c.final_date,c.recruit_date,u.name AS brand_name FROM applications a JOIN campaigns c ON c.id=a.campaign_id JOIN users u ON u.id=c.brand_id WHERE a.influencer_id=? ORDER BY a.id DESC`,
          )
          .all(u.id),
      });
    }),
  );
  app.get(
    "/api/work/applications/:id",
    wrap((c) => {
      const u = current(c),
        a = applicationFor(db, id(c), u);
      return c.json({
        application: {
          ...a,
          tracking_url: shippingTrackingUrl(a.carrier, a.tracking_number),
        },
        events: db
          .prepare(
            "SELECT e.*,u.name AS actor_name FROM application_events e LEFT JOIN users u ON u.id=e.actor_id WHERE application_id=? ORDER BY e.id",
          )
          .all(a.id),
      });
    }),
  );
  app.post(
    "/api/work/applications/:id/action",
    wrap(async (c) => {
      const u = current(c),
        b = await body(c);
      db.transaction(() => {
        const a = applicationFor(db, id(c), u);
        const brand =
          u.role === "admin" || (u.role === "brand" && u.id === a.brand_id);
        const influencer = u.role === "influencer" && u.id === a.influencer_id;
        const requireState = (states: string[]) => {
          if (!states.includes(a.status) || a.campaign_status === "completed")
            fail("현재 단계에서는 이 작업을 할 수 없습니다.", 409);
        };
        let status = a.status,
          note = "",
          link = "";
        switch (b.action) {
          case "select": {
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["applied"]);
            if (Date.now() >= (a.review_required ? a.draft_due : a.final_due))
              fail("초안 마감이 지난 캠페인에서는 선정할 수 없습니다.", 409);
            const count = (
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM applications WHERE campaign_id=? AND status NOT IN ('applied','rejected')",
                )
                .get(a.campaign_id) as any
            ).n;
            if (count >= a.capacity)
              fail("모집 인원이 모두 선정되었습니다.", 409);
            const p = db
              .prepare(
                "SELECT blacklisted,blocked_until FROM influencer_profiles WHERE user_id=?",
              )
              .get(a.influencer_id) as any;
            if (p.blacklisted || p.blocked_until > Date.now())
              fail("지원자가 현재 제재 중입니다.", 409);
            status = "selected";
            note =
              "캠페인 참여자로 선정되었습니다. 참여 내역에서 배송지를 등록해 주세요.";
            break;
          }
          case "reject":
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["applied"]);
            status = "rejected";
            note =
              typeof b.note === "string"
                ? text(b.note, "반려 사유", 0, 1000)
                : "지원이 반려되었습니다.";
            break;
          case "address": {
            if (!influencer) fail("접근 권한이 없습니다.", 403);
            requireState(["selected"]);
            const recipient = text(b.recipient_name, "수령인", 2, 60),
              phone = text(b.phone, "연락처", 8, 30),
              postal = text(b.postal_code, "우편번호", 3, 12),
              address = text(b.address, "주소", 5, 200),
              detail = text(b.address_detail ?? "", "상세주소", 0, 150);
            if (
              !/^[+0-9 ()-]{8,30}$/.test(phone) ||
              !/^[A-Za-z0-9 -]{3,12}$/.test(postal)
            )
              fail("연락처·우편번호 형식을 확인해 주세요.");
            db.prepare(
              "UPDATE applications SET recipient_name=?,phone=?,postal_code=?,address=?,address_detail=?,shipping_address_at=? WHERE id=?",
            ).run(recipient, phone, postal, address, detail, Date.now(), a.id);
            note = "배송지가 등록되었습니다.";
            break;
          }
          case "ship": {
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["selected", "shipping"]);
            if (!a.address || !a.phone)
              fail("선정자가 배송지를 먼저 등록해야 합니다.", 409);
            const carrier = text(b.carrier, "택배사", 2, 40),
              tracking = text(b.tracking_number, "송장번호", 5, 40);
            if (!/^[A-Za-z0-9-]+$/.test(tracking))
              fail("송장번호 형식을 확인해 주세요.");
            db.prepare(
              "UPDATE applications SET carrier=?,tracking_number=? WHERE id=?",
            ).run(carrier, tracking, a.id);
            status = "shipping";
            note = `${carrier} · ${tracking}`;
            break;
          }
          case "draft": {
            if (!influencer) fail("접근 권한이 없습니다.", 403);
            requireState(["shipping", "revision_requested"]);
            if (!a.review_required)
              fail("이 캠페인은 초안 검수를 진행하지 않습니다.", 409);
            if (b.public_confirmed !== true)
              fail(
                "링크가 있는 모든 사용자에게 보기 권한을 허용했는지 확인해 주세요.",
              );
            const due =
              a.status === "revision_requested" && a.revision_due
                ? a.revision_due
                : a.draft_due;
            if (Date.now() >= due) fail("초안 제출 마감이 지났습니다.", 409);
            link = externalLink(b.url, true);
            status = "draft_submitted";
            note = "초안 링크가 제출되었습니다.";
            db.prepare(
              "UPDATE applications SET draft_url=?,feedback=? WHERE id=?",
            ).run(link, "", a.id);
            break;
          }
          case "revision": {
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["draft_submitted"]);
            note = text(b.feedback, "수정 요청 사유", 5, 3000);
            const due = deadline(b.revision_date);
            if (due <= Date.now() || due > a.final_due)
              fail("수정 마감일은 미래 날짜이며 최종 마감일 이하여야 합니다.");
            db.prepare(
              "UPDATE applications SET feedback=?,revision_due=? WHERE id=?",
            ).run(note, due, a.id);
            status = "revision_requested";
            break;
          }
          case "approve":
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["draft_submitted"]);
            if (Date.now() >= a.final_due)
              fail(
                "최종 마감일이 지났습니다. 기한을 연장한 뒤 승인해 주세요.",
                409,
              );
            status = "draft_approved";
            note = "초안 승인 완료. SNS 업로드 후 최종 URL을 제출해 주세요.";
            break;
          case "extend": {
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState([
              "draft_submitted",
              "final_submitted",
              "draft_approved",
            ]);
            // Campaign-wide final deadline extension, never retroactively removes penalties.
            const due = deadline(b.final_date),
              campaign = campaignFor(db, a.campaign_id, u, true);
            if (due <= campaign.final_due || due <= Date.now())
              fail("현재 최종 마감보다 늦은 미래 날짜를 입력해 주세요.");
            db.prepare(
              "UPDATE campaigns SET final_date=?,final_due=? WHERE id=?",
            ).run(b.final_date, due, a.campaign_id);
            const participants = db
              .prepare(
                "SELECT influencer_id,id FROM applications WHERE campaign_id=? AND status NOT IN ('rejected','completed','no_show')",
              )
              .all(a.campaign_id) as any[];
            for (const p of participants)
              notify(
                db,
                p.influencer_id,
                `${a.title}: 최종 마감이 ${b.final_date}로 연장되었습니다.`,
                `/applications/${p.id}`,
              );
            note = `최종 마감 연장: ${b.final_date}`;
            break;
          }
          case "final":
            if (!influencer) fail("접근 권한이 없습니다.", 403);
            requireState(a.review_required ? ["draft_approved"] : ["shipping"]);
            if (Date.now() >= a.final_due)
              fail("최종 제출 마감이 지났습니다.", 409);
            link = externalLink(b.url, false);
            status = "final_submitted";
            note = "최종 SNS 게시물 링크가 제출되었습니다.";
            db.prepare("UPDATE applications SET final_url=? WHERE id=?").run(
              link,
              a.id,
            );
            break;
          case "complete": {
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["final_submitted"]);
            const views = integer(b.views, "확인한 조회수", 0, 1_000_000_000);
            if (typeof b.best !== "boolean") fail("Best 여부를 확인해 주세요.");
            db.prepare("UPDATE applications SET views=?,best=? WHERE id=?").run(
              views,
              b.best ? 1 : 0,
              a.id,
            );
            db.prepare(
              "UPDATE influencer_profiles SET completed_count=completed_count+1,total_views=total_views+? WHERE user_id=?",
            ).run(views, a.influencer_id);
            recalculateTier(db, a.influencer_id);
            status = "completed";
            note = `활동 완료 · 조회수 ${views}${b.best ? " · Best" : ""}`;
            break;
          }
          default:
            fail("알 수 없는 작업입니다.");
        }
        db.prepare(
          "UPDATE applications SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(status, a.id);
        event(db, a, u.id, status, note, link);
        notify(
          db,
          influencer ? a.brand_id : a.influencer_id,
          `${a.title}: ${note || status}`,
          influencer ? `/campaigns/${a.campaign_id}` : `/applications/${a.id}`,
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/notifications",
    wrap((c) => {
      const u = current(c);
      return c.json({
        notifications: db
          .prepare(
            "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100",
          )
          .all(u.id),
        unread: (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL",
            )
            .get(u.id) as any
        ).n,
      });
    }),
  );
  app.post(
    "/api/work/notifications/read",
    wrap((c) => {
      const u = current(c);
      db.prepare(
        "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
      ).run(Date.now(), u.id);
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/admin/settings",
    wrap((c) => {
      role(c, "admin");
      return c.json({
        settings: db
          .prepare("SELECT * FROM workflow_settings WHERE id=1")
          .get(),
      });
    }),
  );
  app.put(
    "/api/work/admin/settings",
    wrap(async (c) => {
      const admin = role(c, "admin");
      const b = await body(c);
      const keys = [
        "penalty_days",
        "demotion",
        "blacklist_after",
        "tier2_count",
        "tier3_count",
        "tier4_count",
        "tier2_views",
        "tier3_views",
        "tier4_views",
      ];
      const values = keys.map((k) =>
        integer(
          b[k],
          k,
          k.includes("views") ? 0 : 1,
          k === "penalty_days"
            ? 365
            : k === "demotion"
              ? 2
              : k === "blacklist_after"
                ? 10
                : 1_000_000_000,
        ),
      );
      if (
        b.tier2_count > b.tier3_count ||
        b.tier3_count > b.tier4_count ||
        b.tier2_views > b.tier3_views ||
        b.tier3_views > b.tier4_views
      )
        fail("티어 기준은 단계가 높아질수록 같거나 증가해야 합니다.");
      db.transaction(() => {
        db.prepare(
          `UPDATE workflow_settings SET ${keys.map((k) => k + "=?").join(",")} WHERE id=1`,
        ).run(...values);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
        ).run(
          admin.id,
          "settings",
          JSON.stringify(
            Object.fromEntries(keys.map((key, index) => [key, values[index]])),
          ),
          Date.now(),
        );
        const users = db
          .prepare("SELECT user_id FROM influencer_profiles")
          .all() as any[];
        for (const p of users) recalculateTier(db, p.user_id);
      })();
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/admin/users",
    wrap((c) => {
      role(c, "admin");
      return c.json({
        users: db
          .prepare(
            `SELECT u.id,u.name,u.email,u.role,u.created_at,p.followers,p.tier,p.completed_count,p.total_views,p.no_show_count,p.blocked_until,p.blacklisted FROM users u LEFT JOIN influencer_profiles p ON p.user_id=u.id ORDER BY u.id DESC`,
          )
          .all(),
      });
    }),
  );
  app.get(
    "/api/work/admin/audit",
    wrap((c) => {
      role(c, "admin");
      return c.json({
        audit: db
          .prepare(
            "SELECT a.*,u.name AS actor_name FROM admin_audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 50",
          )
          .all(),
      });
    }),
  );
  app.post(
    "/api/work/admin/users/:id/release",
    wrap(async (c) => {
      const u = role(c, "admin"),
        b = await body(c),
        note = text(b.note, "제재 해제 사유", 5, 1000),
        user = id(c);
      db.transaction(() => {
        const profile = db
          .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
          .get(user) as any;
        if (!profile) fail("인플루언서를 찾을 수 없습니다.", 404);
        if (!profile.blacklisted && profile.blocked_until <= Date.now())
          fail("현재 적용 중인 지원 제한이 없습니다.", 409);
        db.prepare(
          "UPDATE influencer_profiles SET blacklisted=0,blocked_until=0 WHERE user_id=?",
        ).run(user);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(u.id, user, "release", note, Date.now());
        notify(
          db,
          user,
          "운영사 검토로 신규 지원 제한이 해제되었습니다.",
          "/profile",
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/admin/users/:id/history",
    wrap((c) => {
      role(c, "admin");
      return c.json({
        applications: db
          .prepare(
            `SELECT a.*,c.title,u.name AS brand_name FROM applications a JOIN campaigns c ON c.id=a.campaign_id JOIN users u ON u.id=c.brand_id WHERE a.influencer_id=? ORDER BY a.id DESC`,
          )
          .all(id(c)),
      });
    }),
  );
  app.get(
    "/api/work/admin/alerts",
    wrap((c) => {
      role(c, "admin");
      return c.json({
        alerts: db
          .prepare(
            `SELECT a.id,a.status,c.title,c.review_required,c.draft_date,c.final_date,c.draft_due,c.final_due,u.name FROM applications a JOIN campaigns c ON c.id=a.campaign_id JOIN users u ON u.id=a.influencer_id WHERE a.status='no_show' OR (a.status IN ('selected','shipping','revision_requested','draft_approved') AND CASE WHEN a.status='draft_approved' OR c.review_required=0 THEN c.final_due WHEN a.status='revision_requested' AND a.revision_due>0 THEN a.revision_due ELSE c.draft_due END<?) ORDER BY a.updated_at DESC LIMIT 100`,
          )
          .all(Date.now() + 86400_000),
      });
    }),
  );
  app.post(
    "/api/work/admin/sweep",
    wrap((c) => {
      role(c, "admin");
      return c.json(sweepDeadlines(db));
    }),
  );
  app.get(
    "/api/work/campaigns/:id/shipments.xlsx",
    wrap(async (c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true);
      const rows = db
        .prepare(
          "SELECT a.id AS application_id,u.name,a.phone,a.address,a.carrier,a.tracking_number,a.recipient_name,a.postal_code,a.address_detail FROM applications a JOIN users u ON u.id=a.influencer_id WHERE a.campaign_id=? AND a.status IN ('selected','shipping') AND a.address!='' ORDER BY a.id",
        )
        .all(campaign.id);
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet("배송");
      sheet.columns = [
        { header: "application_id", key: "application_id", width: 16 },
        { header: "name", key: "name", width: 20 },
        { header: "phone", key: "phone", width: 20 },
        { header: "address", key: "address", width: 50 },
        { header: "carrier", key: "carrier", width: 20 },
        { header: "tracking_number", key: "tracking_number", width: 25 },
        { header: "recipient_name", key: "recipient_name", width: 20 },
        { header: "postal_code", key: "postal_code", width: 15 },
        { header: "address_detail", key: "address_detail", width: 30 },
      ];
      sheet.addRows(rows);
      sheet.getRow(1).font = { bold: true };
      sheet.getColumn("phone").numFmt = "@";
      sheet.getColumn("postal_code").numFmt = "@";
      sheet.getColumn("tracking_number").numFmt = "@";
      const buffer = await book.xlsx.writeBuffer();
      return new Response(buffer as any, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="campaign-${campaign.id}-shipping.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }),
  );
  app.get(
    "/api/work/campaigns/:id/results.xlsx",
    wrap(async (c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true);
      const rows = db
        .prepare(
          `SELECT a.id,u.name,a.status,a.draft_url,a.final_url,a.best,a.views,p.tier,a.consent_version FROM applications a JOIN users u ON u.id=a.influencer_id JOIN influencer_profiles p ON p.user_id=u.id WHERE a.campaign_id=? ORDER BY a.id`,
        )
        .all(campaign.id);
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet("결과");
      sheet.columns = [
        { header: "지원 ID", key: "id", width: 10 },
        { header: "인플루언서", key: "name", width: 20 },
        { header: "상태", key: "status", width: 20 },
        { header: "초안 URL", key: "draft_url", width: 50 },
        { header: "최종 SNS URL", key: "final_url", width: 50 },
        { header: "Best", key: "best", width: 10 },
        { header: "확인 조회수", key: "views", width: 15 },
        { header: "티어 (0=T1)", key: "tier", width: 15 },
        { header: "동의 버전", key: "consent_version", width: 25 },
      ];
      sheet.addRows(rows);
      sheet.getRow(1).font = { bold: true };
      return new Response((await book.xlsx.writeBuffer()) as any, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="campaign-${campaign.id}-results.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }),
  );
  app.post(
    "/api/work/campaigns/:id/shipments/import",
    wrap(async (c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true),
        b = await body(c);
      if (
        typeof b.file !== "string" ||
        b.file.length > 2_800_000 ||
        !/^[A-Za-z0-9+/]+=*$/.test(b.file)
      )
        fail("2MB 이하 XLSX 파일을 선택해 주세요.");
      const buffer = Buffer.from(b.file, "base64");
      validateWorkbookArchive(buffer);
      const book = new ExcelJS.Workbook();
      try {
        await book.xlsx.load(buffer as any);
      } catch {
        fail("읽을 수 없는 XLSX 파일입니다.");
      }
      const sheet = book.worksheets[0];
      if (
        !sheet ||
        sheet.rowCount < 2 ||
        sheet.rowCount > 501 ||
        sheet.columnCount > 20
      )
        fail("1~500개 송장 행이 있는 파일을 선택해 주세요.");
      const headers = new Map<string, number>();
      sheet
        .getRow(1)
        .eachCell((cell, index) => headers.set(String(cell.value), index));
      if (
        !["application_id", "carrier", "tracking_number"].every((key) =>
          headers.has(key),
        )
      )
        fail("application_id, carrier, tracking_number 열이 필요합니다.");
      const rows: any[] = [],
        seen = new Set<number>();
      for (let i = 2; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i);
        if (row.actualCellCount === 0) continue;
        const value = (key: string) => row.getCell(headers.get(key)!).value;
        const n = integer(Number(value("application_id")), "지원 ID", 1);
        if (seen.has(n)) fail(`${i}행: 중복 지원 ID입니다.`);
        seen.add(n);
        const a = applicationFor(db, n, u);
        if (
          a.campaign_id !== campaign.id ||
          !["selected", "shipping"].includes(a.status)
        )
          fail(`${i}행: 해당 캠페인의 선정/배송 단계가 아닙니다.`);
        if (!a.address || !a.phone)
          fail(`${i}행: 선정자의 배송지가 아직 등록되지 않았습니다.`);
        const carrier = text(value("carrier"), "택배사", 2, 40),
          tracking = text(value("tracking_number"), "송장번호", 5, 40);
        if (!/^[A-Za-z0-9-]+$/.test(tracking))
          fail(`${i}행: 송장번호 형식을 확인해 주세요.`);
        rows.push({ a, carrier, tracking });
      }
      if (!rows.length) fail("처리할 송장이 없습니다.");
      db.transaction(() => {
        if (campaignFor(db, campaign.id, u, true).status === "completed")
          fail("종료된 캠페인입니다.", 409);
        for (const { a, carrier, tracking } of rows) {
          db.prepare(
            "UPDATE applications SET status='shipping',carrier=?,tracking_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          ).run(carrier, tracking, a.id);
          event(db, a, u.id, "shipping", `${carrier} · ${tracking}`);
          notify(
            db,
            a.influencer_id,
            `${campaign.title}: 배송정보가 등록되었습니다.`,
            `/applications/${a.id}`,
          );
        }
      })();
      return c.json({ imported: rows.length });
    }),
  );
}
