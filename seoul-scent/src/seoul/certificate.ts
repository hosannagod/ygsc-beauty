import { randomUUID } from "node:crypto";
import type { User } from "./db.js";
import { fail, type DB } from "./workflow.js";
import { historicalActivities } from "./activity-import.js";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function completedActivities(db: DB, user: number) {
  return [
    ...(db
      .prepare(
        `SELECT c.title,c.title_en,a.updated_at FROM applications a JOIN campaigns c ON c.id=a.campaign_id
    WHERE a.influencer_id=? AND a.status='completed' ORDER BY a.id`,
      )
      .all(user) as any[]),
    ...historicalActivities(db, user).map((a) => ({
      title: a.title,
      title_en: "",
      updated_at: a.submitted_at,
    })),
  ];
}
export function certificateSummary(db: DB, user: number) {
  const activities = completedActivities(db, user);
  const certificate = activities.length
    ? (db
        .prepare(
          "SELECT id,issued_at FROM activity_certificates WHERE user_id=? AND completed_count=?",
        )
        .get(user, activities.length) as
        { id: string; issued_at: number } | undefined)
    : undefined;
  return {
    eligible: activities.length > 0,
    completed_count: activities.length,
    activities,
    certificate_url: certificate ? `/certificates/${certificate.id}` : null,
    issued_at: certificate?.issued_at ?? null,
  };
}
export function issueCertificate(db: DB, user: User) {
  return db.transaction(() => {
    const activities = completedActivities(db, user.id);
    if (!activities.length)
      fail("캠페인을 1개 이상 완료한 후 수료증을 발급할 수 있습니다.", 409);
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
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seoul Scent · ${escape(c.name)} · 수료증</title><link rel="stylesheet" href="/assets/certificate.css"><script src="/assets/certificate.js" defer></script></head><body>
    <nav class="actions"><div><strong>SEOUL SCENT</strong><span>수료증 미리보기 · Certificate preview</span></div><button id="certificate-print" type="button">PDF 저장 / 인쇄 · Save PDF / Print</button><a href="/profile">돌아가기</a></nav>
    <main class="certificate"><div class="certificate-inner">
      <header class="certificate-header"><div class="brand-mark">S<span>✦</span>S</div><p class="eyebrow">SEOUL SCENT <span>·</span> YGSC</p><p class="series">CREATOR PARTNERSHIPS</p><div class="rule"></div><p class="kind">CERTIFICATE OF COMPLETION</p><h1>수료증</h1><h2>Certificate of Completion</h2></header>
      <section class="recipient"><p class="label">AWARDED TO · 수료자</p><p class="name">${escape(c.name)}</p><p class="statement">위 앰버서더는 Seoul Scent (YGSC)의 캠페인에 참여하여<br>콘텐츠 업로드를 완료하였기에 이 수료증을 수여합니다.</p><p class="statement-en">This certifies that the ambassador has completed the content activities<br>for the Seoul Scent (YGSC) campaigns listed below.</p></section>
      <section class="activities"><div class="activities-heading"><h3>완료한 캠페인 <span>Completed campaigns</span></h3><strong>${activities.length.toLocaleString("ko-KR")} PROJECT${activities.length === 1 ? "" : "S"}</strong></div><ol>${activities.map((a) => `<li><span class="number"></span><span class="project">${escape(a.title)}${a.title_en ? `<small>${escape(a.title_en)}</small>` : ""}</span></li>`).join("")}</ol></section>
      <footer class="certificate-footer"><div class="issue"><span>ISSUED ON · 발급일</span><strong>${escape(date)} <small>KST</small></strong><span class="serial">CERTIFICATE NO. ${escape(c.id)}</span></div><div class="issuer"><span>SEOUL SCENT (YGSC)</span><div class="signature" aria-label="Kim Eunchong">Kim Eunchong</div><div class="issuer-name"><strong>대표 김은총</strong><span>Kim Eunchong · Representative</span><span class="seal" aria-hidden="true">YGSC</span></div></div></footer>
    </div></main><p class="print-hint">인쇄 화면에서 “PDF로 저장”을 선택하면 파일을 다운로드할 수 있습니다.</p></body></html>`;
}
