export function tierLabel(tier: number, completed: number) {
  return completed === 0
    ? "미등급"
    : ["브론즈", "실버", "골드", "플래티넘"][tier] || "미등급";
}
