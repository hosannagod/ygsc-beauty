import { importSecondProject } from "./project-import.js";
import { finalizeSelection } from "./selection.js";
import { registerOnboarding, campaignEligible } from "./onboarding.js";
import { tierLabel } from "./tier.js";
import { importActivities, historicalActivities } from "./activity-import.js";
import { importInfluencers } from "./influencer-import.js";
import { mergeInfluencers } from "./influencer-merge.js";
import { queueSelectionEmail, queueBrandShippingReadyEmail, emailStatus, emailConfig } from "./email.js";
import {
  profileComplete,
  socialProfileUrl,
  nationalityValue,
} from "./profile.js";
import {
  certificatePage,
  issueCertificate,
  certificateSummary,
} from "./certificate.js";
import {
  parseCampaignImages,
  saveCampaignImages,
  campaignImages,
} from "./campaign-images.js";
import { shippingTrackingUrl } from "./shipping-tracking.js";
import { contentTranslator, englishFields } from "./content-translation.js";
import { validateWorkbookArchive } from "./xlsx-safety.js";
import type { Hono, Context } from "hono";
import { hashPassword, verifyPassword, type User } from "./db.js";
import ExcelJS from "exceljs";
import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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
  registerOnboarding(app, db);
  const translateContent = contentTranslator(db);
  app.post("/api/work/admin/influencers/import", async (c) => {
    const u = c.get("user");
    if (!u) return c.json({ error: "로그인이 필요합니다." }, 401);
    if (u.role !== "admin")
      return c.json({ error: "접근 권한이 없습니다." }, 403);
    try {
      const b = await c.req.json().catch(() => null);
      if (!b || typeof b !== "object" || Array.isArray(b))
        fail("입력 내용을 확인해 주세요.");
      if (
        typeof b.file !== "string" ||
        b.file.length > 2_800_000 ||
        !/^[A-Za-z0-9+/]+=*$/.test(b.file)
      )
        fail("2MB 이하 XLSX 파일을 선택해 주세요.");
      return c.json(
        await importInfluencers(
          db,
          Buffer.from(b.file, "base64"),
          b.initial_password,
          b.dry_run !== false,
          u.id,
        ),
      );
    } catch (e) {
      if (e instanceof WorkflowError)
        return c.json({ error: e.message }, e.status as any);
      throw e;
    }
  });
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
  app.post(
    "/api/work/admin/projects/second/import",
    wrap(async (c) => {
      const u = role(c, "admin"),
        b = await body(c);
      if (
        typeof b.file !== "string" ||
        b.file.length > 2_800_000 ||
        !/^[A-Za-z0-9+/]+=*$/.test(b.file)
      )
        fail("2MB 이하 XLSX 파일을 선택해 주세요.");
      return c.json(
        await importSecondProject(
          db,
          Buffer.from(b.file, "base64"),
          u.id,
          b.dry_run !== false,
          b.skip_invalid === true,
        ),
      );
    }),
  );
  app.post(
    "/api/work/applications/:id/consent",
    wrap(async (c) => {
      const u = current(c),
        a = applicationFor(db, id(c), u),
        b = await body(c);
      if (!["influencer", "admin"].includes(u.role))
        fail("접근 권한이 없습니다.", 403);
      const admin = u.role === "admin";
      if (admin && b.confirm_email !== a.influencer_email)
        fail("동의를 처리할 계정의 이메일을 확인해 주세요.", 409);
      if (!admin && a.status === "selected" && a.participation_due > 0 && Date.now() >= a.participation_due)
        fail("참여 확인 기한이 지나 추가 동의를 저장할 수 없습니다.", 409);
      if (
        a.campaign_deleted_at ||
        !["applied", "selected"].includes(a.status) ||
        !a.consent_version.startsWith("external-form-v2")
      )
        fail("추가 동의 대상이 아닙니다.", 409);
      if (
        b.secondary_use_consent !== true ||
        b.original_delivery_consent !== true
      )
        fail("필수 동의 항목을 모두 확인해 주세요.");
      db.transaction(() => {
        db.prepare(
          "UPDATE applications SET secondary_use_consent=1,original_delivery_consent=1,consent_at=?,consent_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(
          Date.now(),
          admin ? "secondary-use-v2-admin-recorded" : "secondary-use-v2",
          a.id,
        );
        if (admin)
          db.prepare(
            "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
          ).run(
            u.id,
            a.influencer_id,
            "application_consent_recorded",
            `application:${a.id}; administrator request`,
            Date.now(),
          );
        event(
          db,
          a,
          u.id,
          a.status,
          admin
            ? "운영사 요청으로 2차 활용 및 고화질 원본 제공 동의 완료 처리"
            : "2차 활용 및 고화질 원본 제공 추가 동의 완료",
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/certificate",
    wrap((c) => {
      const u = role(c, "influencer");
      return c.json(certificateSummary(db, u.id));
    }),
  );
  app.post(
    "/api/work/certificate",
    wrap((c) => {
      const certificate = issueCertificate(db, role(c, "influencer"));
      return c.json({ url: `/certificates/${certificate.id}` });
    }),
  );
  app.post(
    "/api/work/admin/users/:id/certificate",
    wrap((c) => {
      const actor = role(c, "admin");
      const person = db
        .prepare("SELECT id,name,email,role FROM users WHERE id=?")
        .get(id(c)) as User | undefined;
      if (!person) return fail("계정을 찾을 수 없습니다.", 404);
      if (person.role !== "influencer")
        fail("인플루언서 계정만 발급할 수 있습니다.", 409);
      const certificate = issueCertificate(db, person);
      db.prepare(
        "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
      ).run(
        actor.id,
        person.id,
        "certificate_issue",
        certificate.id,
        Date.now(),
      );
      return c.json({ url: `/certificates/${certificate.id}` });
    }),
  );
  app.get(
    "/certificates/:id",
    wrap((c) => {
      const u = current(c);
      const certificate = db
        .prepare("SELECT * FROM activity_certificates WHERE id=?")
        .get(c.req.param("id")) as any;
      if (!certificate) fail("수료증을 찾을 수 없습니다.", 404);
      if (u.role !== "admin" && certificate.user_id !== u.id)
        fail("접근 권한이 없습니다.", 403);
      return c.html(certificatePage(certificate));
    }),
  );
  app.post(
    "/api/work/admin/activities/import",
    wrap(async (c) => {
      const u = role(c, "admin"),
        b = await body(c);
      if (
        typeof b.file !== "string" ||
        b.file.length > 2_800_000 ||
        !/^[A-Za-z0-9+/]+=*$/.test(b.file)
      )
        fail("2MB 이하 XLSX 파일을 선택해 주세요.");
      return c.json(
        await importActivities(
          db,
          Buffer.from(b.file, "base64"),
          b.dry_run !== false,
          u.id,
          {
            createMissing: b.create_missing_accounts === true,
            password: b.initial_password ?? "0000",
          },
        ),
      );
    }),
  );
  // Sweep before each authenticated workflow request as well as the background timer.
  app.use("/api/work/*", async (c, next) => {
    if (c.get("user")) sweepDeadlines(db);
    await next();
  });
  app.get(
    "/api/work/grade-guide",
    wrap((c) => {
      current(c);
      return c.json(
        db
          .prepare(
            "SELECT tier2_count AS silver,tier3_count AS gold,tier4_count AS platinum FROM workflow_settings WHERE id=1",
          )
          .get(),
      );
    }),
  );
  app.get(
    "/api/work/profile",
    wrap((c) => {
      const u = role(c, "influencer");
      const profile = db
        .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
        .get(u.id);
      return c.json({
        user_name: u.name,
        profile: {
          ...(profile as any),
          complete: profileComplete(profile),
          campaign_eligible: campaignEligible(profile),
        },
        history: historicalActivities(db, u.id),
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
      if (!/^[+0-9 ()-]{8,30}$/.test(phone))
        fail("연락처 형식을 확인해 주세요.");
      if (!socialProfileUrl(social))
        fail("올바른 HTTP/HTTPS SNS 프로필 링크를 입력해 주세요.");
      const followers = integer(b.followers, "팔로워 수", 0, 100_000_000);
      const nationality =
        b.nationality === undefined ? null : nationalityValue(b.nationality);
      db.transaction(() => {
        db.prepare(
          "UPDATE influencer_profiles SET phone=?,address=COALESCE(?,address),social_url=?,followers=?,nationality=COALESCE(?,nationality),import_review_required=0 WHERE user_id=?",
        ).run(phone, address ?? null, social, followers, nationality, u.id);
        db.prepare("UPDATE users SET phone=? WHERE id=?").run(phone, u.id);
      })();
      return c.json({ success: true });
    }),
  );
  app.put(
    "/api/work/profile/shipping",
    wrap(async (c) => {
      const u = role(c, "influencer"),
        b = await body(c);
      const recipient = text(b.recipient_name, "수령인", 2, 60),
        phone = text(b.shipping_phone, "배송 연락처", 8, 30),
        postal = text(b.postal_code, "우편번호", 3, 12),
        address = text(b.address, "주소", 5, 200),
        detail = text(b.address_detail ?? "", "상세주소", 0, 150);
      if (
        !/^[+0-9 ()-]{8,30}$/.test(phone) ||
        !/^[A-Za-z0-9 -]{3,12}$/.test(postal)
      )
        fail("연락처·우편번호 형식을 확인해 주세요.");
      db.prepare(
        "UPDATE influencer_profiles SET recipient_name=?,shipping_phone=?,postal_code=?,address=?,address_detail=? WHERE user_id=?",
      ).run(recipient, phone, postal, address, detail, u.id);
      return c.json({ success: true });
    }),
  );
  app.get(
    "/api/work/campaigns",
    wrap((c) => {
      const u = current(c);
      const where =
        u.role === "brand"
          ? "WHERE c.deleted_at=0 AND c.brand_id=?"
          : u.role === "influencer"
            ? "WHERE c.deleted_at=0 AND c.is_draft=0"
            : "WHERE c.deleted_at=0";
      const query = db.prepare(`SELECT c.*,u.name AS brand_name,
      (SELECT ci.id FROM campaign_images ci WHERE ci.campaign_id=c.id ORDER BY ci.position,ci.id LIMIT 1) AS thumbnail_id,
      (SELECT COUNT(*) FROM applications a WHERE a.campaign_id=c.id) AS applicant_count,
      (SELECT COUNT(*) FROM applications a WHERE a.campaign_id=c.id AND a.status NOT IN ('applied','rejected')) AS selected_count,
      (SELECT COUNT(*) FROM applications a WHERE a.campaign_id=c.id AND a.status='completed') AS completed_count
      FROM campaigns c JOIN users u ON u.id=c.brand_id ${where} ORDER BY c.id DESC`);
      return c.json({
        campaigns: u.role === "brand" ? query.all(u.id) : query.all(),
      });
    }),
  );
  app.put(
    "/api/work/campaigns/:id/capacity",
    wrap(async (c) => {
      const u = role(c, "admin"),
        b = await body(c);
      db.transaction(() => {
        const campaign = campaignFor(db, id(c), u, true);
        const capacity = integer(b.capacity, "선정 정원", 1, 500);
        const selected = (
          db
            .prepare(
              "SELECT count(*) n FROM applications WHERE campaign_id=? AND status NOT IN ('applied','rejected')",
            )
            .get(campaign.id) as any
        ).n;
        if (capacity < selected)
          fail(
            "선정 정원은 이미 선정된 인원보다 작게 설정할 수 없습니다.",
            409,
          );
        db.prepare("UPDATE campaigns SET capacity=? WHERE id=?").run(
          capacity,
          campaign.id,
        );
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_capacity',?,?)",
        ).run(
          u.id,
          JSON.stringify({
            campaign_id: campaign.id,
            previous: campaign.capacity,
            capacity,
          }),
          Date.now(),
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.put(
    "/api/work/campaigns/:id/final-deadline",
    wrap(async (c) => {
      const u = current(c),
        b = await body(c);
      const campaign = campaignFor(db, id(c), u, true);
      if (campaign.is_draft || campaign.status !== "closed")
        fail("모집이 마감된 캠페인의 최종 업로드 기한만 연장할 수 있습니다.", 409);
      const finalDate = text(b.final_date, "최종 업로드 마감일", 10, 10);
      const finalDue = deadline(finalDate);
      if (finalDue <= campaign.final_due || finalDue <= Date.now())
        fail("현재 마감일보다 늦은 미래 날짜를 입력해 주세요.", 409);
      db.transaction(() => {
        if (campaign.review_required)
          db.prepare("UPDATE campaigns SET final_date=?,final_due=? WHERE id=?")
            .run(finalDate, finalDue, campaign.id);
        else
          db.prepare("UPDATE campaigns SET draft_date=?,draft_due=?,final_date=?,final_due=? WHERE id=?")
            .run(finalDate, finalDue, finalDate, finalDue, campaign.id);
        const participants = db.prepare(
          "SELECT id,influencer_id FROM applications WHERE campaign_id=? AND status NOT IN ('applied','rejected','completed','no_show')",
        ).all(campaign.id) as { id: number; influencer_id: number }[];
        for (const participant of participants)
          notify(db, participant.influencer_id,
            `${campaign.title}: 최종 업로드 마감일이 ${finalDate}로 연장되었습니다.`,
            `/applications/${participant.id}`);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_final_deadline_extend',?,?)",
        ).run(u.id, JSON.stringify({ campaign_id: campaign.id, previous: campaign.final_date, final_date: finalDate, notified: participants.length }), Date.now());
      })();
      return c.json({ success: true, final_date: finalDate });
    }),
  );
  app.delete(
    "/api/work/campaigns/:id",
    wrap((c) => {
      const u = role(c, "admin");
      db.transaction(() => {
        const campaign = campaignFor(db, id(c), u, true);
        db.prepare("UPDATE campaigns SET deleted_at=? WHERE id=?").run(
          Date.now(),
          campaign.id,
        );
        db.prepare(
          "UPDATE email_outbox SET status='failed',last_error='campaign_deleted' WHERE application_id IN (SELECT id FROM applications WHERE campaign_id=?) AND status='pending'",
        ).run(campaign.id);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_delete',?,?)",
        ).run(u.id, JSON.stringify({ campaign_id: campaign.id }), Date.now());
      })();
      return c.json({ success: true });
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
        guidelines = text(b.guidelines ?? "", "가이드라인", 0, 6000);
      const guidelinesUrl = productLink(b.guidelines_url, "콘텐츠 가이드 링크");
      if (!guidelinesUrl) text(guidelines, "가이드라인", 10, 6000);
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
            `INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,compensation,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,product_url,recruit_start_date,recruit_start,review_required,guidelines_url,is_draft,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
            guidelinesUrl,
            1,
            "closed",
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
          !campaign.is_draft &&
          (applicants.length > 0 || campaign.status !== "recruiting");
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
            0,
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
        const guidelinesUrl = productLink(
          b.guidelines_url ?? campaign.guidelines_url,
          "콘텐츠 가이드 링크",
        );
        if (!guidelinesUrl) text(guidelines, "가이드라인", 10, 6000);
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
        if (
          locked &&
          review !== !!campaign.review_required &&
          !(
            u.role === "admin" &&
            campaign.status === "recruiting" &&
            selected === 0
          )
        )
          fail(
            "선정자가 있거나 모집이 마감된 캠페인의 검수 방식은 변경할 수 없습니다. 지원자가 있는 경우 관리자만 변경할 수 있습니다.",
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
          if (!campaign.is_draft && campaign.status !== "recruiting")
            fail(
              "모집 중이거나 비공개 초안인 캠페인만 일정을 변경할 수 있습니다.",
              409,
            );
          draft = deadline(draftDate);
          final = deadline(finalDate);
          ({ start, end } = recruitmentDates(
            startDate,
            endDate,
            draft,
            Date.now(),
            !campaign.import_key,
          ));
          if (review && final <= draft)
            fail("초안 마감 < 최종 마감 순서로 설정해 주세요.");
        }
        db.prepare(
          "UPDATE campaigns SET title=?,product=?,description=?,guidelines=?,capacity=?,pay_type=?,compensation=?,product_url=?,recruit_start_date=?,recruit_start=?,recruit_date=?,recruit_due=?,draft_date=?,draft_due=?,final_date=?,final_due=?,review_required=?,guidelines_url=? WHERE id=?",
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
          guidelinesUrl,
          campaign.id,
        );
        if (
          guidelines !== campaign.guidelines ||
          guidelinesUrl !== campaign.guidelines_url ||
          finalDate !== campaign.final_date
        )
          db.prepare(
            "UPDATE applications SET participation_confirmed_at=0,participation_due=? WHERE campaign_id=? AND status='selected'",
          ).run(Date.now() + 345600000, campaign.id);
        if (b.publish === true) {
          if (!campaign.is_draft) fail("이미 공개된 캠페인입니다.", 409);
          recruitmentDates(
            startDate,
            endDate,
            draft,
            Date.now(),
            !campaign.import_key,
          );
          if (draft <= Date.now() || final <= Date.now())
            fail(
              "공개할 캠페인의 콘텐츠 제출 마감일은 미래 날짜로 설정해 주세요.",
            );
          if (final < draft || (review && final === draft))
            fail("캠페인 제출 일정을 확인해 주세요.");
          db.prepare("UPDATE campaigns SET is_draft=0,status=? WHERE id=?").run(
            end <= Date.now() ? "closed" : "recruiting",
            campaign.id,
          );
        }
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
          guidelinesUrl !== campaign.guidelines_url ||
          url !== campaign.product_url ||
          capacity !== campaign.capacity ||
          changed
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
                `SELECT a.*,u.name AS influencer_name,u.email AS influencer_email,p.followers,p.tier,p.completed_count,p.onboarding_approved,p.no_show_count,p.social_url,p.nationality,(SELECT COUNT(*) FROM applications ongoing JOIN campaigns active_campaign ON active_campaign.id=ongoing.campaign_id WHERE active_campaign.deleted_at=0 AND ongoing.influencer_id=a.influencer_id AND ongoing.status NOT IN ('applied','rejected','completed','no_show')) AS active_count FROM applications a JOIN users u ON u.id=a.influencer_id JOIN influencer_profiles p ON p.user_id=a.influencer_id WHERE a.campaign_id=? ORDER BY p.completed_count DESC,a.id ASC`,
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
    "/api/work/campaigns/:id/selection",
    wrap(async (c) => {
      const u = current(c),
        b = await body(c);
      return c.json(finalizeSelection(db, u, id(c), b.application_ids));
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
        if (!profileComplete(p))
          fail(
            "캠페인 지원 전에 내 프로필에 SNS 계정과 팔로워 정보를 등록해 주세요.",
            409,
          );
        if (!campaignEligible(p))
          fail("홍보 인증 승인 후 캠페인에 지원할 수 있습니다.", 409);
        const previous = db
          .prepare(
            "SELECT id,status,withdrawn_at FROM applications WHERE campaign_id=? AND influencer_id=?",
          )
          .get(campaign.id, u.id) as
          | { id: number; status: string; withdrawn_at: number }
          | undefined;
        if (previous && !(previous.status === "rejected" && previous.withdrawn_at))
          fail("이미 지원한 캠페인입니다.", 409);
        if (previous) {
          db.prepare(
            "UPDATE applications SET status='applied',withdrawn_at=0,consent_at=?,consent_version='secondary-and-original-v2',secondary_use_consent=1,original_delivery_consent=1,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          ).run(Date.now(), p.phone, previous.id);
          event(db, previous, u.id, "applied", "취소한 캠페인에 다시 지원했습니다.");
          notify(
            db,
            campaign.brand_id,
            `${campaign.title}: 지원자가 다시 지원했습니다.`,
            `/campaigns/${campaign.id}`,
          );
          return previous.id;
        }
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
    "/api/work/campaigns/:id/finalize-selection",
    wrap((c) => {
      const u = current(c), campaign = campaignFor(db, id(c), u, true);
      if (u.role !== "admin" && u.role !== "brand") fail("접근 권한이 없습니다.", 403);
      if (campaign.status !== "closed") fail("모집 마감 후 선정 결과를 확정해 주세요.", 409);
      const remaining = db.prepare("SELECT COUNT(*) AS count FROM applications WHERE campaign_id=? AND status='applied'").get(campaign.id) as { count: number };
      db.prepare("UPDATE campaigns SET selection_finalized_at=? WHERE id=? AND selection_finalized_at=0")
        .run(Date.now(), campaign.id);
      return c.json({ success: true, not_selected: remaining.count });
    }),
  );
  app.post(
    "/api/work/campaigns/:id/close",
    wrap(async (c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true),
        b = await body(c);
      if (campaign.status !== "recruiting")
        fail("모집 중인 캠페인만 마감할 수 있습니다.", 409);
      if (campaign.recruit_due > Date.now() && b.confirm_close !== true)
        fail("마감일 전 모집을 종료하려면 확인이 필요합니다.", 409);
      db.transaction(() => {
        db.prepare("UPDATE campaigns SET status='closed' WHERE id=?").run(
          campaign.id,
        );
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_close',?,?)",
        ).run(
          u.id,
          JSON.stringify({
            campaign_id: campaign.id,
            recruit_date: campaign.recruit_date,
          }),
          Date.now(),
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.post(
    "/api/work/campaigns/:id/reopen",
    wrap((c) => {
      const u = current(c),
        campaign = campaignFor(db, id(c), u, true);
      if (
        campaign.is_draft ||
        campaign.status !== "closed" ||
        campaign.recruit_due <= Date.now()
      )
        fail("모집 마감일이 남은 캠페인만 다시 열 수 있습니다.", 409);
      db.transaction(() => {
        db.prepare("UPDATE campaigns SET status='recruiting' WHERE id=?").run(
          campaign.id,
        );
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_reopen',?,?)",
        ).run(u.id, JSON.stringify({ campaign_id: campaign.id }), Date.now());
      })();
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
            `SELECT a.*,c.selection_finalized_at,c.review_required,c.title,c.product,c.draft_date,c.final_date,c.recruit_date,u.name AS brand_name FROM applications a JOIN campaigns c ON c.id=a.campaign_id JOIN users u ON u.id=c.brand_id WHERE c.deleted_at=0 AND a.influencer_id=? ORDER BY a.id DESC`,
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
          content_links: (() => {
            const links = db.prepare("SELECT id,url FROM application_content_links WHERE application_id=? ORDER BY id").all(a.id) as { id: number; url: string }[];
            return links.length ? links : a.final_url ? [{ id: 0, url: a.final_url }] : [];
          })(),
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
    "/api/work/admin/applications/:id/content-links",
    wrap(async (c) => {
      const admin = role(c, "admin"),
        b = await body(c);
      const a = applicationFor(db, id(c), admin);
      if (b.confirm_email?.toLowerCase() !== a.influencer_email.toLowerCase())
        fail("신청자 이메일을 확인해 주세요.", 409);
      if (a.campaign_deleted_at || !["final_submitted", "completed"].includes(a.status))
        fail("최종 콘텐츠를 제출한 신청에만 링크를 추가할 수 있습니다.", 409);
      const url = externalLink(b.url, false);
      const result = db.transaction(() => {
        let links = db.prepare("SELECT url FROM application_content_links WHERE application_id=? ORDER BY id").all(a.id) as { url: string }[];
        if (!links.length && a.final_url) {
          db.prepare("INSERT INTO application_content_links(application_id,url,created_at,updated_at) VALUES(?,?,?,?)")
            .run(a.id, a.final_url, Date.now(), Date.now());
          links = [{ url: a.final_url }];
        }
        if (links.some((link) => link.url === url)) return { success: true, already_exists: true, count: links.length };
        if (links.length >= 3) fail("최종 콘텐츠 링크는 캠페인당 최대 3개까지 제출할 수 있습니다.", 409);
        db.prepare("INSERT INTO application_content_links(application_id,url,created_at,updated_at) VALUES(?,?,?,?)")
          .run(a.id, url, Date.now(), Date.now());
        db.prepare("UPDATE applications SET final_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(links[0]?.url ?? url, a.id);
        event(db, a, admin.id, a.status, "관리자가 최종 SNS 게시물 링크를 추가했습니다.", url);
        return { success: true, already_exists: false, count: links.length + 1 };
      })();
      return c.json(result);
    }),
  );
  app.post(
    "/api/work/admin/applications/:id/withdraw",
    wrap(async (c) => {
      const admin = role(c, "admin"),
        b = await body(c);
      const a = applicationFor(db, id(c), admin);
      if (b.confirm_email?.toLowerCase() !== a.influencer_email.toLowerCase())
        fail("신청자 이메일을 확인해 주세요.", 409);
      if (a.campaign_deleted_at || a.status !== "selected" || a.tracking_number)
        fail("배송 전 선정 상태의 신청만 참여 취소할 수 있습니다.", 409);
      db.transaction(() => {
        const now = Date.now();
        db.prepare("UPDATE applications SET status='rejected',participation_confirmed_at=0,withdrawn_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(now, a.id);
        event(db, a, admin.id, "withdrawn", "선정자가 참여하지 않겠다고 알려 운영사가 참여 확인을 취소했습니다.");
        db.prepare("INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)")
          .run(admin.id, a.influencer_id, "application_withdraw", `application:${a.id}`, now);
      })();
      return c.json({ success: true });
    }),
  );
  app.post(
    "/api/work/applications/:id/action",
    wrap(async (c) => {
      const u = current(c),
        b = await body(c);
      db.transaction(() => {
        const a = applicationFor(db, id(c), u);
        if (a.campaign_deleted_at)
          fail("삭제된 캠페인은 진행할 수 없습니다.", 409);
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
            finalizeSelection(db, u, a.campaign_id, [a.id]);
            return;
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
          case "withdraw":
            if (!influencer) fail("본인의 지원만 취소할 수 있습니다.", 403);
            requireState(["applied"]);
            status = "rejected";
            note = "지원자가 선정 전에 지원을 취소했습니다.";
            db.prepare("UPDATE applications SET withdrawn_at=? WHERE id=?").run(
              Date.now(),
              a.id,
            );
            break;
          case "address": {
            const admin = u.role === "admin";
            if (!influencer && !admin) fail("접근 권한이 없습니다.", 403);
            if (admin && b.confirm_email !== a.influencer_email)
              fail("배송지를 변경할 계정의 이메일을 확인해 주세요.", 409);
            requireState(["selected"]);
            if (!admin && a.participation_due > 0 && Date.now() >= a.participation_due)
              fail("참여 확인 기한이 지나 배송지를 저장할 수 없습니다. 운영사에 문의해 주세요.", 409);
            if (
              !admin &&
              a.consent_version.startsWith("external-form-v2") &&
              (!a.secondary_use_consent || !a.original_delivery_consent)
            )
              fail("배송지 등록 전에 필수 동의를 확인해 주세요.", 409);
            if (
              !admin &&
              (b.participation_confirmed !== true ||
                b.guidelines_confirmed !== true ||
                b.deadline_confirmed !== true)
            )
              fail(
                "참여 의사, 콘텐츠 가이드, 기한 내 업로드를 모두 확인해 주세요.",
              );
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
              "UPDATE applications SET recipient_name=?,phone=?,postal_code=?,address=?,address_detail=?,shipping_address_at=?,participation_confirmed_at=CASE WHEN ? THEN ? ELSE participation_confirmed_at END WHERE id=?",
            ).run(
              recipient,
              phone,
              postal,
              address,
              detail,
              Date.now(),
              !admin ? 1 : 0,
              Date.now(),
              a.id,
            );
            if (influencer && !a.participation_confirmed_at)
              queueBrandShippingReadyEmail(db, a.id);
            note = admin
              ? "운영사가 배송지를 수정했습니다."
              : "배송지가 등록되었습니다.";
            if (admin)
              db.prepare(
                "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
              ).run(
                u.id,
                a.influencer_id,
                "shipping_address_edit",
                `application:${a.id}`,
                Date.now(),
              );
            break;
          }
          case "ship": {
            if (!brand) fail("접근 권한이 없습니다.", 403);
            requireState(["selected", "shipping", "final_submitted"]);
            if (a.status === "selected" && !a.participation_confirmed_at)
              fail("인플루언서의 캠페인 참여 확인이 필요합니다.", 409);
            if (
              a.consent_version.startsWith("external-form-v2") &&
              (!a.secondary_use_consent || !a.original_delivery_consent)
            )
              fail("발송 전에 필수 동의가 필요합니다.", 409);
            if (!a.address || !a.phone)
              fail("선정자가 배송지를 먼저 등록해야 합니다.", 409);
            const carrier = text(b.carrier, "택배사", 2, 40),
              tracking = text(b.tracking_number, "송장번호", 5, 40);
            if (!/^[A-Za-z0-9-]+$/.test(tracking))
              fail("송장번호 형식을 확인해 주세요.");
            db.prepare(
              "UPDATE applications SET carrier=?,tracking_number=? WHERE id=?",
            ).run(carrier, tracking, a.id);
            status = a.status === "final_submitted" ? "final_submitted" : "shipping";
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
            requireState(a.review_required ? ["draft_approved", "final_submitted", "completed"] : ["selected", "shipping", "draft_submitted", "revision_requested", "draft_approved", "final_submitted", "completed"]);
            if (a.status === "selected" && !a.participation_confirmed_at)
              fail("먼저 배송지와 캠페인 참여 의사를 확인해 주세요.", 409);
            if (!a.final_url && Date.now() >= a.final_due)
              fail("최종 제출 마감이 지났습니다.", 409);
            link = externalLink(b.url, false);
            if (a.final_url && !db.prepare("SELECT 1 FROM application_content_links WHERE application_id=?").get(a.id))
              db.prepare("INSERT INTO application_content_links(application_id,url,created_at,updated_at) VALUES(?,?,?,?)").run(a.id, a.final_url, Date.now(), Date.now());
            if (b.link_id !== undefined && b.link_id !== "") {
              let linkId = integer(Number(b.link_id), "콘텐츠 링크 ID", 0);
              if (linkId === 0)
                linkId = (db.prepare("SELECT id FROM application_content_links WHERE application_id=? ORDER BY id LIMIT 1").get(a.id) as { id: number }).id;
              const updated = db.prepare("UPDATE application_content_links SET url=?,updated_at=? WHERE id=? AND application_id=?")
                .run(link, Date.now(), linkId, a.id);
              if (!updated.changes) fail("수정할 링크를 찾을 수 없습니다.", 404);
              note = "최종 SNS 게시물 링크가 수정되었습니다.";
            } else {
              const count = (db.prepare("SELECT COUNT(*) AS count FROM application_content_links WHERE application_id=?").get(a.id) as { count: number }).count;
              if (count >= 3) fail("최종 콘텐츠 링크는 캠페인당 최대 3개까지 제출할 수 있습니다.", 409);
              db.prepare("INSERT INTO application_content_links(application_id,url,created_at,updated_at) VALUES(?,?,?,?)")
                .run(a.id, link, Date.now(), Date.now());
              note = "최종 SNS 게시물 링크가 추가되었습니다.";
            }
            const first = db.prepare("SELECT url FROM application_content_links WHERE application_id=? ORDER BY id LIMIT 1").get(a.id) as { url: string };
            db.prepare("UPDATE applications SET final_url=? WHERE id=?").run(first.url, a.id);
            if (a.status !== "completed") status = "final_submitted";
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
        event(db, a, u.id, b.action === "withdraw" ? "withdrawn" : status, note, link);
        if (b.action === "select") queueSelectionEmail(db, a.id);
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
    "/api/work/admin/email",
    wrap((c) => {
      role(c, "admin");
      return c.json(emailStatus(db));
    }),
  );
  app.post(
    "/api/work/admin/campaigns/:id/guide-email",
    wrap(async (c) => {
      const u = role(c, "admin"),
        campaign = campaignFor(db, id(c), u, true),
        b = await body(c);
      if (!emailConfig().configured)
        fail("메일 발송 설정을 확인해 주세요.", 503);
      const message = text(b.message, "콘텐츠 가이드 메일", 20, 12000),
        expected = integer(b.expected_count, "발송 대상 인원", 1, 500);
      const result = db.transaction(() => {
        const recipients = db
          .prepare(
            `SELECT a.id,u.email FROM applications a JOIN users u ON u.id=a.influencer_id
           WHERE a.campaign_id=? AND a.status='shipping' AND a.tracking_number!=''
           ORDER BY a.id`,
          )
          .all(campaign.id) as { id: number; email: string }[];
        if (recipients.length !== expected)
          fail(
            "배송 대상 인원이 변경됐습니다. 명단을 다시 확인해 주세요.",
            409,
          );
        const now = Date.now();
        const insert = db.prepare(
          `INSERT OR IGNORE INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at)
           VALUES(?,?,?,?,?,?,?)`,
        );
        let queued = 0;
        for (const recipient of recipients)
          queued += insert.run(
            recipient.id,
            `content-guide:${campaign.id}:${recipient.id}`,
            recipient.email,
            `[Seoul Scent] ${campaign.title} Content guide / 콘텐츠 가이드`,
            `${message}\n\n`,
            now,
            now,
          ).changes;
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
        ).run(
          u.id,
          "campaign_guide_email",
          `campaign:${campaign.id};queued:${queued}`,
          now,
        );
        return { recipients: recipients.length, queued };
      })();
      return c.json(result);
    }),
  );
  app.post(
    "/api/work/admin/campaigns/:id/final-reminder-email",
    wrap(async (c) => {
      const u = role(c, "admin"),
        campaign = campaignFor(db, id(c), u, true),
        b = await body(c);
      if (!emailConfig().configured)
        fail("메일 발송 설정을 확인해 주세요.", 503);
      const finalDate = text(b.final_date, "최종 업로드 마감일", 10, 10),
        expected = integer(b.expected_count, "발송 대상 인원", 1, 500),
        reminderRound = integer(b.reminder_round ?? 1, "재안내 회차", 1, 10);
      if (campaign.final_date !== finalDate || campaign.final_due <= Date.now())
        fail("캠페인의 최종 업로드 마감일을 다시 확인해 주세요.", 409);
      const recipients = db.prepare(
        `SELECT a.id,u.email,u.name FROM applications a
         JOIN users u ON u.id=a.influencer_id
         WHERE a.campaign_id=? AND a.status='shipping'
           AND a.tracking_number!='' AND a.final_url=''
         ORDER BY a.id`,
      ).all(campaign.id) as { id: number; email: string; name: string }[];
      if (recipients.length !== expected)
        fail(`발송 대상이 변경됐습니다. 현재 ${recipients.length}명입니다.`, 409);
      if (b.dry_run !== false)
        return c.json({ recipients: recipients.length, queued: 0, applied: false });
      const now = Date.now(),
        dueEn = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
        }).format(new Date(campaign.final_due - 1)),
        dueKo = new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
        }).format(new Date(campaign.final_due - 1)),
        todayKst = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(now),
        dueToday = finalDate === todayKst;
      const queued = db.transaction(() => {
        const insert = db.prepare(
          `INSERT OR IGNORE INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at)
           VALUES(?,?,?,?,?,?,?)`,
        );
        let count = 0;
        for (const recipient of recipients) {
          const message = `English

Hello ${recipient.name},

This is a reminder for the ${campaign.title_en || campaign.title} campaign. Please publish your content and submit the final post link ${dueToday ? `by 11:59 PM today, ${dueEn} (KST)` : `by ${dueEn} (KST)`}.

If you have not received the product, please reply to this email so we can check the delivery.

--------------------

한국어

안녕하세요, ${recipient.name}님.

${campaign.title} 캠페인의 콘텐츠를 게시한 뒤 최종 게시물 링크를 ${dueToday ? `오늘(${dueKo}) 23:59(한국시간)` : dueKo}까지 제출해 주세요.

제품을 아직 받지 못하셨다면 이 메일에 회신해 주시면 배송 상태를 확인하겠습니다.

`;
          count += insert.run(
            recipient.id,
            `final-reminder:${campaign.id}:${recipient.id}:${finalDate}${reminderRound > 1 ? `:round-${reminderRound}` : ""}`,
            recipient.email,
            dueToday ? `[Seoul Scent] ${campaign.title} Due today / 오늘 업로드 마감` : `[Seoul Scent] ${campaign.title} Final upload reminder / 최종 업로드 안내`,
            message,
            now,
            now,
          ).changes;
        }
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_final_reminder_email',?,?)",
        ).run(u.id, JSON.stringify({ campaign_id: campaign.id, final_date: finalDate, reminder_round: reminderRound, recipients: recipients.length, queued: count }), now);
        return count;
      })();
      return c.json({ recipients: recipients.length, queued, applied: true });
    }),
  );
  app.post(
    "/api/work/admin/campaigns/:id/progress-email",
    wrap(async (c) => {
      const admin = role(c, "admin"), campaign = campaignFor(db, id(c), admin, true), b = await body(c);
      if (!emailConfig().configured) fail("메일 발송 설정을 확인해 주세요.", 503);
      if (!["shipping", "selected"].includes(b.audience)) fail("발송 대상을 확인해 주세요.");
      const expected = integer(b.expected_count, "발송 대상 인원", 1, 500);
      const date = text(b.final_date, "최종 업로드 마감일", 10, 10);
      if (campaign.final_date !== date) fail("마감일이 변경됐습니다. 다시 확인해 주세요.", 409);
      const recipients = db.prepare(`SELECT a.id,u.email,u.name FROM applications a JOIN users u ON u.id=a.influencer_id
        WHERE a.campaign_id=? AND a.status=? AND a.final_url='' AND (?='selected' OR a.tracking_number!='') ORDER BY a.id`)
        .all(campaign.id, b.audience, b.audience) as { id: number; email: string; name: string }[];
      if (recipients.length !== expected) fail(`발송 대상이 변경됐습니다. 현재 ${recipients.length}명입니다.`, 409);
      if (b.dry_run !== false) return c.json({ recipients: recipients.length, queued: 0, applied: false });
      const shipping = b.audience === "shipping", now = Date.now();
      const queued = db.transaction(() => {
        const insert = db.prepare(`INSERT OR IGNORE INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at)
          VALUES(?,?,?,?,?,?,?)`);
        let count = 0;
        for (const recipient of recipients) {
          const message = `한국어

${recipient.name}님, 안녕하세요. Seoul Scent입니다.

${campaign.title} 캠페인 진행 상황을 안내드립니다.
${shipping ? "제품 배송정보가 등록되었습니다. 제품을 잘 받으셨는지 확인해 주세요. 아직 받지 못하셨다면 이 메일에 회신해 주세요." : "제품 배송을 준비 중입니다. 내 캠페인에서 참여 의사와 배송지를 확인해 주세요. 배송이 시작되면 콘텐츠를 제작해 주세요."}
콘텐츠를 게시한 뒤 최종 SNS 링크를 ${date}까지 내 캠페인에 제출해 주세요. 이미 제출하셨다면 추가 제출은 필요하지 않습니다.

내 캠페인: https://seoul-scent.onrender.com/applications

--------------------

English

Hello ${recipient.name},

Here is an update on your ${campaign.title} campaign.
${shipping ? "Your shipping information has been registered. Please check that you received the product. If you have not received it, reply to this email." : "We are preparing shipment. Please confirm your participation and shipping address in My Campaigns. Create your content after the product arrives."}
Please publish your content and submit the final social post link in My Campaigns by ${date} (KST).

My Campaigns: https://seoul-scent.onrender.com/applications
`;
          count += insert.run(recipient.id, `progress:2026-10-27:${campaign.id}:${b.audience}:${recipient.id}`,
            recipient.email, `[Seoul Scent] ${campaign.title} 진행 상황 / Campaign update`, message, now, now).changes;
        }
        return count;
      })();
      return c.json({ recipients: recipients.length, queued, applied: true });
    }),
  );
  app.get(
    "/api/work/admin/campaigns/:id/guide-email",
    wrap((c) => {
      const u = role(c, "admin"),
        campaign = campaignFor(db, id(c), u, true);
      return c.json({
        campaign_id: campaign.id,
        counts: db
          .prepare(
            "SELECT status,COUNT(*) AS count FROM email_outbox WHERE event_key LIKE ? GROUP BY status",
          )
          .all(`content-guide:${campaign.id}:%`),
      });
    }),
  );
  app.post(
    "/api/work/admin/email/:id/retry",
    wrap((c) => {
      const u = role(c, "admin");
      db.transaction(() => {
        const result = db
          .prepare(
            "UPDATE email_outbox SET status='pending',attempts=0,next_attempt=?,last_error='' WHERE id=? AND status='failed' AND application_id IN (SELECT a.id FROM applications a JOIN campaigns c ON c.id=a.campaign_id WHERE c.deleted_at=0)",
          )
          .run(Date.now(), id(c));
        if (!result.changes) fail("실패한 메일만 재시도할 수 있습니다.", 409);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
        ).run(u.id, "email_retry", `email:${id(c)}`, Date.now());
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
      b.tier2_views = 0;
      b.tier3_views = 0;
      b.tier4_views = 0;
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
        fail("등급 기준은 단계가 높아질수록 같거나 증가해야 합니다.");
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
            `SELECT u.id,u.name,CASE WHEN u.email=u.username THEN '' ELSE u.email END AS email,u.username,u.phone,u.must_change_password,u.role,u.created_at,p.social_url,p.nationality,p.import_review_required,p.followers,p.tier,p.completed_count,p.onboarding_approved,p.campaign_access_granted,p.total_views,p.no_show_count,p.blocked_until,p.blacklisted,(SELECT COUNT(*) FROM applications ongoing JOIN campaigns active_campaign ON active_campaign.id=ongoing.campaign_id WHERE active_campaign.deleted_at=0 AND ongoing.influencer_id=u.id AND ongoing.status NOT IN ('applied','rejected','completed','no_show')) AS active_count FROM users u LEFT JOIN influencer_profiles p ON p.user_id=u.id ORDER BY u.id DESC`,
          )
          .all()
          .map((u: any) => ({
            ...u,
            can_apply:
              u.role === "influencer" &&
              !u.must_change_password &&
              profileComplete(u) &&
              campaignEligible(u) &&
              !u.blacklisted &&
              u.blocked_until <= Date.now(),
          })),
      });
    }),
  );
  app.post(
    "/api/work/admin/influencers/grant-import-access",
    wrap(async (c) => {
      const admin = role(c, "admin"),
        b = await body(c);
      const expected = integer(b.expected_count, "대상 인원", 1, 500);
      const candidates = db
        .prepare(
          `SELECT u.id,u.password_hash,u.must_change_password,p.*
           FROM users u JOIN influencer_profiles p ON p.user_id=u.id
           WHERE u.role='influencer' AND u.must_change_password=1
             AND p.completed_count=0 AND p.onboarding_approved=0
             AND p.campaign_access_granted=0 AND p.blacklisted=0
             AND p.blocked_until<=?`,
        )
        .all(Date.now()) as any[];
      const ids = candidates
        .filter((person) =>
          profileComplete(person) && verifyPassword("0000", person.password_hash),
        )
        .map((person) => person.id);
      if (ids.length !== expected)
        fail(`대상 인원이 변경되었습니다. 현재 ${ids.length}명입니다.`, 409);
      if (b.dry_run !== false) return c.json({ count: ids.length, applied: false });
      db.transaction(() => {
        const grant = db.prepare(
          "UPDATE influencer_profiles SET campaign_access_granted=1 WHERE user_id=? AND campaign_access_granted=0",
        );
        for (const userId of ids) grant.run(userId);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'campaign_access_grant',?,?)",
        ).run(admin.id, JSON.stringify({ user_ids: ids, count: ids.length }), Date.now());
      })();
      return c.json({ count: ids.length, applied: true });
    }),
  );
  app.post(
    "/api/work/admin/users/:id/grant-bronze-access",
    wrap((c) => {
      const actor = role(c, "admin"), target = id(c);
      const result = db.transaction(() => {
        const user = db.prepare("SELECT id,role FROM users WHERE id=?").get(target) as any;
        const profile = db.prepare("SELECT * FROM influencer_profiles WHERE user_id=?").get(target) as any;
        if (!user || user.role !== "influencer" || !profile)
          fail("인플루언서를 찾을 수 없습니다.", 404);
        if (!profileComplete(profile)) fail("프로필 정보를 먼저 완료해 주세요.", 409);
        if (profile.blacklisted || profile.blocked_until > Date.now())
          fail("지원 제한 중인 계정입니다.", 409);
        db.prepare("UPDATE influencer_profiles SET onboarding_approved=1 WHERE user_id=?").run(target);
        db.prepare("INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)")
          .run(actor.id, target, "grant_bronze_access", "Admin approved bronze campaign access", Date.now());
        notify(db, target, "브론즈 등급으로 승급되었습니다. 캠페인에 지원할 수 있습니다.", "/campaigns");
        return { success: true, user_id: target };
      })();
      return c.json(result);
    }),
  );
  app.post(
    "/api/work/admin/users",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        b = await body(c);
      const email = text(b.email, "이메일", 3, 254).toLowerCase();
      const name = text(b.name, "이름", 2, 60);
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))
        fail("올바른 이메일 주소를 입력해 주세요.");
      if (db.prepare("SELECT id FROM users WHERE lower(email)=?").get(email))
        fail("이미 사용 중인 이메일입니다.", 409);
      const temporaryPassword = randomBytes(24).toString("base64url");
      const userId = db.transaction(() => {
        const result = db
          .prepare(
            "INSERT INTO users(email,name,role,password_hash,must_change_password) VALUES(?,?,'admin',?,1)",
          )
          .run(email, name, hashPassword(temporaryPassword));
        const id = Number(result.lastInsertRowid);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          actor.id,
          id,
          "admin_account_create",
          JSON.stringify({ email, must_change_password: true }),
          Date.now(),
        );
        return id;
      })();
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          id: userId,
          email,
          name,
          role: "admin",
          must_change_password: true,
          temporary_password: temporaryPassword,
        },
        201,
      );
    }),
  );
  app.post(
    "/api/work/admin/selection-preview",
    wrap((c) => {
      const actor = role(c, "admin");
      const email = "preview.influencer@example.invalid";
      if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
        fail("체험 계정이 이미 있습니다. 기존 계정을 확인해 주세요.", 409);
      if (
        db
          .prepare("SELECT id FROM users WHERE email=? OR username=?")
          .get("influtest", "influtest")
      )
        fail("체험용 아이디가 이미 사용 중입니다.", 409);
      const password = randomBytes(18).toString("base64url");
      const formatDate = (offset: number) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(Date.now() + offset * 86400_000));
      const recruitDate = formatDate(7);
      const draftDate = formatDate(30);
      const finalDate = formatDate(60);
      const created = db.transaction(() => {
        const userId = Number(
          db
            .prepare(
              "INSERT INTO users(email,name,role,password_hash,username) VALUES(?,?,'influencer',?,'influtest')",
            )
            .run(email, "선정 화면 체험용", hashPassword(password))
            .lastInsertRowid,
        );
        db.prepare(
          "UPDATE influencer_profiles SET recipient_name=?,shipping_phone=?,postal_code=?,address=? WHERE user_id=?",
        ).run(
          "체험용 수령인",
          "01000000000",
          "00000",
          "서울특별시 예시구 향기로 10",
          userId,
        );
        const campaignId = Number(
          db
            .prepare(
              `INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status,is_draft,import_key,review_required)
             VALUES(?,?,?,?,?,1,'gifted',?,?,?,?,?,?,'closed',1,?,1)`,
            )
            .run(
              actor.id,
              "[체험용] 선정 확인 화면",
              "화면 체험용 제품 (실물 발송 없음)",
              "인플루언서 선정 후 참여 확인 화면을 살펴보는 비공개 캠페인입니다. 실제 협찬이나 발송은 진행하지 않습니다.",
              "화면 체험용입니다. 실제 주소나 개인정보를 입력하지 말고 예시 배송지와 확인 항목을 살펴보세요.",
              recruitDate,
              draftDate,
              finalDate,
              deadline(recruitDate),
              deadline(draftDate),
              deadline(finalDate),
              "admin-selection-preview:v1",
            ).lastInsertRowid,
        );
        const applicationId = Number(
          db
            .prepare(
              `INSERT INTO applications(campaign_id,influencer_id,status,consent_at,consent_version,phone,address,secondary_use_consent,original_delivery_consent)
             VALUES(?,?,'selected',?,'secondary-use-v2',?,'',1,1)`,
            )
            .run(campaignId, userId, Date.now(), "01000000000").lastInsertRowid,
        );
        event(
          db,
          { id: applicationId },
          actor.id,
          "selected",
          "체험용 계정의 선정 화면입니다. 실제 배송이나 콘텐츠 제출은 진행하지 않습니다.",
        );
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          actor.id,
          userId,
          "selection_preview_create",
          JSON.stringify({
            campaign_id: campaignId,
            application_id: applicationId,
          }),
          Date.now(),
        );
        return { userId, campaignId, applicationId };
      })();
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          email,
          password,
          application_id: created.applicationId,
          campaign_id: created.campaignId,
        },
        201,
      );
    }),
  );
  app.put(
    "/api/work/admin/selection-preview/username",
    wrap((c) => {
      const actor = role(c, "admin");
      const user = db
        .prepare(
          `SELECT u.id,u.username FROM users u
         JOIN applications a ON a.influencer_id=u.id
         JOIN campaigns c ON c.id=a.campaign_id
         WHERE u.email='preview.influencer@example.invalid'
           AND u.role='influencer' AND c.import_key='admin-selection-preview:v1'`,
        )
        .get() as { id: number; username: string | null } | undefined;
      if (!user) return fail("체험 계정을 찾을 수 없습니다.", 404);
      if (user.username === "influtest")
        return c.json({ username: "influtest" });
      if (
        db
          .prepare(
            "SELECT id FROM users WHERE (email=? OR username=?) AND id!=?",
          )
          .get("influtest", "influtest", user.id)
      )
        fail("체험용 아이디가 이미 사용 중입니다.", 409);
      db.transaction(() => {
        db.prepare("UPDATE users SET username='influtest' WHERE id=?").run(
          user.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        db.prepare("DELETE FROM login_attempts WHERE email IN (?,?)").run(
          "influtest",
          `login:${user.id}`,
        );
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          actor.id,
          user.id,
          "selection_preview_username",
          "influtest",
          Date.now(),
        );
      })();
      return c.json({ username: "influtest" });
    }),
  );
  app.get(
    "/api/work/admin/influencers.xlsx",
    wrap(async (c) => {
      role(c, "admin");
      const rows = db
        .prepare(
          `SELECT u.id,u.name,u.email,p.phone,p.nationality,p.social_url,p.followers,p.tier,p.completed_count,p.onboarding_approved
         FROM users u JOIN influencer_profiles p ON p.user_id=u.id
         WHERE u.role='influencer' ORDER BY p.followers DESC,u.id ASC`,
        )
        .all() as any[];
      const book = new ExcelJS.Workbook();
      const summary = book.addWorksheet("요약");
      summary.addRows([
        ["항목", "결과"],
        [
          "생성 일시 (한국 시간)",
          new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
        ],
        ["전체 인플루언서", rows.length],
        ["팔로워 수 등록 인원", rows.filter((r) => r.followers > 0).length],
        ["팔로워 수 미등록 인원", rows.filter((r) => r.followers === 0).length],
        ["팔로워 합계", rows.reduce((sum, r) => sum + r.followers, 0)],
        [
          "집계 안내",
          "현재 저장된 수치입니다. 반올림된 표시값을 환산한 수치가 포함될 수 있으며, 계정 간 팔로워 중복을 제거한 고유 도달 인원이 아닙니다.",
        ],
      ]);
      const columns = [
        { header: "이름", key: "name", width: 28 },
        { header: "이메일", key: "email", width: 38 },
        { header: "국적", key: "nationality", width: 22 },
        { header: "연락처", key: "phone", width: 22 },
        { header: "SNS 링크", key: "social_url", width: 65 },
        { header: "팔로워 수", key: "followers", width: 18 },
        { header: "등급", key: "grade", width: 16 },
        { header: "완료 참여 횟수", key: "completed_count", width: 20 },
        { header: "확인 상태", key: "status", width: 25 },
      ];
      const output = rows.map((r) => ({
        ...r,
        grade: tierLabel(r.tier, r.completed_count, r.onboarding_approved),
        status:
          r.followers > 0
            ? "수치 등록됨"
            : r.social_url
              ? "팔로워 수 확인 필요"
              : "SNS 미등록",
      }));
      for (const [name, data] of [
        ["전체 명단", output],
        ["팔로워 확인 필요", output.filter((r) => r.followers === 0)],
      ] as const) {
        const sheet = book.addWorksheet(name);
        sheet.columns = columns;
        sheet.addRows(data);
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        sheet.autoFilter = { from: "A1", to: "I1" };
        sheet.getColumn("phone").numFmt = "@";
        sheet.getColumn("followers").numFmt = "#,##0";
      }
      summary.getColumn(1).width = 30;
      summary.getColumn(2).width = 90;
      summary.getColumn(2).alignment = { wrapText: true };
      for (const sheet of book.worksheets)
        sheet.getRow(1).font = { bold: true };
      return new Response((await book.xlsx.writeBuffer()) as any, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="seoul-scent-influencers-${seoulToday()}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }),
  );
  for (const extension of ["pdf", "pptx"] as const) {
    app.get(
      `/api/work/admin/brand-introduction.${extension}`,
      wrap(async (c) => {
        role(c, "admin");
        const filename = `seoul-scent-brand-introduction.${extension}`;
        const file = await readFile(`./documents/${filename}`);
        return new Response(file as any, {
          headers: {
            "Content-Type":
              extension === "pdf"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "Content-Disposition": `${extension === "pdf" && c.req.query("view") === "1" ? "inline" : "attachment"}; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }),
    );
  }
  const contentReportPath = () => {
    if (db.name === ":memory:")
      fail("보고서 저장에는 영구 저장소가 필요합니다.", 409);
    return join(dirname(db.name), "admin-reports", "content-followers.xlsx");
  };
  app.put(
    "/api/work/admin/reports/content-followers",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        b = await body(c);
      if (
        typeof b.file !== "string" ||
        b.file.length > 2_800_000 ||
        !/^[A-Za-z0-9+/]+=*$/.test(b.file)
      )
        fail("2MB 이하 XLSX 보고서를 선택해 주세요.");
      const buffer = Buffer.from(b.file, "base64");
      validateWorkbookArchive(buffer);
      const book = new ExcelJS.Workbook();
      try {
        await book.xlsx.load(buffer as any);
      } catch {
        fail("엑셀 파일을 읽을 수 없습니다.");
      }
      if (
        !book.getWorksheet("개별 안내 명단") ||
        !book.getWorksheet("인원·팔로워 요약")
      )
        fail("개별 안내 명단과 인원·팔로워 요약 시트를 포함해 주세요.");
      const path = contentReportPath(),
        temporary = path + "." + randomUUID();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporary, buffer, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      db.prepare(
        "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
      ).run(
        actor.id,
        "content_followers_report",
        JSON.stringify({ bytes: buffer.length }),
        Date.now(),
      );
      return c.json({
        success: true,
        url: "/api/work/admin/reports/content-followers.xlsx",
      });
    }),
  );
  app.get(
    "/api/work/admin/reports/content-followers.xlsx",
    wrap(async (c) => {
      role(c, "admin");
      let file: Buffer;
      try {
        file = await readFile(contentReportPath());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          fail("보고서가 아직 등록되지 않았습니다.", 404);
        throw error;
      }
      return new Response(file as any, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition":
            'attachment; filename="content-links-with-followers.xlsx"',
          "Cache-Control": "no-store",
        },
      });
    }),
  );
  app.post(
    "/api/work/admin/users/:id/reset-password",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        target = id(c),
        b = await body(c);
      const user = db
        .prepare("SELECT id,email,username,role FROM users WHERE id=?")
        .get(target) as any;
      if (!user || !["influencer", "brand"].includes(user.role))
        fail("초기화할 계정을 찾을 수 없습니다.", 404);
      if (b.confirm_email !== user.email)
        fail("초기화할 계정의 이메일을 확인해 주세요.", 409);
      const temporary = text(b.temporary_password, "임시 비밀번호", 4, 128);
      const hash = hashPassword(temporary);
      const revoked = db.transaction(() => {
        db.prepare(
          "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
        ).run(hash, target);
        const sessions = db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(target).changes;
        for (const key of [
          user.email,
          user.username,
          `login:${target}`,
          `account:${target}`,
        ])
          if (key)
            db.prepare("DELETE FROM login_attempts WHERE email=?").run(key);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          actor.id,
          target,
          "password_reset",
          JSON.stringify({
            must_change_password: true,
            sessions_revoked: sessions,
          }),
          Date.now(),
        );
        return sessions;
      })();
      return c.json({
        success: true,
        must_change_password: true,
        sessions_revoked: revoked,
      });
    }),
  );
  app.get(
    "/api/work/admin/users/:id/login-status",
    wrap((c) => {
      role(c, "admin");
      const user = db
        .prepare(
          "SELECT id,email,username,role,must_change_password,password_hash FROM users WHERE id=?",
        )
        .get(id(c)) as any;
      if (!user) fail("계정을 찾을 수 없습니다.", 404);
      const loginKey = user.username ? `login:${user.id}` : user.email;
      const login = db
        .prepare(
          "SELECT failures,locked_until FROM login_attempts WHERE email=?",
        )
        .get(loginKey) as any;
      const account = db
        .prepare(
          "SELECT failures,locked_until FROM login_attempts WHERE email=?",
        )
        .get(`account:${user.id}`) as any;
      const now = Date.now();
      return c.json({
        id: user.id,
        email: user.email,
        role: user.role,
        must_change_password: !!user.must_change_password,
        uses_initial_password: verifyPassword("0000", user.password_hash),
        login_failures: login?.failures || 0,
        login_locked: (login?.locked_until || 0) > now,
        login_locked_until: login?.locked_until || 0,
        retry_after_seconds: Math.max(
          0,
          Math.ceil(((login?.locked_until || 0) - now) / 1000),
        ),
        account_change_failures: account?.failures || 0,
        account_change_locked: (account?.locked_until || 0) > now,
        active_sessions: (
          db
            .prepare(
              "SELECT COUNT(*) n FROM sessions WHERE user_id=? AND expires_at>?",
            )
            .get(user.id, now) as any
        ).n,
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
  app.post(
    "/api/work/admin/users/:id/merge",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        target = id(c),
        b = await body(c);
      const user = db
        .prepare("SELECT email,role FROM users WHERE id=?")
        .get(target) as any;
      if (!user || user.role !== "influencer")
        fail("인플루언서를 찾을 수 없습니다.", 404);
      if (b.confirm_email !== user.email)
        fail("유지할 계정의 이메일을 확인해 주세요.", 409);
      if (
        !Array.isArray(b.source_emails) ||
        b.source_emails.some(
          (email: unknown) => typeof email !== "string" || email.length > 254,
        )
      )
        fail("합칠 계정 이메일을 확인해 주세요.");
      return c.json(
        mergeInfluencers(
          db,
          target,
          b.source_emails,
          actor.id,
          b.dry_run !== false,
        ),
      );
    }),
  );
  app.post(
    "/api/work/admin/influencers/blacklist-delete",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        b = await body(c);
      if (
        !Array.isArray(b.emails) ||
        b.emails.length < 1 ||
        b.emails.length > 100 ||
        b.emails.some(
          (email: unknown) =>
            typeof email !== "string" ||
            !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) ||
            email !== email.toLowerCase(),
        ) ||
        new Set(b.emails).size !== b.emails.length
      )
        fail("중복 없는 인플루언서 이메일을 1~100개 입력해 주세요.");
      const dryRun = b.dry_run !== false;
      if (!dryRun && b.confirm_delete !== true)
        fail("삭제 확인 값이 필요합니다.");
      return c.json(
        db.transaction(() => {
          const accounts = b.emails.map((email: string) => {
            const user = db
              .prepare("SELECT id,name,email,role FROM users WHERE email=?")
              .get(email) as any;
            if (!user) return { email, user: null, applications: [] as any[] };
            if (user.role !== "influencer")
              fail(`인플루언서 계정이 아닙니다: ${email}`, 409);
            const profile = db
              .prepare(
                "SELECT completed_count FROM influencer_profiles WHERE user_id=?",
              )
              .get(user.id) as any;
            const history = db
              .prepare(
                "SELECT 1 FROM historical_activities WHERE user_id=? UNION ALL SELECT 1 FROM activity_certificates WHERE user_id=? LIMIT 1",
              )
              .get(user.id, user.id);
            const applications = db
              .prepare(
                "SELECT id,status,participation_confirmed_at,shipping_address_at,tracking_number FROM applications WHERE influencer_id=?",
              )
              .all(user.id) as any[];
            if (
              profile.completed_count ||
              history ||
              applications.some(
                (a) =>
                  !["applied", "rejected", "selected"].includes(a.status) ||
                  a.participation_confirmed_at ||
                  a.shipping_address_at ||
                  a.tracking_number,
              )
            )
              fail(
                `활동 또는 배송 진행 이력이 있어 삭제할 수 없습니다: ${email}`,
                409,
              );
            if (
              db
                .prepare(
                  "SELECT 1 FROM email_outbox WHERE status='sending' AND application_id IN (SELECT id FROM applications WHERE influencer_id=?) LIMIT 1",
                )
                .get(user.id)
            )
              fail(`메일 발송이 진행 중입니다: ${email}`, 409);
            return { email, user, applications };
          });
          const summary = {
            accounts: accounts.filter((a: any) => a.user).length,
            blocked_emails: b.emails.length,
            applications_removed: accounts.reduce(
              (sum: number, a: any) => sum + a.applications.length,
              0,
            ),
            selected_removed: accounts.reduce(
              (sum: number, a: any) =>
                sum +
                a.applications.filter((app: any) => app.status === "selected")
                  .length,
              0,
            ),
            emails: b.emails,
            deleted: !dryRun,
          };
          if (dryRun) return summary;
          for (const { email, user, applications } of accounts) {
            db.prepare(
              "INSERT OR IGNORE INTO blocked_emails(email,created_at,actor_id) VALUES(?,?,?)",
            ).run(email, Date.now(), actor.id);
            if (!user) continue;
            for (const application of applications) {
              db.prepare(
                "DELETE FROM email_attempts WHERE email_id IN (SELECT id FROM email_outbox WHERE application_id=?)",
              ).run(application.id);
              db.prepare("DELETE FROM email_outbox WHERE application_id=?").run(
                application.id,
              );
              db.prepare(
                "DELETE FROM application_events WHERE application_id=?",
              ).run(application.id);
            }
            db.prepare("DELETE FROM applications WHERE influencer_id=?").run(
              user.id,
            );
            db.prepare("DELETE FROM notifications WHERE user_id=?").run(
              user.id,
            );
            db.prepare(
              "DELETE FROM onboarding_submissions WHERE user_id=?",
            ).run(user.id);
            db.prepare(
              "UPDATE onboarding_submissions SET reviewer_id=NULL WHERE reviewer_id=?",
            ).run(user.id);
            db.prepare(
              "UPDATE application_events SET actor_id=NULL WHERE actor_id=?",
            ).run(user.id);
            db.prepare(
              "UPDATE admin_audit SET target_user_id=NULL WHERE target_user_id=?",
            ).run(user.id);
            db.prepare("DELETE FROM login_attempts WHERE email IN (?,?)").run(
              user.email,
              `login:${user.id}`,
            );
            db.prepare("DELETE FROM users WHERE id=?").run(user.id);
          }
          db.prepare(
            "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'blacklist_delete',?,?)",
          ).run(actor.id, JSON.stringify(summary), Date.now());
          return summary;
        })(),
      );
    }),
  );
  app.post(
    "/api/work/admin/influencers/unblock-email",
    wrap(async (c) => {
      const actor = role(c, "admin"), b = await body(c);
      const email = text(b.email, "이메일", 3, 254).toLowerCase();
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))
        fail("올바른 이메일 주소를 입력해 주세요.");
      const removed = db.transaction(() => {
        const result = db.prepare("DELETE FROM blocked_emails WHERE email=?").run(email);
        db.prepare("INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'email_unblock',?,?)")
          .run(actor.id, JSON.stringify({ email, removed: result.changes }), Date.now());
        return result.changes;
      })();
      return c.json({ email, unblocked: removed > 0 });
    }),
  );
  app.delete(
    "/api/work/admin/users/:id",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        target = id(c),
        b = await body(c);
      db.transaction(() => {
        const user = db
          .prepare("SELECT id,name,email,role FROM users WHERE id=?")
          .get(target) as any;
        if (!user || user.role !== "influencer")
          fail("인플루언서를 찾을 수 없습니다.", 404);
        if (b.confirm_email !== user.email || b.confirm_name !== user.name)
          fail("삭제할 계정의 이름과 이메일을 확인해 주세요.", 409);
        const profile = db
          .prepare(
            "SELECT completed_count FROM influencer_profiles WHERE user_id=?",
          )
          .get(target) as any;
        const hasActivities = db
          .prepare(
            "SELECT 1 FROM historical_activities WHERE user_id=? UNION ALL SELECT 1 FROM activity_certificates WHERE user_id=? LIMIT 1",
          )
          .get(target, target);
        const progressed = db
          .prepare(
            "SELECT 1 FROM applications WHERE influencer_id=? AND status NOT IN ('applied','rejected') LIMIT 1",
          )
          .get(target);
        if (profile.completed_count || hasActivities || progressed)
          fail("선정 또는 활동 이력이 있는 계정은 삭제할 수 없습니다.", 409);
        const applicationIds = (
          db
            .prepare("SELECT id FROM applications WHERE influencer_id=?")
            .all(target) as { id: number }[]
        ).map((a) => a.id);
        for (const applicationId of applicationIds) {
          db.prepare(
            "DELETE FROM email_attempts WHERE email_id IN (SELECT id FROM email_outbox WHERE application_id=?)",
          ).run(applicationId);
          db.prepare("DELETE FROM email_outbox WHERE application_id=?").run(
            applicationId,
          );
          db.prepare(
            "DELETE FROM application_events WHERE application_id=?",
          ).run(applicationId);
        }
        db.prepare("DELETE FROM applications WHERE influencer_id=?").run(
          target,
        );
        db.prepare("DELETE FROM notifications WHERE user_id=?").run(target);
        db.prepare("DELETE FROM onboarding_submissions WHERE user_id=?").run(
          target,
        );
        db.prepare(
          "UPDATE onboarding_submissions SET reviewer_id=NULL WHERE reviewer_id=?",
        ).run(target);
        db.prepare(
          "UPDATE application_events SET actor_id=NULL WHERE actor_id=?",
        ).run(target);
        db.prepare(
          "UPDATE admin_audit SET target_user_id=NULL WHERE target_user_id=?",
        ).run(target);
        db.prepare("DELETE FROM login_attempts WHERE email IN (?,?)").run(
          user.email,
          `login:${target}`,
        );
        db.prepare("DELETE FROM users WHERE id=?").run(target);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
        ).run(
          actor.id,
          "influencer_delete",
          JSON.stringify({
            user_id: target,
            name: user.name,
            applications_removed: applicationIds.length,
          }),
          Date.now(),
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.put(
    "/api/work/admin/users/:id/email",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        target = id(c),
        b = await body(c);
      db.transaction(() => {
        const user = db
          .prepare("SELECT id,email,role FROM users WHERE id=?")
          .get(target) as any;
        if (!user || user.role !== "influencer")
          fail("인플루언서를 찾을 수 없습니다.", 404);
        if (b.confirm_email !== user.email)
          fail("변경 전 이메일을 확인해 주세요.", 409);
        const email = text(b.email, "이메일", 3, 254).toLowerCase();
        if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))
          fail("이메일 형식을 확인해 주세요.");
        if (
          db
            .prepare(
              "SELECT id FROM users WHERE (email=? OR username=?) AND id!=?",
            )
            .get(email, email, target)
        )
          fail("이미 사용 중인 이메일입니다.", 409);
        if (email === user.email) return;
        db.prepare("UPDATE users SET email=? WHERE id=?").run(email, target);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(target);
        db.prepare("DELETE FROM login_attempts WHERE email IN (?,?,?)").run(
          user.email,
          email,
          `login:${target}`,
        );
        db.prepare(
          "UPDATE email_outbox SET recipient=? WHERE application_id IN (SELECT id FROM applications WHERE influencer_id=?) AND status IN ('pending','failed')",
        ).run(email, target);
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          actor.id,
          target,
          "account_email",
          JSON.stringify({ previous_email: user.email, email }),
          Date.now(),
        );
      })();
      return c.json({ success: true });
    }),
  );
  app.put(
    "/api/work/admin/users/:id/profile",
    wrap(async (c) => {
      const actor = role(c, "admin"),
        target = id(c),
        b = await body(c);
      db.transaction(() => {
        const user = db
          .prepare("SELECT id,name,role FROM users WHERE id=?")
          .get(target) as any;
        if (!user || user.role !== "influencer")
          fail("인플루언서를 찾을 수 없습니다.", 404);
        const profile = db
          .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
          .get(target) as any;
        const name = text(b.name ?? user.name, "이름", 2, 60);
        const phone = text(b.phone ?? profile.phone, "연락처", 0, 30);
        const social = text(
          b.social_url ?? profile.social_url,
          "SNS 프로필 URL",
          0,
          500,
        );
        const followers = integer(
          b.followers ?? profile.followers,
          "팔로워 수",
          0,
          100_000_000,
        );
        if (phone && !/^[+0-9 ()-]{8,30}$/.test(phone))
          fail("연락처 형식을 확인해 주세요.");
        if (social && !socialProfileUrl(social))
          fail("올바른 HTTP/HTTPS SNS 프로필 링크를 입력해 주세요.");
        const nationality =
          b.nationality === undefined
            ? profile.nationality
            : nationalityValue(b.nationality);
        const reviewed = profileComplete({
          ...profile,
          phone,
          social_url: social,
          followers,
          import_review_required: 0,
        });
        db.prepare("UPDATE users SET name=?,phone=? WHERE id=?").run(
          name,
          phone,
          target,
        );
        db.prepare(
          "UPDATE influencer_profiles SET phone=?,social_url=?,followers=?,nationality=?,import_review_required=? WHERE user_id=?",
        ).run(
          phone,
          social,
          followers,
          nationality,
          reviewed &&
            ["phone", "social_url", "followers"].some((field) =>
              Object.hasOwn(b, field),
            )
            ? 0
            : profile.import_review_required,
          target,
        );
        db.prepare(
          "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
        ).run(
          actor.id,
          target,
          "profile_edit",
          JSON.stringify({
            fields: [
              "name",
              "phone",
              "social_url",
              "followers",
              "nationality",
            ].filter((field) => Object.hasOwn(b, field)),
          }),
          Date.now(),
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
        history: historicalActivities(db, id(c)),
        certificate: certificateSummary(db, id(c)),
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
          "SELECT a.id AS application_id,u.name,a.phone,a.address,a.carrier,a.tracking_number,a.recipient_name,a.postal_code,a.address_detail FROM applications a JOIN users u ON u.id=a.influencer_id WHERE a.campaign_id=? AND a.status IN ('selected','shipping','final_submitted') AND a.address!='' AND (a.status='shipping' OR a.participation_confirmed_at>0) ORDER BY a.id",
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
          `SELECT a.id,u.name,a.status,a.draft_url,a.final_url,
            COALESCE((SELECT group_concat(url, char(10)) FROM application_content_links WHERE application_id=a.id),a.final_url) AS all_final_urls,
            a.best,a.views,p.tier,p.completed_count,p.onboarding_approved,a.consent_version FROM applications a JOIN users u ON u.id=a.influencer_id JOIN influencer_profiles p ON p.user_id=u.id WHERE a.campaign_id=? ORDER BY a.id`,
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
        { header: "전체 SNS URL", key: "all_final_urls", width: 60 },
        { header: "Best", key: "best", width: 10 },
        { header: "확인 조회수", key: "views", width: 15 },
        { header: "등급", key: "tier", width: 15 },
        { header: "동의 버전", key: "consent_version", width: 25 },
      ];
      sheet.addRows(
        rows.map((row: any) => ({
          ...row,
          tier: tierLabel(
            row.tier,
            row.completed_count,
            row.onboarding_approved,
          ),
        })),
      );
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
          !["selected", "shipping", "final_submitted"].includes(a.status)
        )
          fail(`${i}행: 해당 캠페인의 선정/배송 단계가 아닙니다.`);
        if (
          a.consent_version.startsWith("external-form-v2") &&
          (!a.secondary_use_consent || !a.original_delivery_consent)
        )
          fail(`${i}행: 발송 전에 필수 동의가 필요합니다.`, 409);
        if (!a.address || !a.phone)
          fail(`${i}행: 선정자의 배송지가 아직 등록되지 않았습니다.`);
        if (a.status === "selected" && !a.participation_confirmed_at)
          fail(`${i}행: 인플루언서의 캠페인 참여 확인이 필요합니다.`, 409);
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
            "UPDATE applications SET status=CASE WHEN status='final_submitted' THEN status ELSE 'shipping' END,carrier=?,tracking_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          ).run(carrier, tracking, a.id);
          event(db, a, u.id, a.status === "final_submitted" ? "final_submitted" : "shipping", `${carrier} · ${tracking}`);
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
