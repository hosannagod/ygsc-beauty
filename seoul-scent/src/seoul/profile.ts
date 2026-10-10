export function socialProfileUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "instagram.com",
        "tiktok.com",
        "youtube.com",
        "m.youtube.com",
        "xiaohongshu.com",
        "xhslink.com",
        "rednote.com",
        "facebook.com",
        "m.facebook.com",
        "x.com",
        "twitter.com",
      ].includes(host) &&
      url.pathname !== "/"
    );
  } catch {
    return false;
  }
}
export function profileComplete(profile: any): boolean {
  return (
    !!profile &&
    /^[+0-9 ()-]{8,30}$/.test(profile.phone) &&
    socialProfileUrl(profile.social_url) &&
    Number.isInteger(profile.followers) &&
    profile.followers >= 0 &&
    profile.followers <= 100_000_000
  );
}
