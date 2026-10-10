import { randomUUID } from "node:crypto";
import type { User } from "./db.js";
import { fail, type DB } from "./workflow.js";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function completedActivities(db: DB, user: number) {
  return db
    .prepare(
      `SELECT c.title,c.title_en,a.updated_at FROM applications a JOIN campaigns c ON c.id=a.campaign_id
    WHERE a.influencer_id=? AND a.status='completed' ORDER BY a.id`,
    )
    .all(user) as any[];
}
export function issueCertificate(db: DB, user: User) {
  return db.transaction(() => {
    const activities = completedActivities(db, user.id);
    if (!activities.length)
      fail("캠페인을 1개 이상 완료한 후 활동증명서를 발급할 수 있습니다.", 409);
    const previous = db
      .prepare(
        "SELECT * FROM activity_certificates WHERE user_id=? AND completed_count=?",
      )
      .get(user.id, activities.length) as any;
    if (previous) return previous;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO activity_certificates(id,user_id,name,completed_count,activities,issued_at) VALUES(?,?,?,?,?,?)",
    ).run(
      id,
      user.id,
      user.name,
      activities.length,
      JSON.stringify(activities),
      Date.now(),
    );
    return db
      .prepare("SELECT * FROM activity_certificates WHERE id=?")
      .get(id) as any;
  })();
}
export function certificatePage(c: any) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(c.issued_at));
  const activities = JSON.parse(c.activities) as any[];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seoul Scent · 활동증명서</title><link rel="stylesheet" href="/assets/certificate.css"><script src="/assets/certificate.js" defer></script></head><body>
    <nav><button id="certificate-print">인쇄 / PDF 저장 · Print / Save PDF</button><a href="/profile">내 프로필 · My profile</a></nav>
    <main><header><p>SEOUL SCENT · YGSC</p><h1>활동증명서</h1><h2>Certificate of Participation</h2></header>
    <p class="name">${escape(c.name)}</p><p>위 사람은 서울센트에서 아래 캠페인 활동을 완료하였음을 증명합니다.</p>
    <p>This certifies that the above participant has completed the following campaigns through Seoul Scent.</p>
    <p class="count">완료 캠페인 / Completed campaigns: <strong>${c.completed_count}</strong></p>
    <ol>${activities.map((a) => `<li>${escape(a.title)}${a.title_en ? `<br><span>${escape(a.title_en)}</span>` : ""}</li>`).join("")}</ol>
    <footer><p>발급일 / Issued: ${date} (KST)</p><p>증명서 번호 / Certificate ID: ${escape(c.id)}</p><strong>YGSC · Seoul Scent</strong></footer></main></body></html>`;
}
