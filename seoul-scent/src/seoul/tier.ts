export function tierLabel(tier: number, completed: number, approved = 0) {
  return completed === 0 && !approved
    ? "기본"
    : ["브론즈", "실버", "골드", "플래티넘"][tier] || "기본";
}
