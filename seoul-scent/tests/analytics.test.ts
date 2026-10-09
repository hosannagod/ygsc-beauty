import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { page } from "../src/seoul/views.js";
import { workspacePage } from "../src/seoul/workspace-view.js";
const source = readFileSync(
  new URL("../public/analytics.js", import.meta.url),
  "utf8",
);
function browser(
  host = "seoul-scent.onrender.com",
  pathname = "/campaigns/123",
) {
  const scripts: any[] = [];
  const context: any = {
    window: {},
    location: {
      hostname: host,
      origin: "https://" + host,
      pathname,
      search: "?email=private@example.com",
      hash: "#private",
    },
    document: {
      referrer: "https://example.org/ref?email=private@example.com",
      title: "Private name",
      documentElement: { lang: "en" },
      createElement: () => ({}),
      head: { appendChild: (s: any) => scripts.push(s) },
    },
    URL,
    Date,
  };
  vm.runInNewContext(source, context);
  return {
    context,
    scripts,
    events: (context.window.dataLayer || []).map((args: any) =>
      Array.from(args),
    ),
  };
}
test("GA queues one sanitized page view, excludes personal metadata and disables ads", () => {
  const { context, scripts, events } = browser();
  assert.equal(scripts.length, 1);
  assert.equal(
    scripts[0].src,
    "https://www.googletagmanager.com/gtag/js?id=G-GS4XRHB557",
  );
  const views = events.filter(
    (e: any) => e[0] === "event" && e[1] === "page_view",
  );
  assert.equal(views.length, 1);
  assert.equal(
    views[0][2].page_location,
    "https://seoul-scent.onrender.com/campaigns/123",
  );
  assert.equal(views[0][2].page_title, "Seoul Scent · campaigns");
  assert.equal(views[0][2].page_referrer, "https://example.org/");
  assert.equal(views[0][2].language, "en");
  assert.ok(!JSON.stringify(events).includes("private@example.com"));
  assert.ok(!JSON.stringify(events).includes("Private name"));
  assert.equal(
    events.find((e: any) => e[0] === "config")[2].send_page_view,
    false,
  );
  assert.equal(
    events.find((e: any) => e[0] === "consent")[2].ad_user_data,
    "denied",
  );
  vm.runInNewContext(source, context);
  assert.equal(scripts.length, 1);
});
test("GA skips local hosts and hides unexpected personal URL paths", () => {
  assert.equal(browser("localhost").scripts.length, 0);
  assert.equal(browser("preview.example.com").scripts.length, 0);
  const { events } = browser(
    "seoul-scent.onrender.com",
    "/people/private@example.com",
  );
  assert.equal(
    events.find((e: any) => e[0] === "event")[2].page_location,
    "https://seoul-scent.onrender.com/other",
  );
});
test("GA loader is included once on authentication and workspace pages", () => {
  const user: any = {
    id: 1,
    name: "테스트 사용자",
    email: "private@example.com",
    role: "influencer",
  };
  for (const html of [page("login"), page("register"), workspacePage(user)])
    assert.equal((html.match(/src="\/assets\/analytics.js"/g) || []).length, 1);
});
