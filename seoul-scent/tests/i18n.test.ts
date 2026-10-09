import { test } from "node:test";
import assert from "node:assert/strict";
import { translator, language } from "../src/seoul/i18n.js";
import { createApp } from "../src/seoul/app.js";
import { openDb } from "../src/seoul/db.js";
test("language selection translates literal UI while preserving campaign and user text", async () => {
  assert.equal(language("scent_language=en; session=abc"), "en");
  assert.equal(language("other=scent_language=en"), "ko");
  const { t, html } = translator("en");
  assert.equal(t("초안 링크 제출"), "Submit draft link");
  assert.equal(
    html`<h2>제품 소개</h2><p>${"제품 소개 로그인"}</p>`,
    "<h2>Product description</h2><p>제품 소개 로그인</p>",
  );
  const db = openDb(":memory:");
  try {
    const app = createApp(db);
    const en = await app.request("/register", {
      headers: { Cookie: "scent_language=en" },
    });
    const body = await en.text();
    assert.match(body, /<html lang="en">/);
    assert.match(body, /Contact person/);
    assert.match(body, /Full name/);
    assert.match(body, /Create account/);
    assert.match(body, /language-select/);
    const ko = await app.request("/register");
    assert.match(await ko.text(), /담당자명/);
  } finally {
    db.close();
  }
});
