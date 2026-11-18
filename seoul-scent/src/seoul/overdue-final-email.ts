import type { openDb } from "./db.js";

type DB = ReturnType<typeof openDb>;
export const overdueFinalAt = Date.parse("2026-11-19T09:00:00+09:00");
export const overdueFinalPrefix = "overdue-final-2026-11-19:";
export const overdueFinalSubject = "[Seoul Scent] 최종 콘텐츠 링크 제출 확인 / Final upload reminder";

export type OverdueFinalRow = {
  id: number;
  influencer_id: number;
  email: string;
  name: string;
  campaign_id: number;
  title: string;
  title_en: string;
  final_date: string;
};

export function overdueFinalRows(db: DB, userId?: number): OverdueFinalRow[] {
  return (db.prepare(`SELECT a.id,a.influencer_id,u.email,u.name,c.id AS campaign_id,c.title,c.title_en,c.final_date
    FROM applications a JOIN campaigns c ON c.id=a.campaign_id JOIN users u ON u.id=a.influencer_id
    WHERE c.deleted_at=0 AND c.is_draft=0 AND c.status!='completed' AND c.final_due<=?
      AND a.status IN ('selected','shipping','draft_submitted','revision_requested','draft_approved')
      AND a.participation_confirmed_at>0 AND a.final_url=''
      AND u.suspended_at=0 AND (u.username IS NULL OR u.email!=u.username)
      AND NOT EXISTS (SELECT 1 FROM blocked_emails WHERE email=lower(u.email))
      AND (? IS NULL OR a.influencer_id=?)
    ORDER BY c.id,a.id`).all(overdueFinalAt, userId ?? null, userId ?? null) as OverdueFinalRow[])
    .filter(a => /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(a.email));
}

export function overdueFinalBody(rows: OverdueFinalRow[]): string {
  const name = rows[0].name;
  const ko = rows.map(a => `- ${a.title} (최종 마감 ${a.final_date})\n  https://seoul-scent.onrender.com/applications/${a.id}`).join("\n");
  const en = rows.map(a => `- ${a.title_en || a.title} (final deadline ${a.final_date})\n  https://seoul-scent.onrender.com/applications/${a.id}`).join("\n");
  return `안녕하세요, ${name}님.

아래 캠페인의 최종 마감일이 지났지만 서울센트에 SNS 게시물 링크가 아직 확인되지 않습니다. 이미 게시하셨다면 각 참여 내역에서 링크를 제출해 주세요.
${ko}

제품을 아직 받지 못했거나 일정 연장이 필요하다면 이 메일에 회신해 주세요.
서울센트 팀 드림

--------------------

Hello ${name},

We have not received the final social post links for the campaigns below. If you have already posted, please submit each link in My Campaigns.
${en}

If your product has not arrived or you need more time, please reply to this email.
The Seoul Scent Team`;
}
