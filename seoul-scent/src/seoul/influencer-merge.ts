import { type DB, fail, recalculateTier } from "./workflow.js";
import { profileComplete } from "./profile.js";

export function mergeInfluencers(
  db: DB,
  targetId: number,
  sourceEmails: string[],
  actorId: number,
  dryRun = true,
) {
  return db.transaction(() => {
    const target = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(targetId) as any;
    if (!target || target.role !== "influencer")
      fail("인플루언서를 찾을 수 없습니다.", 404);
    if (
      !sourceEmails.length ||
      sourceEmails.length > 10 ||
      new Set(sourceEmails).size !== sourceEmails.length
    )
      fail("합칠 계정 이메일을 중복 없이 1~10개 지정해 주세요.");
    const sources = sourceEmails.map((email) => {
      const user = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(email) as any;
      if (!user || user.role !== "influencer" || user.id === targetId)
        fail("합칠 인플루언서 계정을 확인해 주세요.", 409);
      return user;
    });
    const ids = [targetId, ...sources.map((u) => u.id)];
    const marks = ids.map(() => "?").join(",");
    const applications = db
      .prepare(`SELECT * FROM applications WHERE influencer_id IN (${marks})`)
      .all(...ids) as any[];
    if (
      new Set(applications.map((a) => a.campaign_id)).size !==
      applications.length
    )
      fail(
        "같은 캠페인에 중복 신청한 계정은 신청 이력을 먼저 정리해 주세요.",
        409,
      );
    const sourceIds = sources.map((s) => s.id);
    if (
      db
        .prepare(
          `SELECT e.id FROM email_outbox e JOIN applications a ON a.id=e.application_id
      WHERE e.status='sending' AND a.influencer_id IN (${sourceIds.map(() => "?").join(",")}) LIMIT 1`,
        )
        .get(...sourceIds)
    )
      fail("메일 발송이 진행 중입니다. 발송 완료 후 계정을 합쳐 주세요.", 409);
    const certificates = db
      .prepare(
        `SELECT * FROM activity_certificates WHERE user_id IN (${marks})`,
      )
      .all(...ids) as any[];
    if (
      new Set(certificates.map((c) => c.completed_count)).size !==
      certificates.length
    )
      fail("중복 활동증명서가 있어 계정을 합칠 수 없습니다.", 409);
    if (
      db
        .prepare(
          `SELECT id FROM campaigns WHERE brand_id IN (${marks}) LIMIT 1`,
        )
        .get(...ids)
    )
      fail("브랜드 캠페인을 소유한 계정은 합칠 수 없습니다.", 409);
    const history = db
      .prepare(
        `SELECT * FROM historical_activities WHERE user_id IN (${marks}) ORDER BY imported_at,id`,
      )
      .all(...ids) as any[];
    const completed =
      new Set(history.map((h) => h.project_key)).size +
      applications.filter((a) => a.status === "completed").length;
    const summary = {
      target_id: targetId,
      target_email: target.email,
      source_ids: sources.map((s) => s.id),
      source_emails: sourceEmails,
      completed_count: completed,
      applications: applications.length,
      historical_projects: new Set(history.map((h) => h.project_key)).size,
      removed_accounts: dryRun ? 0 : sources.length,
    };
    if (dryRun) return summary;

    const profiles = ids.map(
      (id) =>
        db
          .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
          .get(id) as any,
    );
    const primary = profiles[0];
    const phone = primary.phone || profiles.find((p) => p.phone)?.phone || "";
    db.prepare("UPDATE users SET phone=? WHERE id=?").run(phone, targetId);
    db.prepare(
      `UPDATE influencer_profiles SET phone=?,address=?,social_url=?,followers=?,
      completed_count=?,total_views=?,no_show_count=?,blocked_until=?,blacklisted=?,onboarding_approved=? WHERE user_id=?`,
    ).run(
      phone,
      primary.address || profiles.find((p) => p.address)?.address || "",
      primary.social_url ||
        profiles.find((p) => p.social_url)?.social_url ||
        "",
      Math.max(...profiles.map((p) => p.followers)),
      completed,
      profiles.reduce((n, p) => n + p.total_views, 0),
      profiles.reduce((n, p) => n + p.no_show_count, 0),
      Math.max(...profiles.map((p) => p.blocked_until)),
      Math.max(...profiles.map((p) => p.blacklisted)),
      Math.max(...profiles.map((p) => p.onboarding_approved)),
      targetId,
    );
    db.prepare(
      "UPDATE influencer_profiles SET nationality=? WHERE user_id=?",
    ).run(
      primary.nationality ||
        profiles.find((p) => p.nationality)?.nationality ||
        "",
      targetId,
    );
    const mergedProfile = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=?")
      .get(targetId) as any;
    if (profileComplete({ ...mergedProfile, import_review_required: 0 }))
      db.prepare(
        "UPDATE influencer_profiles SET import_review_required=0 WHERE user_id=?",
      ).run(targetId);
    for (const source of sources) {
      for (const row of history.filter((h) => h.user_id === source.id)) {
        const existing = db
          .prepare(
            "SELECT * FROM historical_activities WHERE user_id=? AND project_key=?",
          )
          .get(targetId, row.project_key) as any;
        if (existing) {
          const links = [
            ...new Set([
              ...JSON.parse(existing.content_links),
              ...JSON.parse(row.content_links),
            ]),
          ];
          db.prepare(
            "UPDATE historical_activities SET content_links=? WHERE id=?",
          ).run(JSON.stringify(links), existing.id);
          db.prepare("DELETE FROM historical_activities WHERE id=?").run(
            row.id,
          );
        } else
          db.prepare(
            "UPDATE historical_activities SET user_id=? WHERE id=?",
          ).run(targetId, row.id);
      }
      db.prepare(
        `UPDATE email_outbox SET recipient=? WHERE application_id IN
        (SELECT id FROM applications WHERE influencer_id=?) AND status IN ('pending','failed')`,
      ).run(target.email, source.id);
      db.prepare(
        "UPDATE applications SET influencer_id=? WHERE influencer_id=?",
      ).run(targetId, source.id);
      db.prepare(
        "UPDATE activity_certificates SET user_id=? WHERE user_id=?",
      ).run(targetId, source.id);
      for (const [table, columns] of [
        ["notifications", ["user_id"]],
        ["application_events", ["actor_id"]],
        ["admin_audit", ["actor_id", "target_user_id"]],
        ["onboarding_submissions", ["user_id", "reviewer_id"]],
      ] as const)
        for (const column of columns)
          db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(
            targetId,
            source.id,
          );
      db.prepare("DELETE FROM login_attempts WHERE email IN (?,?)").run(
        source.email,
        `login:${source.id}`,
      );
      db.prepare("DELETE FROM users WHERE id=?").run(source.id);
    }
    // Revoke all pre-merge sessions while keeping the canonical password and login identity.
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(targetId);
    db.prepare("DELETE FROM login_attempts WHERE email IN (?,?)").run(
      target.email,
      `login:${targetId}`,
    );
    recalculateTier(db, targetId);
    if ((db.pragma("foreign_key_check") as any[]).length)
      fail("계정 연결 검사에 실패했습니다.", 409);
    db.prepare(
      "INSERT INTO admin_audit(actor_id,target_user_id,action,note,created_at) VALUES(?,?,?,?,?)",
    ).run(
      actorId,
      targetId,
      "influencer_merge",
      JSON.stringify(summary),
      Date.now(),
    );
    return summary;
  })();
}
