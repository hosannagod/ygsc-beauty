import type { openDb, User } from "./db.js";
export type DB = ReturnType<typeof openDb>;
export class WorkflowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const fail = (message: string, status = 400): never => {
  throw new WorkflowError(message, status);
};
export const text = (value: unknown, label: string, min = 1, max = 2000) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(`${label}: ${min}~${max}자로 입력해 주세요.`);
  return (value as string).trim();
};
export const integer = (
  value: unknown,
  label: string,
  min = 0,
  max = 1_000_000_000,
) => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${label} 값을 확인해 주세요.`);
  return value as number;
};
export function deadline(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("마감일은 날짜 형식으로 입력해 주세요.");
  const date = new Date(value as string);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    fail("유효하지 않은 날짜입니다.");
  return date.getTime() + 15 * 3600_000; // next day 00:00 Asia/Seoul
}
export function productLink(value: unknown) {
  const raw =
    value === undefined ? "" : text(value, "제품·브랜드 링크", 0, 2000);
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("제품·브랜드 링크는 올바른 웹 주소를 입력해 주세요.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    fail(
      "제품·브랜드 링크는 인증 정보가 없는 HTTP 또는 HTTPS 주소를 입력해 주세요.",
    );
  return url.href;
}
export function recruitmentDates(
  startDate: unknown,
  endDate: unknown,
  draftDue: number,
  now = Date.now(),
) {
  const start = deadline(startDate) - 86400_000,
    end = deadline(endDate);
  if (start >= end || end <= now || end >= draftDue)
    fail(
      "모집 시작일 ≤ 모집 마감일 < 초안 마감일 순서로 입력해 주세요. 모집 마감일은 아직 지나지 않아야 합니다.",
    );
  return { start, end };
}
export function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function externalLink(value: unknown, draft: boolean) {
  const raw = text(value, "제출 링크", 1, 2000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("올바른 링크를 입력해 주세요.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    fail("인증 정보가 없는 HTTPS 링크를 입력해 주세요.");
  if (draft) {
    if (
      url.hostname !== "drive.google.com" ||
      (!/^\/file\/d\/[^/]+(?:\/view)?\/?$/.test(url.pathname) &&
        !(url.pathname === "/open" && url.searchParams.get("id")))
    )
      fail("Google Drive 파일 공유 링크를 입력해 주세요.");
  } else {
    const host = url.hostname.replace(/^www\./, "");
    const paths: Record<string, RegExp> = {
      "instagram.com": /^\/(p|reel|tv)\/[^/]+/,
      "youtube.com": /^\/(watch|shorts\/[^/]+)/,
      "youtu.be": /^\/[^/]+/,
      "tiktok.com": /^\/@[^/]+\/video\/\d+/,
      "facebook.com": /^\/.+/,
      "x.com": /^\/[^/]+\/status\/\d+/,
    };
    if (
      !paths[host]?.test(url.pathname) ||
      (host === "youtube.com" &&
        url.pathname === "/watch" &&
        !url.searchParams.get("v"))
    )
      fail(
        "Instagram, YouTube, TikTok, Facebook 또는 X의 게시물 링크를 입력해 주세요.",
      );
  }
  return url.href;
}
export function notify(
  db: DB,
  user: number,
  message: string,
  path: string,
  key: string | null = null,
  now = Date.now(),
) {
  db.prepare(
    "INSERT OR IGNORE INTO notifications(user_id,message,path,event_key,created_at) VALUES(?,?,?,?,?)",
  ).run(user, message, path, key, now);
}
export function event(
  db: DB,
  application: any,
  actor: number | null,
  status: string,
  note = "",
  link = "",
  now = Date.now(),
) {
  db.prepare(
    "INSERT INTO application_events(application_id,actor_id,status,note,link,created_at) VALUES(?,?,?,?,?,?)",
  ).run(application.id, actor, status, note, link, now);
}
export function applicationFor(db: DB, id: number, user: User) {
  const row = db
    .prepare(
      `SELECT a.*, c.brand_id,c.title,c.draft_due,c.final_due,c.draft_date,c.final_date,c.capacity,c.status AS campaign_status,
    u.name AS influencer_name,u.email AS influencer_email,p.followers,p.tier,p.social_url
    FROM applications a JOIN campaigns c ON c.id=a.campaign_id JOIN users u ON u.id=a.influencer_id
    JOIN influencer_profiles p ON p.user_id=a.influencer_id WHERE a.id=?`,
    )
    .get(id) as any;
  if (!row) fail("지원 내역을 찾을 수 없습니다.", 404);
  if (
    user.role !== "admin" &&
    !(user.role === "brand" && row.brand_id === user.id) &&
    !(user.role === "influencer" && row.influencer_id === user.id)
  )
    fail("접근 권한이 없습니다.", 403);
  return row;
}
export function campaignFor(db: DB, id: number, user: User, manage = false) {
  const row = db
    .prepare(
      "SELECT c.*, u.name AS brand_name FROM campaigns c JOIN users u ON u.id=c.brand_id WHERE c.id=?",
    )
    .get(id) as any;
  if (!row) fail("캠페인을 찾을 수 없습니다.", 404);
  if (
    manage &&
    user.role !== "admin" &&
    !(user.role === "brand" && row.brand_id === user.id)
  )
    fail("접근 권한이 없습니다.", 403);
  if (!manage && user.role === "brand" && row.brand_id !== user.id)
    fail("접근 권한이 없습니다.", 403);
  return row;
}
export function recalculateTier(db: DB, user: number) {
  const p = db
    .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
    .get(user) as any;
  const rules = db
    .prepare("SELECT * FROM workflow_settings WHERE id=1")
    .get() as any;
  let tier = 0;
  for (let n = 2; n <= 4; n++)
    if (
      p.completed_count >= rules[`tier${n}_count`] &&
      p.total_views >= rules[`tier${n}_views`]
    )
      tier = n - 1;
  db.prepare("UPDATE influencer_profiles SET tier=? WHERE user_id=?").run(
    Math.max(0, tier - p.no_show_count * rules.demotion),
    user,
  );
}
export function sweepDeadlines(db: DB, now = Date.now()) {
  return db.transaction(() => {
    const rules = db
      .prepare("SELECT * FROM workflow_settings WHERE id=1")
      .get() as any;
    const rows = db
      .prepare(
        `SELECT a.*,c.title,c.brand_id,c.draft_due,c.final_due FROM applications a JOIN campaigns c ON c.id=a.campaign_id
      WHERE c.status!='completed' AND a.status IN ('selected','shipping','revision_requested','draft_approved')`,
      )
      .all() as any[];
    let penalized = 0;
    for (const a of rows) {
      const due =
        a.status === "draft_approved"
          ? a.final_due
          : a.status === "revision_requested" && a.revision_due
            ? a.revision_due
            : a.draft_due;
      if (now < due) {
        if (due - now <= 24 * 3600_000)
          notify(
            db,
            a.influencer_id,
            `${a.title}: 제출 마감이 하루 이내입니다.`,
            `/applications/${a.id}`,
            `reminder:${a.id}:${due}`,
            now,
          );
        continue;
      }
      db.prepare(
        "UPDATE applications SET status='no_show',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(a.id);
      db.prepare(
        `UPDATE influencer_profiles SET no_show_count=no_show_count+1, tier=MAX(0,tier-?),
        blocked_until=MAX(blocked_until,?), blacklisted=CASE WHEN no_show_count+1>=? THEN 1 ELSE blacklisted END WHERE user_id=?`,
      ).run(
        rules.demotion,
        due + rules.penalty_days * 86400_000,
        rules.blacklist_after,
        a.influencer_id,
      );
      event(
        db,
        a,
        null,
        "no_show",
        "제출 마감일 경과로 자동 노쇼 처리",
        "",
        now,
      );
      notify(
        db,
        a.influencer_id,
        `${a.title}: 미제출로 노쇼 처리되었습니다. 신규 지원이 제한됩니다.`,
        `/applications/${a.id}`,
        `no-show:${a.id}`,
        now,
      );
      notify(
        db,
        a.brand_id,
        `${a.title}: 노쇼가 발생했습니다.`,
        `/campaigns/${a.campaign_id}`,
        `brand-no-show:${a.id}`,
        now,
      );
      penalized++;
    }
    db.prepare(
      "UPDATE campaigns SET status='closed' WHERE status='recruiting' AND recruit_due<=?",
    ).run(now);
    return { penalized };
  })();
}
