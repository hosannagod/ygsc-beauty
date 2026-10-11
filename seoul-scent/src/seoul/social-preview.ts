import type { Language } from "./i18n.js";

// Public site branding only: never include account or campaign details here.
export function socialPreview(lang: Language = "ko") {
  const origin = "https://www.seoulscent.kr";
  const title = "Seoul Scent | K-Beauty. Global Creators.";
  const description = lang === "en"
    ? "Connect K-Beauty brands with global creators. Discover campaigns and create together with Seoul Scent."
    : "K-뷰티 브랜드와 글로벌 크리에이터를 연결하는 Seoul Scent. 캠페인을 만나고 함께 콘텐츠를 만들어 보세요.";
  const image = `${origin}/assets/seoul-scent-share.png?v=1`;
  return `<meta name="description" content="${description}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Seoul Scent">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${origin}/">
    <meta property="og:locale" content="${lang === "en" ? "en_US" : "ko_KR"}">
    <meta property="og:image" content="${image}">
    <meta property="og:image:secure_url" content="${image}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1731">
    <meta property="og:image:height" content="909">
    <meta property="og:image:alt" content="SEOUL SCENT — K-Beauty. Global Creators.">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">
    <meta name="twitter:image:alt" content="SEOUL SCENT — K-Beauty. Global Creators.">`;
}
