import type { User } from "./db.js";
import {
  type DB,
  fail,
  integer,
  campaignFor,
  applicationFor,
  event,
  notify,
} from "./workflow.js";
import { queueSelectionEmail } from "./email.js";
export function finalizeSelection(
  db: DB,
  user: User,
  campaignId: number,
  value: unknown,
) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500)
    fail("선정할 지원자를 1~500명 선택해 주세요.");
  const ids = (value as unknown[]).map((v) => integer(v, "지원 ID", 1));
  if (new Set(ids).size !== ids.length)
    fail("같은 지원자를 중복 선택할 수 없습니다.");
  return db.transaction(() => {
    const campaign = campaignFor(db, campaignId, user, true);
    if (
      (campaign.is_draft && !campaign.import_key) ||
      campaign.status === "completed" ||
      (!campaign.is_draft &&
        Date.now() >=
          (campaign.review_required ? campaign.draft_due : campaign.final_due))
    )
      fail("선정 가능한 캠페인 기간이 아닙니다.", 409);
    const applicants = ids.map((id) => applicationFor(db, id, user));
    for (const a of applicants) {
      if (a.campaign_id !== campaignId || a.status !== "applied")
        fail("이 캠페인의 미선정 지원자만 선택할 수 있습니다.", 409);
      const p = db
        .prepare(
          "SELECT blacklisted,blocked_until FROM influencer_profiles WHERE user_id=?",
        )
        .get(a.influencer_id) as any;
      if (p.blacklisted || p.blocked_until > Date.now())
        fail("선택한 지원자 중 현재 제재 중인 인플루언서가 있습니다.", 409);
    }
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) n FROM applications WHERE campaign_id=? AND status NOT IN ('applied','rejected')",
        )
        .get(campaignId) as any
    ).n;
    if (count + ids.length > campaign.capacity)
      fail("남은 모집 인원보다 많이 선택했습니다.", 409);
    const note =
      "캠페인 참여자로 선정되었습니다. 참여 내역에서 필수 동의를 확인하고 배송지를 등록해 주세요.";
    for (const a of applicants) {
      db.prepare(
        "UPDATE applications SET status='selected',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(a.id);
      event(db, a, user.id, "selected", note);
      notify(
        db,
        a.influencer_id,
        `${a.title}: ${note}`,
        `/applications/${a.id}`,
      );
      queueSelectionEmail(db, a.id);
    }
    return { selected: ids.length };
  })();
}
