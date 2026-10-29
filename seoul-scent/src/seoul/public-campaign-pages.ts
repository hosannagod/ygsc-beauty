import type { Language } from "./i18n.js";
import { socialPreview } from "./social-preview.js";

export type PublicCampaign = {
  id: number;
  title: string;
  title_en: string;
  product: string;
  brand_name: string;
  recruit_date: string;
  thumbnail_id: number | null;
};

const escape = (value: string) => String(value || "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
);

const titleFor = (campaign: PublicCampaign, lang: Language) =>
  escape((lang === "en" && campaign.title_en) || campaign.title);

const imageFor = (campaign: PublicCampaign) => campaign.thumbnail_id
  ? `<img src="/api/public/campaigns/${campaign.id}/thumbnail" alt="" loading="lazy" decoding="async">`
  : `<span class="public-campaign-placeholder" aria-hidden="true">S</span>`;

const shell = (lang: Language, title: string, content: string) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">${socialPreview(lang)}<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=1"><title>${title} · Seoul Scent</title><link rel="stylesheet" href="/assets/public-campaigns.css"><script src="/assets/i18n.js" defer></script></head><body>${content}</body></html>`;

const languagePicker = (lang: Language) => `<label class="public-language-label" for="language-select">Language</label><select id="language-select" aria-label="Language"><option value="ko" ${lang === "ko" ? "selected" : ""}>한국어</option><option value="en" ${lang === "en" ? "selected" : ""}>English</option></select>`;

export function publicCampaignsPage(lang: Language, campaigns: PublicCampaign[], count: number) {
  const en = lang === "en";
  return shell(lang, en ? "Open campaigns" : "모집 중인 캠페인", `
    <header class="public-header"><a class="public-logo" href="/"><span>SEOUL <em>SCENT</em></span><small>K-BEAUTY. GLOBAL CREATORS.</small></a><div class="public-header-actions">${languagePicker(lang)}<a class="public-login" href="/login">${en ? "Log in" : "로그인"} ↗</a></div></header>
    <section class="public-hero"><div class="public-hero-inner"><p class="public-kicker">K-BEAUTY. GLOBAL CREATORS.</p><h1>${en ? "Discover campaigns<br><em>made for you.</em>" : "지금 열려 있는<br><em>캠페인을 만나보세요.</em>"}</h1><p>${en ? "Find a campaign you love and join Seoul Scent to collaborate." : "마음에 드는 캠페인을 고르고, Seoul Scent에서 협업을 시작하세요."}</p></div></section>
    <main class="public-main"><div class="public-section-head"><div><h2>${en ? "Open campaigns" : "모집 중인 캠페인"}</h2><p>${en ? "Choose a campaign, then log in or sign up to apply." : "캠페인을 선택하면 로그인·가입 후 이어서 볼 수 있습니다."}</p></div><span>${count}${en ? " open" : "개 모집 중"}</span></div>
    ${campaigns.length ? `<div class="public-grid">${campaigns.map((campaign) => `<a class="public-campaign" href="/continue/${campaign.id}" aria-label="${titleFor(campaign, lang)}"><span class="public-photo">${imageFor(campaign)}</span><span class="public-campaign-body"><span class="public-brand">${escape(campaign.brand_name)}<span class="public-pill">${en ? "Open" : "모집 중"}</span></span><strong>${titleFor(campaign, lang)}</strong><span class="public-product">${escape(campaign.product)}</span><span class="public-card-bottom"><span>${en ? "Apply by" : "모집 마감"} ${escape(campaign.recruit_date)}</span><b>${en ? "Details" : "자세히 보기"} ↗</b></span></span></a>`).join("")}</div>` : `<p class="public-empty">${en ? "New campaigns are coming soon." : "새로운 캠페인을 준비 중입니다."}</p>`}
    </main>`);
}

export function continueCampaignPage(lang: Language, campaign: PublicCampaign) {
  const en = lang === "en";
  return shell(lang, en ? "Continue to campaign" : "캠페인 계속하기", `
    <header class="public-header"><a class="public-logo" href="/"><span>SEOUL <em>SCENT</em></span><small>K-BEAUTY. GLOBAL CREATORS.</small></a><div class="public-header-actions">${languagePicker(lang)}<a class="public-back" href="/">← ${en ? "Campaigns" : "캠페인 목록"}</a></div></header>
    <main class="continue-main"><p class="public-kicker">CONTINUE TO CAMPAIGN</p><h1>${en ? "Interested in this campaign?" : "이 캠페인이 마음에 드시나요?"}</h1><p class="continue-description">${en ? "Log in or sign up for free to continue to your selected campaign." : "로그인하거나 무료로 가입하면 선택한 캠페인으로 바로 이동합니다."}</p>
    <div class="continue-selected"><span class="continue-image">${imageFor(campaign)}</span><span><small>${escape(campaign.brand_name)} · ${en ? "Open" : "모집 중"}</small><strong>${titleFor(campaign, lang)}</strong><small class="continue-date">${en ? "Apply by" : "모집 마감"} ${escape(campaign.recruit_date)}</small></span></div>
    <a class="continue-primary" href="/register?campaign=${campaign.id}">${en ? "Sign up for free" : "무료 회원가입"}<span>→</span></a>
    <a class="continue-secondary" href="/login?campaign=${campaign.id}">${en ? "Already a member? Log in" : "이미 회원이신가요? 로그인"}<span>→</span></a>
    <p class="continue-footnote">${en ? "You will return to this campaign after signing in." : "가입을 마치면 이 캠페인 상세 화면으로 돌아옵니다."}</p></main>`);
}
