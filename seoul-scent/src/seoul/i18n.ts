import translations from "../../public/translations.json" with { type: "json" };
export type Language = "ko" | "en";
const dictionary: Record<string, string> = translations;
const keys = Object.keys(dictionary).sort((a, b) => b.length - a.length);
const pattern = new RegExp(
  keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g",
);
export function language(cookie = ""): Language {
  return /(?:^|;\s*)scent_language=en(?:;|$)/.test(cookie) ? "en" : "ko";
}
export function translator(lang: Language) {
  const t = (value: string) =>
    lang === "en"
      ? value.replace(/\s+/g, " ").replace(pattern, (k) => dictionary[k])
      : value;
  const html = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (out, part, i) =>
        out + t(part) + (i < values.length ? String(values[i] ?? "") : ""),
      "",
    );
  return { t, html };
}
