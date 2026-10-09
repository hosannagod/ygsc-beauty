(() => {
  // Keep local development and browser tests out of the production property.
  if (
    location.hostname !== "seoul-scent.onrender.com" ||
    window.__scentAnalyticsLoaded
  )
    return;
  window.__scentAnalyticsLoaded = true;
  const measurementId = "G-GS4XRHB557";
  const path = location.pathname;
  const safePath =
    /^\/(?:login|register|dashboard(?:\/(?:admin|brand|influencer))?|campaigns(?:\/(?:new|\d+))?|applications(?:\/\d+)?|profile|notifications|admin\/(?:users|settings))\/?$/.test(
      path,
    )
      ? path
      : "/other";
  const pageLocation = location.origin + safePath;
  let referrer = "";
  try {
    const url = new URL(document.referrer);
    if (["http:", "https:"].includes(url.protocol)) referrer = url.origin + "/";
  } catch {}
  const pageTitle = "Seoul Scent · " + (safePath.split("/")[1] || "home");
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  // Set global sanitized metadata as well as the explicit page view. Never read form values.
  window.gtag("set", {
    page_location: pageLocation,
    page_referrer: referrer,
    page_title: pageTitle,
  });
  window.gtag("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: pageLocation,
    page_referrer: referrer,
    page_title: pageTitle,
  });
  window.gtag("event", "page_view", {
    send_to: measurementId,
    page_location: pageLocation,
    page_referrer: referrer,
    page_title: pageTitle,
    language: document.documentElement.lang === "en" ? "en" : "ko",
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
  document.head.appendChild(script);
})();
