import { createHash } from "node:crypto";
import type { DB } from "./workflow.js";
export const englishFields = [
  "title",
  "product",
  "description",
  "guidelines",
] as const;
export type EnglishField = (typeof englishFields)[number];
export type Translate = (text: string) => Promise<string>;
// MyMemory's public endpoint accepts at most 500 UTF-8 bytes per query.
export function chunks(text: string, limit = 450) {
  const parts: string[] = [];
  let part = "";
  for (const char of text) {
    if (Buffer.byteLength(part + char) > limit) {
      parts.push(part);
      part = "";
    }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}
export async function translatePublic(text: string) {
  const results: string[] = [];
  for (const part of chunks(text)) {
    if (!/[가-힣]/.test(part)) {
      results.push(part);
      continue;
    }
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", part);
    url.searchParams.set("langpair", "ko|en");
    // Public campaign copy only. Never send names, email, phones, addresses or private feedback.
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error("Translation service unavailable");
    const data = (await response.json()) as any;
    const result = data.responseData?.translatedText;
    if (
      Number(data.responseStatus) !== 200 ||
      data.quotaFinished ||
      typeof result !== "string" ||
      !result.trim() ||
      /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(result) ||
      /[가-힣]/.test(result)
    )
      throw new Error("Translation unavailable or daily limit reached");
    results.push(result);
  }
  return results.join(" ");
}
export function contentTranslator(
  db: DB,
  translate: Translate = translatePublic,
) {
  const pending = new Map<string, Promise<string>>();
  const failures = new Map<string, number>();
  async function cached(source: string) {
    if (!/[가-힣]/.test(source)) return source;
    const key = createHash("sha256")
      .update("ko|en|" + source)
      .digest("hex");
    const row = db
      .prepare(
        "SELECT translated FROM content_translation_cache WHERE source_hash=?",
      )
      .get(key) as any;
    if (row) return row.translated as string;
    if ((failures.get(key) ?? 0) > Date.now())
      throw new Error("Translation temporarily unavailable");
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        // Keep links byte-for-byte intact and translate only the surrounding prose.
        const sections = source.split(/(https?:\/\/[^\s<>"']+)/g);
        const translated: string[] = [];
        for (const section of sections)
          translated.push(
            /^https?:\/\//.test(section) || !/[가-힣]/.test(section)
              ? section
              : await translate(section),
          );
        const result = translated.join("");
        if (
          !result.trim() ||
          /[가-힣]/.test(result.replace(/https?:\/\/[^\s]+/g, ""))
        )
          throw new Error("Incomplete translation");
        db.prepare(
          "INSERT OR REPLACE INTO content_translation_cache(source_hash,translated,created_at) VALUES(?,?,?)",
        ).run(key, result, Date.now());
        return result;
      } catch (error) {
        failures.set(key, Date.now() + 60_000);
        throw error;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, promise);
    return promise;
  }
  return async (campaign: any, summary = false) => {
    const result: Partial<Record<EnglishField, string>> = {},
      unavailable: EnglishField[] = [];
    for (const field of summary ? englishFields.slice(0, 2) : englishFields) {
      try {
        result[field] =
          campaign[field + "_en"]?.trim() || (await cached(campaign[field]));
      } catch {
        unavailable.push(field);
      }
    }
    return { translated: result, unavailable };
  };
}
