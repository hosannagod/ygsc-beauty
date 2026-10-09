import type { User } from "./db.js";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ]!,
  );
export function workspacePage(user: User) {
  const labels = { admin: "운영사", brand: "브랜드", influencer: "인플루언서" };
  const links = [
    ["/dashboard", "◈", "대시보드"],
    [
      "/campaigns",
      "▤",
      user.role === "influencer" ? "캠페인 찾기" : "캠페인 관리",
    ],
    ...(user.role === "influencer"
      ? [
          ["/applications", "◎", "내 캠페인"],
          ["/profile", "◇", "내 프로필"],
        ]
      : []),
    ...(user.role === "admin"
      ? [
          ["/admin/users", "♧", "계정·티어 관리"],
          ["/admin/settings", "⚙", "운영 정책"],
        ]
      : []),
    ["/notifications", "○", "알림"],
  ];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seoul Scent · 협업 워크스페이스</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script><script src="/assets/workspace.js" defer></script></head><body data-role="${user.role}"><div class="workspace"><aside><a class="logo" href="/">SEOUL SCENT<span>CREATOR PARTNERSHIPS</span></a><p class="sidebar-label">WORKSPACE</p><nav>${links.map(([url, icon, label]) => `<a href="${url}" class="nav-item">${icon} &nbsp; ${label}</a>`).join("")}</nav><div class="sidebar-bottom"><span class="avatar">${escape(user.name.slice(0, 1))}</span><div><strong>${escape(user.name)}</strong><span>${labels[user.role]} 계정</span></div></div></aside><div class="main-area"><header><span>${labels[user.role]} 워크스페이스</span><div class="header-actions"><a href="/notifications" id="notification-count">알림</a><button id="logout" class="secondary">로그아웃</button></div></header><main class="dashboard" id="workspace" aria-live="polite"><p class="muted">워크스페이스를 불러오고 있습니다…</p></main></div></div><div id="toast" role="status" hidden></div><dialog id="confirm-dialog"><h2 id="confirm-title">작업 확인</h2><p id="confirm-message"></p><div class="button-row"><button class="secondary" id="confirm-cancel">취소</button><button class="primary" id="confirm-accept">확인</button></div></dialog></body></html>`;
}
