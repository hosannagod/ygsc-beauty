const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process"),
  { mkdtempSync, rmSync } = require("node:fs"),
  { tmpdir } = require("node:os"),
  { randomBytes } = require("node:crypto"),
  assert = require("node:assert/strict");
(async () => {
  const tmp = mkdtempSync(tmpdir() + "/seoul-flow-"),
    password = randomBytes(20).toString("hex"),
    env = {
      ...process.env,
      DATABASE_PATH: tmp + "/db.sqlite",
      PORT: "3102",
      NODE_ENV: "test",
    },
    base = "http://localhost:3102";
  const seeded = spawnSync("npm", ["run", "admin:create"], {
    cwd: process.cwd(),
    env: {
      ...env,
      ADMIN_EMAIL: "admin@example.test",
      ADMIN_PASSWORD: password,
    },
    encoding: "utf8",
  });
  assert.equal(seeded.status, 0);
  const server = spawn("node", ["dist/server.js"], {
    cwd: process.cwd(),
    env,
    stdio: "ignore",
  });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(base + "/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_PATH ||
        (require("node:fs").existsSync("/usr/bin/chromium")
          ? "/usr/bin/chromium"
          : undefined),
      headless: true,
      args: ["--no-sandbox"],
    });
    const errors = [];
    async function signup(role, name) {
      const ctx = await browser.newContext(),
        p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + "/register");
      await p.locator(`input[value="${role}"]`).check();
      await p.locator("[name=name]").fill(name);
      await p.locator("[name=email]").fill(role + "@example.test");
      await p.locator("[name=password]").fill(password);
      await p.getByRole("button", { name: "계정 만들기" }).click();
      await p.waitForURL("**/dashboard/" + role);
      await p.getByRole("heading", { name: name + "님, 안녕하세요" }).waitFor();
      return p;
    }
    const brand = await signup("brand", "서울향기 브랜드"),
      influencer = await signup("influencer", "서울 크리에이터");
    const future = (n) =>
      new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await brand.getByRole("link", { name: "+ 캠페인 만들기" }).click();
    await brand.locator("[name=title]").fill("서울 향수 릴스 캠페인");
    await brand.locator("[name=product]").fill("Seoul Scent 향수");
    await brand
      .locator("[name=description]")
      .fill("서울의 향기를 담은 신제품 향수입니다.");
    await brand
      .locator("[name=guidelines]")
      .fill("향수 사용 장면을 담은 30초 릴스 영상을 제작해 주세요.");
    await brand.locator("[name=capacity]").fill("1");
    for (const [key, n] of [
      ["recruit_date", 2],
      ["draft_date", 5],
      ["final_date", 10],
    ])
      await brand.locator(`[name=${key}]`).fill(future(n));
    await brand.getByRole("button", { name: "캠페인 등록" }).click();
    await brand.waitForURL(/\/campaigns\/\d+$/);
    const campaignId = brand.url().split("/").pop();
    await influencer.getByRole("link", { name: "내 프로필" }).click();
    await influencer.locator("[name=phone]").fill("01012345678");
    await influencer
      .locator("[name=address]")
      .fill("서울시 강남구 테스트로 123");
    await influencer
      .locator("[name=social_url]")
      .fill("https://www.instagram.com/seoulcreator");
    await influencer.locator("[name=followers]").fill("12000");
    await influencer.getByRole("button", { name: "프로필 저장" }).click();
    await influencer.locator("#toast").getByText("저장되었습니다.").waitFor();
    await influencer.goto(base + "/campaigns/" + campaignId);
    await influencer.locator("[name=consent]").check();
    await influencer
      .getByRole("button", { name: "지원하기", exact: false })
      .click();
    await influencer.waitForURL(/\/applications\/\d+$/);
    const appId = influencer.url().split("/").pop();
    await brand.goto(base + "/applications/" + appId);
    await brand.getByRole("button", { name: "참여자로 선정" }).click();
    await brand.locator("#confirm-accept").click();
    await brand.locator("[name=carrier]").waitFor();
    await brand.goto(base + "/campaigns/" + campaignId);
    const downloaded = await Promise.all([
      brand.waitForEvent("download"),
      brand.getByRole("link", { name: "배송지 XLSX 다운로드" }).click(),
    ]);
    const ExcelJS = require("exceljs"),
      book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await downloaded[0].path());
    book.worksheets[0].getCell("E2").value = "CJ대한통운";
    book.worksheets[0].getCell("F2").value = "00123456789";
    await book.xlsx.writeFile(tmp + "/shipping.xlsx");
    await brand.locator("#shipping-file").setInputFiles(tmp + "/shipping.xlsx");
    await brand.locator("#confirm-accept").click();
    await brand
      .locator("#toast")
      .getByText("1건의 송장이 등록되었습니다.")
      .waitFor();
    await influencer.reload();
    await influencer
      .locator("[name=url]")
      .fill("https://drive.google.com/file/d/draft/view");
    await influencer.locator("[name=public_confirmed]").check();
    await influencer.getByRole("button", { name: "초안 링크 제출" }).click();
    await influencer
      .getByText("초안 검수 대기", { exact: true })
      .first()
      .waitFor();
    await brand.goto(base + "/applications/" + appId);
    await brand
      .locator("[name=feedback]")
      .fill("제품 패키지 장면을 추가해 주세요.");
    await brand.locator("[name=revision_date]").fill(future(7));
    await brand
      .getByRole("button", { name: "수정 요청", exact: false })
      .click();
    await brand.getByText("수정 요청 중", { exact: true }).first().waitFor();
    await influencer.reload();
    await influencer
      .locator("[name=url]")
      .fill("https://drive.google.com/file/d/revised/view");
    await influencer.locator("[name=public_confirmed]").check();
    await influencer.getByRole("button", { name: "수정 초안 제출" }).click();
    await influencer
      .getByText("초안 검수 대기", { exact: true })
      .first()
      .waitFor();
    await brand.reload();
    await brand
      .getByRole("button", { name: "초안 승인", exact: false })
      .click();
    await brand.locator("#confirm-accept").click();
    await brand
      .getByText("초안 승인 · 업로드 대기", { exact: true })
      .first()
      .waitFor();
    await influencer.reload();
    await influencer
      .locator("[name=url]")
      .fill("https://www.instagram.com/reel/approved");
    await influencer.getByRole("button", { name: "최종 URL 제출" }).click();
    await influencer.locator("#confirm-accept").click();
    await influencer
      .getByText("최종 제출 완료", { exact: true })
      .first()
      .waitFor();
    await brand.reload();
    await brand.locator("[name=views]").fill("12500");
    await brand.locator("[name=best]").check();
    await brand.getByRole("button", { name: "활동 완료 처리" }).click();
    await brand.locator("#confirm-accept").click();
    await brand.getByText("완료", { exact: true }).first().waitFor();
    await brand.goto(base + "/campaigns/" + campaignId);
    await brand.getByRole("button", { name: "모집 마감하기" }).click();
    await brand.locator("#confirm-accept").click();
    await brand.getByRole("button", { name: "캠페인 종료하기" }).click();
    await brand.locator("#confirm-accept").click();
    await brand.getByText("종료된 캠페인입니다.").waitFor();
    const results = await Promise.all([
      brand.waitForEvent("download"),
      brand.getByRole("link", { name: "캠페인 결과 XLSX 다운로드" }).click(),
    ]);
    const resultBook = new (require("exceljs").Workbook)();
    await resultBook.xlsx.readFile(await results[0].path());
    assert.equal(
      resultBook.worksheets[0].getCell("E2").value,
      "https://www.instagram.com/reel/approved",
    );
    await influencer.goto(base + "/profile");
    assert.equal(
      await influencer.locator(".kpi").nth(1).locator("strong").textContent(),
      "1",
    );
    await influencer.goto(base + "/applications/" + appId);
    await influencer.getByRole("heading", { name: "협업 타임라인" }).waitFor();
    await influencer.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await influencer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await influencer.screenshot({ path: tmp + "/mobile.png", fullPage: true });
    const admin = await browser.newPage();
    admin.on("pageerror", (e) => errors.push(e.message));
    await admin.goto(base + "/login");
    await admin.locator("[name=email]").fill("admin@example.test");
    await admin.locator("[name=password]").fill(password);
    await admin.getByRole("button", { name: "로그인", exact: false }).click();
    await admin.waitForURL("**/dashboard/admin");
    await admin
      .getByRole("heading", { name: "전체 캠페인", exact: true })
      .waitFor();
    await admin.screenshot({ path: tmp + "/dashboard.png", fullPage: true });
    await admin.getByRole("link", { name: "계정·티어 관리" }).click();
    await admin.getByRole("button", { name: "이력 보기" }).click();
    await admin.getByRole("heading", { name: "참여 이력" }).waitFor();
    await admin.getByRole("link", { name: "운영 정책" }).click();
    await admin.locator("[name=penalty_days]").waitFor();
    await admin.getByRole("button", { name: "운영 정책 저장" }).click();
    await admin.locator("#confirm-accept").click();
    await admin.locator("#toast").getByText("저장되었습니다.").waitFor();
    const backup = spawnSync("npm", ["run", "db:backup"], {
      cwd: process.cwd(),
      env: { ...env, BACKUP_PATH: tmp + "/backup.db" },
      encoding: "utf8",
    });
    assert.equal(backup.status, 0, backup.stderr);
    const restored = new (require("better-sqlite3"))(tmp + "/backup.db", {
      readonly: true,
    });
    assert.equal(
      restored
        .prepare(
          "SELECT COUNT(*) AS n FROM applications WHERE status='completed'",
        )
        .get().n,
      1,
    );
    assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
    restored.close();
    assert.deepEqual(errors, []);
    console.log(
      "Browser complete lifecycle, revision, admin policy/history, mobile and console checks passed",
    );
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const ended = new Promise((r) => server.once("exit", r));
      server.kill("SIGTERM");
      await ended;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
