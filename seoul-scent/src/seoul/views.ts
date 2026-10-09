import type { User } from "./db.js";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ]!,
  );
const labels = { admin: "운영사", brand: "브랜드", influencer: "인플루언서" };
export function page(
  kind: "login" | "register" | "dashboard" | "forbidden",
  user?: User,
) {
  const auth = kind === "login" || kind === "register";
  const register = kind === "register";
  const title = auth
    ? register
      ? "새로운 협업을 시작하세요"
      : "다시 만나서 반가워요"
    : kind === "forbidden"
      ? "접근 권한이 없습니다"
      : `${escape(user!.name)}님, 안녕하세요`;
  const descriptions = {
    admin: "브랜드와 인플루언서의 협업을 한곳에서 관리하세요.",
    brand: "브랜드의 이야기를 함께 전할 인플루언서를 만나세요.",
    influencer: "나에게 맞는 브랜드를 만나고 새로운 콘텐츠를 만들어 보세요.",
  };
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seoul Scent · ${auth ? "계정" : "대시보드"}</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script></head><body>
  ${
    auth
      ? `<main class="auth-layout"><section class="story"><a class="logo" href="/">SEOUL SCENT<span>CREATOR PARTNERSHIPS</span></a><div><p class="eyebrow">MAKE CONNECTIONS. CREATE IMPACT.</p><h1>좋은 브랜드와<br>좋은 크리에이터의<br><em>새로운 연결.</em></h1><p>캠페인의 시작부터 콘텐츠 완성까지.<br>협업의 모든 과정을 Seoul Scent에서 함께하세요.</p></div><p class="story-footer">브랜드 · 크리에이터 · 하나의 워크스페이스</p></section><section class="auth-panel"><div class="form-wrap"><p class="eyebrow">${register ? "JOIN SEOUL SCENT" : "YOUR WORKSPACE"}</p><h2>${title}</h2><p class="muted">${register ? "가입 유형을 선택하고 계정을 만들어 주세요." : "계정에 로그인하여 협업을 이어가세요."}</p><form id="auth-form" data-mode="${kind}">
  ${register ? '<fieldset><legend>가입 유형</legend><div class="role-options"><label><input type="radio" name="role" value="brand" checked> 브랜드</label><label><input type="radio" name="role" value="influencer"> 인플루언서</label></div></fieldset><label>이름 또는 브랜드명<input name="name" autocomplete="name" required minlength="2" maxlength="60" placeholder="사용할 이름을 입력해 주세요"></label>' : ""}
  <label>이메일<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label><label>비밀번호<input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" required ${register ? 'minlength="12"' : ""} maxlength="128" placeholder="${register ? "12자 이상 입력해 주세요" : "비밀번호를 입력해 주세요"}"></label>
  <p id="form-error" role="alert" hidden></p><button class="primary" type="submit">${register ? "계정 만들기" : "로그인"} <span>→</span></button></form><p class="switch">${register ? '이미 계정이 있나요? <a href="/login">로그인</a>' : '처음 방문하셨나요? <a href="/register">회원가입</a>'}</p>${register ? '<p class="note">운영사 계정은 별도로 발급됩니다.</p>' : ""}</div></section></main>`
      : `<div class="workspace"><aside><a class="logo" href="/">SEOUL SCENT<span>CREATOR PARTNERSHIPS</span></a><p class="sidebar-label">WORKSPACE</p><a class="nav-active" href="/dashboard">◈ &nbsp; 대시보드</a><div class="sidebar-bottom"><span class="avatar">${escape(user!.name.slice(0, 1))}</span><div><strong>${escape(user!.name)}</strong><span>${labels[user!.role]} 계정</span></div></div></aside><div class="main-area"><header><span>${labels[user!.role]} 워크스페이스</span><button id="logout" class="secondary">로그아웃</button></header><main class="dashboard"><p class="eyebrow">YOUR COLLABORATION HUB</p><h1>${title}</h1><p class="muted">${kind === "forbidden" ? "현재 계정으로는 이 화면에 접근할 수 없습니다." : descriptions[user!.role]}</p>${kind === "forbidden" ? '<a class="primary link-button" href="/dashboard">내 대시보드로 돌아가기</a>' : `<div class="welcome"><div><span class="badge">계정 설정 완료</span><h2>협업을 위한 첫 준비가 끝났어요.</h2><p>캠페인 모집과 콘텐츠 관리 기능은 순차적으로 열릴 예정입니다.</p></div><div class="welcome-mark">S<span>SEOUL SCENT</span></div></div><section class="cards"><article><p class="eyebrow">MY ACCOUNT</p><h3>내 계정</h3><dl><dt>이름</dt><dd>${escape(user!.name)}</dd><dt>이메일</dt><dd>${escape(user!.email)}</dd><dt>가입 유형</dt><dd>${labels[user!.role]}</dd></dl></article><article><p class="eyebrow">COMING NEXT</p><h3>${user!.role === "brand" ? "캠페인 만들기" : user!.role === "influencer" ? "캠페인 찾기" : "통합 운영 현황"}</h3><p class="muted">${user!.role === "brand" ? "제품과 가이드라인을 등록하고 함께할 크리에이터를 모집하세요." : user!.role === "influencer" ? "관심 있는 브랜드의 캠페인을 찾아 지원할 수 있게 됩니다." : "전체 계정과 캠페인의 진행 상황을 확인할 수 있게 됩니다."}</p><span class="coming">다음 단계에서 제공</span></article></section>${user!.role === "admin" ? '<section class="account-counts"><h3>가입 계정 현황</h3><p id="user-counts" aria-live="polite">불러오는 중…</p></section>' : ""}`}</main></div></div>`
  }
  </body></html>`;
}
