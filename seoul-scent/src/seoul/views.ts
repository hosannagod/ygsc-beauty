import { translator, type Language } from "./i18n.js";
import type { User } from "./db.js";
import { socialPreview } from "./social-preview.js";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ]!,
  );
type RecruitingPreview = {
  id: number;
  title: string;
  title_en: string;
  product: string;
  brand_name: string;
  recruit_date: string;
  thumbnail_id: number | null;
};

export function page(
  kind: "login" | "register" | "forgot-password" | "reset-password" | "dashboard" | "forbidden",
  user?: User,
  lang: Language = "ko",
  recruitingCampaigns: RecruitingPreview[] = [],
) {
  const { t, html } = translator(lang);
  const labels = {
    admin: t("운영사"),
    brand: t("브랜드"),
    influencer: t("인플루언서"),
  };
  const auth = ["login", "register", "forgot-password", "reset-password"].includes(kind);
  const register = kind === "register";
  const title = auth
    ? kind === "forgot-password"
      ? t("비밀번호 찾기")
      : kind === "reset-password"
        ? t("새 비밀번호 설정")
        : register
          ? t("새로운 협업을 시작하세요")
          : t("다시 만나서 반가워요")
    : kind === "forbidden"
      ? t("접근 권한이 없습니다")
      : html`${escape(user!.name)}님, 안녕하세요`;
  const descriptions = {
    admin: t("브랜드와 인플루언서의 협업을 한곳에서 관리하세요."),
    brand: t("브랜드의 이야기를 함께 전할 인플루언서를 만나세요."),
    influencer: t("나에게 맞는 브랜드를 만나고 새로운 콘텐츠를 만들어 보세요."),
  };
  return `<!doctype html><html lang="${lang}"><head><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=1"><meta charset="utf-8">${socialPreview(lang)}<meta name="viewport" content="width=device-width,initial-scale=1"><title>Seoul Scent · ${auth ? t("계정") : t("대시보드")}</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/analytics.js" defer></script><script src="/assets/i18n.js" defer></script><script src="/assets/app.js" defer></script></head><body class="${auth ? "auth-page" : ""}"><div class="language-control"><label for="language-select">Language</label><select id="language-select"><option value="ko" ${lang === "ko" ? "selected" : ""}>한국어</option><option value="en" ${lang === "en" ? "selected" : ""}>English</option></select></div>
  ${
    auth
      ? html`<main class="auth-layout">
          <section class="story">
            <a class="logo" href="/"
              >SEOUL <b>SCENT</b><span>K-BEAUTY. GLOBAL CREATORS.</span></a
            >
            <div class="story-intro">
              <p class="eyebrow">K-BEAUTY. GLOBAL CREATORS.</p>
              <h1>
                좋은 제품을,<br /><em>진짜 경험으로.</em>
              </h1>
              <p>
                브랜드와 크리에이터가 만나<br />새로운 콘텐츠를 만드는 곳.
              </p>
            </div>
            ${["login", "register"].includes(kind) ? html`<section class="auth-campaigns" aria-labelledby="auth-campaigns-title">
              <div class="auth-campaigns-heading"><div><p class="eyebrow">OPEN CAMPAIGNS</p><h2 id="auth-campaigns-title">${t("지금 모집 중인 캠페인")}</h2></div><span>${recruitingCampaigns.length}${t("개 미리보기")}</span></div>
              ${recruitingCampaigns.length ? `<div class="auth-campaign-list">${recruitingCampaigns.map((campaign) => `<a class="auth-campaign-card" href="/register?campaign=${campaign.id}" aria-label="${escape((lang === "en" && campaign.title_en) || campaign.title)} · ${escape(t("가입하고 지원하기"))}">
                ${campaign.thumbnail_id ? `<img src="/api/public/campaigns/${campaign.id}/thumbnail" alt="" loading="lazy" decoding="async">` : `<span class="auth-campaign-placeholder" aria-hidden="true">S</span>`}
                <span class="auth-campaign-copy"><small>${escape(campaign.brand_name)} · ${escape(t("모집 중"))}</small><strong>${escape((lang === "en" && campaign.title_en) || campaign.title)}</strong><small class="auth-campaign-product">${escape(campaign.product)}</small><small>${escape(t("모집 마감"))} ${escape(campaign.recruit_date)}</small></span><span class="auth-campaign-arrow" aria-hidden="true">↗</span>
              </a>`).join("")}</div>` : `<p class="auth-campaign-empty">${escape(t("새로운 캠페인을 준비 중입니다. 가입하고 다음 모집 소식을 확인해 보세요."))}</p>`}
              <a class="auth-campaign-more" href="/register">${t("가입하고 캠페인 둘러보기")} <span aria-hidden="true">→</span></a>
            </section>` : ""}
            <p class="story-footer">
              브랜드 · 크리에이터 · 하나의 워크스페이스
            </p>
          </section>
          <section class="auth-panel">
            <div class="form-wrap">
              <a class="logo auth-mobile-logo" href="/">SEOUL <b>SCENT</b><span>K-BEAUTY. GLOBAL CREATORS.</span></a>
              <p class="eyebrow">
                ${register ? "JOIN SEOUL SCENT" : "YOUR WORKSPACE"}
              </p>
              <h2>${title}</h2>
              <p class="muted">
                ${kind === "forgot-password" ? t("등록된 이메일로 재설정 링크를 보내드립니다.") : kind === "reset-password" ? t("새 비밀번호를 입력해 주세요.") : register ? t("가입 유형을 선택하고 계정을 만들어 주세요.") : t("계정에 로그인하여 협업을 이어가세요.")}
              </p>
              ${kind === "forgot-password" ? html`<form id="reset-request-form"><label>${t("등록된 이메일")}<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" /></label><p id="form-error" role="alert" hidden></p><p id="form-success" role="status" hidden></p><button class="primary" type="submit">${t("재설정 링크 받기")} <span>→</span></button></form><p class="note">${t("브랜드 아이디만 있고 이메일이 등록되지 않은 계정은 운영사에 문의해 주세요.")}</p><p class="switch"><a href="/login">${t("로그인으로 돌아가기")}</a></p>` : kind === "reset-password" ? html`<form id="password-reset-form"><label>${t("새 비밀번호")}<input name="new_password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /></label><label>${t("새 비밀번호 확인")}<input name="confirm_password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /></label><p id="form-error" role="alert" hidden></p><button class="primary" type="submit">${t("비밀번호 변경")} <span>→</span></button></form><p class="switch"><a href="/forgot-password">${t("새 링크 요청하기")}</a></p>` : html`
              <form id="auth-form" data-mode="${kind}">
                ${register ? t('<fieldset><legend>가입 유형</legend><div class="role-options"><label><input type="radio" name="role" value="brand" checked> 브랜드</label><label><input type="radio" name="role" value="influencer"> 인플루언서</label></div></fieldset><div id="brand-fields"><label>브랜드명<input name="brand_name" autocomplete="organization" required minlength="2" maxlength="60" placeholder="브랜드명을 입력해 주세요"></label><label>담당자명<input name="contact_name" autocomplete="name" required minlength="2" maxlength="60" placeholder="담당자 성함을 입력해 주세요"></label></div><div id="influencer-fields" hidden><label>성함<input name="name" autocomplete="name" disabled minlength="2" maxlength="60" placeholder="성함을 입력해 주세요"></label></div><label>연락처<input name="phone" type="tel" autocomplete="tel" required minlength="8" maxlength="30" placeholder="010-1234-5678"></label>') : ""}
                <label
                  >${register ? t("이메일") : t("이메일 또는 브랜드 아이디")}<input
                    name="email"
                    type="${register ? "email" : "text"}"
                    autocomplete="${register ? "email" : "username"}"
                    required
                    maxlength="254"
                    placeholder="you@example.com" /></label
                ><label
                  >비밀번호<input
                    name="password"
                    type="password"
                    autocomplete="${register ? "new-password" : "current-password"}"
                    required
                    ${register ? 'minlength="8"' : ""}
                    maxlength="128"
                    placeholder="${register ? t("8자 이상 입력해 주세요") : t("비밀번호를 입력해 주세요")}"
                /></label>
                <p id="form-error" role="alert" hidden></p>
                <button class="primary" type="submit">
                  ${register ? t("계정 만들기") : t("로그인")} <span>→</span>
                </button>
              </form>
              ${register ? `<p class="switch">${t('이미 계정이 있나요? <a href="/login">로그인</a>')}</p>` : `<a class="auth-register-cta" href="/register">${t("무료로 가입하고 캠페인 보기")} <span aria-hidden="true">→</span></a>`}
              ${kind === "login" ? html`<p class="switch"><a href="/forgot-password">${t("비밀번호를 잊으셨나요?")}</a></p>` : ""}
              ${register ? t('<p class="note">운영사 계정은 별도로 발급됩니다.</p>') : ""}
              `}
            </div>
          </section>
        </main>`
      : html`<div class="workspace">
          <aside>
            <a class="logo" href="/"
              >SEOUL SCENT<span>CREATOR PARTNERSHIPS</span></a
            >
            <p class="sidebar-label">WORKSPACE</p>
            <a class="nav-active" href="/dashboard">◈ &nbsp; 대시보드</a>
            <div class="sidebar-bottom">
              <span class="avatar">${escape(user!.name.slice(0, 1))}</span>
              <div>
                <strong>${escape(user!.name)}</strong
                ><span>${labels[user!.role]} 계정</span>
              </div>
            </div>
          </aside>
          <div class="main-area">
            <header>
              <span>${labels[user!.role]} 워크스페이스</span
              ><button id="logout" class="secondary">로그아웃</button>
            </header>
            <main class="dashboard">
              <p class="eyebrow">YOUR COLLABORATION HUB</p>
              <h1>${title}</h1>
              <p class="muted">
                ${kind === "forbidden" ? t("현재 계정으로는 이 화면에 접근할 수 없습니다.") : descriptions[user!.role]}
              </p>
              ${
                kind === "forbidden"
                  ? t(
                      '<a class="primary link-button" href="/dashboard">내 대시보드로 돌아가기</a>',
                    )
                  : html`<div class="welcome">
                        <div>
                          <span class="badge">계정 설정 완료</span>
                          <h2>협업을 위한 첫 준비가 끝났어요.</h2>
                          <p>
                            캠페인 모집과 콘텐츠 관리 기능은 순차적으로 열릴
                            예정입니다.
                          </p>
                        </div>
                        <div class="welcome-mark">
                          S<span>SEOUL SCENT</span>
                        </div>
                      </div>
                      <section class="cards">
                        <article>
                          <p class="eyebrow">MY ACCOUNT</p>
                          <h3>내 계정</h3>
                          <dl>
                            <dt>이름</dt>
                            <dd>${escape(user!.name)}</dd>
                            <dt>이메일</dt>
                            <dd>${escape(user!.email)}</dd>
                            <dt>가입 유형</dt>
                            <dd>${labels[user!.role]}</dd>
                          </dl>
                        </article>
                        <article>
                          <p class="eyebrow">COMING NEXT</p>
                          <h3>
                            ${user!.role === "brand" ? t("캠페인 만들기") : user!.role === "influencer" ? t("캠페인 찾기") : t("통합 운영 현황")}
                          </h3>
                          <p class="muted">
                            ${user!.role === "brand" ? t("제품과 가이드라인을 등록하고 함께할 크리에이터를 모집하세요.") : user!.role === "influencer" ? t("관심 있는 브랜드의 캠페인을 찾아 지원할 수 있게 됩니다.") : t("전체 계정과 캠페인의 진행 상황을 확인할 수 있게 됩니다.")}
                          </p>
                          <span class="coming">다음 단계에서 제공</span>
                        </article>
                      </section>
                      ${user!.role === "admin" ? t('<section class="account-counts"><h3>가입 계정 현황</h3><p id="user-counts" aria-live="polite">불러오는 중…</p></section>') : ""}`
              }
            </main>
          </div>
        </div>`
  }
  </body></html>`;
}
