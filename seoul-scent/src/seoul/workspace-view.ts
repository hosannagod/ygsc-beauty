import { translator, type Language } from "./i18n.js";
import type { User } from "./db.js";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ]!,
  );
export function workspacePage(user: User, lang: Language = "ko") {
  const { t, html } = translator(lang);
  const labels = {
    admin: t("운영사"),
    brand: t("브랜드"),
    influencer: t("인플루언서"),
  };
  const links = [
    ["/dashboard", "◈", t("대시보드")],
    [
      "/campaigns",
      "▤",
      user.role === "influencer" ? t("캠페인 찾기") : t("캠페인 관리"),
    ],
    ...(user.role === "influencer"
      ? [
          ["/applications", "◎", t("내 캠페인")],
          ["/profile", "◇", t("내 프로필")],
        ]
      : []),
    ...(user.role === "admin"
      ? [
          ["/admin/users", "♧", t("계정·티어 관리")],
          ["/admin/settings", "⚙", t("운영 정책")],
        ]
      : []),
    ["/notifications", "○", t("알림")],
  ];
  return html`<!doctype html>
    <html lang="${lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Seoul Scent · 협업 워크스페이스</title>
        <link rel="stylesheet" href="/assets/style.css" />
        <script src="/assets/analytics.js" defer></script><script src="/assets/i18n.js" defer></script>
        <script src="/assets/app.js" defer></script>
        <script src="/assets/workspace.js" defer></script>
      </head>
      <body data-role="${user.role}">
        <div class="workspace">
          <aside>
            <a class="logo" href="/"
              >SEOUL SCENT<span>CREATOR PARTNERSHIPS</span></a
            >
            <p class="sidebar-label">WORKSPACE</p>
            <nav>
              ${links.map(([url, icon, label]) => `<a href="${url}" class="nav-item">${icon} &nbsp; ${label}</a>`).join("")}
            </nav>
            <div class="sidebar-bottom">
              <span class="avatar">${escape(user.name.slice(0, 1))}</span>
              <div>
                <strong>${escape(user.name)}</strong
                ><span>${labels[user.role]} 계정</span>
              </div>
            </div>
          </aside>
          <div class="main-area">
            <header>
              <span>${labels[user.role]} 워크스페이스</span>
              <div class="header-actions">
                <label for="language-select">Language</label
                ><select id="language-select">
                  <option value="ko" ${lang === "ko" ? "selected" : ""}>
                    한국어
                  </option>
                  <option value="en" ${lang === "en" ? "selected" : ""}>
                    English
                  </option></select
                ><a href="/notifications" id="notification-count">알림</a
                ><button id="logout" class="secondary">로그아웃</button>
              </div>
            </header>
            <main class="dashboard" id="workspace" aria-live="polite">
              <p class="muted">워크스페이스를 불러오고 있습니다…</p>
            </main>
          </div>
        </div>
        <div id="toast" role="status" hidden></div>
        <dialog id="confirm-dialog">
          <h2 id="confirm-title">작업 확인</h2>
          <p id="confirm-message"></p>
          <div class="button-row">
            <button class="secondary" id="confirm-cancel">취소</button
            ><button class="primary" id="confirm-accept">확인</button>
          </div>
        </dialog>
      </body>
    </html>`;
}
