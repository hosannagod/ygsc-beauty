import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/seoul/db.js";
import {
  chunks,
  contentTranslator,
  translatePublic,
} from "../src/seoul/content-translation.js";
test("content translation caches and deduplicates, updates changed source, preserves links and manual copy", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  const translator = contentTranslator(db, async (text) => {
    calls++;
    await new Promise((r) => setTimeout(r, 1));
    return "English translation " + calls;
  });
  const campaign = {
    title: "한글 캠페인",
    product: "한글 제품",
    description: "제품 소개 https://example.com/product?x=1",
    guidelines: "이미 영어",
    guidelines_en: "Verified content guidelines",
  };
  try {
    const [one, two] = await Promise.all([
      translator(campaign),
      translator(campaign),
    ]);
    assert.deepEqual(one, two);
    assert.equal(calls, 3);
    assert.ok(
      one.translated.description?.includes("https://example.com/product?x=1"),
    );
    assert.equal(one.translated.guidelines, "Verified content guidelines");
    assert.deepEqual(one.unavailable, []);
    await translator(campaign);
    assert.equal(calls, 3);
    await translator({ ...campaign, title: "변경된 캠페인" });
    assert.equal(calls, 4);
    const fail = contentTranslator(db, async () => {
      throw new Error("Quota exceeded");
    });
    const unavailable = await fail(
      { ...campaign, title: "미번역 캠페인" },
      true,
    );
    assert.deepEqual(unavailable.unavailable, ["title"]);
    assert.equal(unavailable.translated.title, undefined);
    assert.equal(
      (await translator({ ...campaign, title: "Already English" }, true))
        .translated.title,
      "Already English",
    );
  } finally {
    db.close();
  }
});
test("provider splits UTF-8 text within public API limits and rejects quota errors", async () => {
  for (const chunk of chunks("긴 한글 안내".repeat(100)))
    assert.ok(Buffer.byteLength(chunk) <= 450);
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      calls.push(url.searchParams.get("q")!);
      assert.equal(url.origin, "https://api.mymemory.translated.net");
      assert.equal(url.searchParams.get("langpair"), "ko|en");
      return new Response(
        JSON.stringify({
          responseStatus: 200,
          responseData: { translatedText: "English copy" },
        }),
      );
    }) as typeof fetch;
    assert.match(
      await translatePublic("한글 안내".repeat(100)),
      /English copy/,
    );
    assert.ok(calls.length > 1);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          responseStatus: 403,
          quotaFinished: true,
          responseData: { translatedText: "Quota reached" },
        }),
      )) as typeof fetch;
    await assert.rejects(() => translatePublic("한글 안내"));
  } finally {
    globalThis.fetch = original;
  }
});
