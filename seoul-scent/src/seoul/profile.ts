import { fail, text } from "./workflow.js";
export function socialProfileUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function profileComplete(profile: any): boolean {
  return (
    !!profile &&
    !profile.import_review_required &&
    /^[+0-9 ()-]{8,30}$/.test(profile.phone) &&
    socialProfileUrl(profile.social_url) &&
    Number.isInteger(profile.followers) &&
    profile.followers >= 0 &&
    profile.followers <= 100_000_000
  );
}

export function nationalityValue(value: unknown): string {
  const result = text(value, "국적", 0, 80);
  if (/[\u0000-\u001f\u007f]/.test(result))
    fail("국적에 줄바꿈이나 제어 문자를 사용할 수 없습니다.");
  return result;
}
