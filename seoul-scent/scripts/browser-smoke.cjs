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
      if (role === "brand") {
        await p.locator("[name=brand_name]").fill(name);
        await p.locator("[name=contact_name]").fill("브랜드 담당자");
      } else await p.locator("[name=name]").fill(name);
      await p.locator("[name=phone]").fill("01012345678");
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
      .locator("[name=product_url]")
      .fill("https://example.com/product");
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
    await brand
      .getByRole("link", { name: "제품·브랜드 사이트 보기" })
      .waitFor();
    await brand
      .locator(".deadline-strip")
      .getByText(/모집 시작/)
      .waitFor();
    await brand
      .locator(".deadline-strip")
      .getByText(/모집 마감/)
      .last()
      .waitFor();
    await brand.getByText("캠페인 편집", { exact: true }).click();
    await brand
      .locator('form[data-task="campaign-details"] [name=product_url]')
      .fill("https://example.com/updated");
    await brand
      .locator('form[data-task="campaign-details"] [name=description]')
      .fill(
        "수정된 제품 소개입니다. 촬영 전에 제품의 상세 정보를 확인해 주세요.",
      );
    await brand.getByRole("button", { name: "캠페인 수정 저장" }).click();
    await brand.locator('a[href="https://example.com/updated"]').waitFor();
    assert.equal(
      await brand
        .getByRole("link", { name: "제품·브랜드 사이트 보기" })
        .getAttribute("href"),
      "https://example.com/updated",
    );
    await influencer.getByRole("link", { name: "내 프로필" }).click();
    await influencer.locator("[name=phone]").fill("01012345678");

    await influencer
      .locator("[name=social_url]")
      .fill("https://www.instagram.com/seoulcreator");
    await influencer.locator("[name=followers]").fill("12000");
    await influencer.getByRole("button", { name: "프로필 저장" }).click();
    await influencer.locator("#toast").getByText("저장되었습니다.").waitFor();
    await influencer.goto(base + "/campaigns/" + campaignId);
    await influencer
      .getByText(
        "수정된 제품 소개입니다. 촬영 전에 제품의 상세 정보를 확인해 주세요.",
        { exact: true },
      )
      .waitFor();
    await influencer.locator("[name=secondary_use_consent]").check();
    await influencer.locator("[name=original_delivery_consent]").check();
    assert.ok(
      await influencer
        .locator(".check input")
        .first()
        .evaluate((el) => el.getBoundingClientRect().width < 30),
    );
    assert.ok(
      await influencer
        .locator(".check span")
        .first()
        .evaluate((el) => el.getBoundingClientRect().width > 180),
    );
    await influencer.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await influencer
        .locator(".check span")
        .first()
        .evaluate((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 180 && box.height < 180;
        }),
    );
    assert.ok(
      await influencer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await influencer.setViewportSize({ width: 1280, height: 720 });
    await influencer
      .getByRole("button", { name: "지원하기", exact: false })
      .click();
    await influencer.waitForURL(/\/applications\/\d+$/);
    const appId = influencer.url().split("/").pop();
    await brand.goto(base + "/applications/" + appId);
    await brand.getByRole("button", { name: "참여자로 선정" }).click();
    await brand.locator("#confirm-accept").click();
    await influencer.goto(base + "/applications/" + appId);
    await influencer.locator("[name=recipient_name]").fill("서울 크리에이터");
    await influencer.locator("[name=postal_code]").fill("06234");
    await influencer
      .locator("[name=address]")
      .fill("서울시 강남구 테스트로 123");
    await influencer.locator("[name=address_detail]").fill("101호");
    await influencer.getByRole("button", { name: "배송지 저장" }).click();
    await influencer.locator("#toast").getByText("저장되었습니다.").waitFor();
    await brand.reload();
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
      .fill("https://www.dropbox.com/s/example/video.mp4?dl=0#preview");
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
    const scheduledResponse = await brand.request.post(
      base + "/api/work/campaigns",
      {
        data: {
          title: "모집 예정 테스트",
          product: "테스트 향수",
          description: "제품 소개와 자세한 정보 https://example.com/info",
          guidelines: "영상 제작 가이드라인을 확인해 주세요.",
          capacity: 1,
          pay_type: "gifted",
          compensation: 0,
          recruit_start_date: future(1),
          recruit_date: future(2),
          draft_date: future(5),
          final_date: future(10),
        },
      },
    );
    assert.equal(scheduledResponse.status(), 201);
    const scheduled = await scheduledResponse.json();
    await influencer.goto(base + "/campaigns/" + scheduled.id);
    await influencer.getByText("모집 예정", { exact: true }).waitFor();
    assert.equal(
      await influencer
        .getByRole("button", { name: "지원하기", exact: false })
        .count(),
      0,
    );
    await influencer
      .getByRole("link", { name: "https://example.com/info", exact: false })
      .waitFor();
    await brand.goto(base + "/campaigns/" + scheduled.id);
    await brand.getByRole("button", { name: "모집 마감하기" }).waitFor();
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
    // English UI and preference persistence; creator text remains unchanged.
    await influencer.goto(base + "/campaigns/" + campaignId);
    await influencer.locator("#language-select").selectOption("en");
    await influencer.waitForFunction(
      () => document.documentElement.lang === "en",
    );
    await influencer
      .getByRole("heading", { name: "Product description", exact: true })
      .waitFor();
    await influencer
      .getByText(
        "수정된 제품 소개입니다. 촬영 전에 제품의 상세 정보를 확인해 주세요.",
        { exact: true },
      )
      .waitFor();
    await influencer.reload();
    await influencer
      .getByRole("link", { name: "My profile", exact: false })
      .waitFor();
    await influencer.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await influencer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await influencer.locator("#language-select").selectOption("ko");
    await influencer.waitForFunction(
      () => document.documentElement.lang === "ko",
    );
    await influencer.setViewportSize({ width: 1280, height: 720 });
    // Create a campaign without draft review in the actual form.
    await brand.goto(base + "/campaigns/new");
    await brand.locator("[name=title]").fill("초안 검수 없는 캠페인");
    await brand.locator("[name=product]").fill("테스트 제품");
    await brand
      .locator("[name=description]")
      .fill("초안 검수가 필요 없는 제품의 소개입니다.");
    await brand
      .locator("[name=guidelines]")
      .fill("제품을 사용한 후 최종 SNS 콘텐츠를 게시해 주세요.");
    await brand.locator("[name=review_required]").uncheck();
    assert.equal(await brand.locator("[name=draft_date]").isVisible(), false);
    await brand.locator("[name=recruit_date]").fill(future(2));
    await brand.locator("[name=final_date]").fill(future(10));
    await brand
      .getByRole("button", { name: "캠페인 등록", exact: false })
      .click();
    await brand.waitForURL(/\/campaigns\/\d+$/);
    const directCampaign = brand.url().split("/").pop();
    await influencer.goto(base + "/campaigns/" + directCampaign);
    await influencer.locator("[name=secondary_use_consent]").check();
    await influencer.locator("[name=original_delivery_consent]").check();
    await influencer
      .getByRole("button", { name: "지원하기", exact: false })
      .click();
    await influencer.waitForURL(/\/applications\/\d+$/);
    const directApp = influencer.url().split("/").pop();
    await brand.goto(base + "/applications/" + directApp);
    await brand.getByRole("button", { name: "참여자로 선정" }).click();
    await brand.locator("#confirm-accept").click();
    await brand.getByText("선정됨", { exact: true }).first().waitFor();
    await influencer.reload();
    await influencer.locator("[name=recipient_name]").fill("테스트 수령인");
    await influencer.locator("[name=postal_code]").fill("01234");
    await influencer.locator("[name=address]").fill("서울시 테스트로 123");
    await influencer.getByRole("button", { name: "배송지 저장" }).click();
    await influencer.locator("#toast").getByText("저장되었습니다.").waitFor();
    await brand.reload();
    await brand.locator("[name=carrier]").fill("CJ대한통운");
    await brand.locator("[name=tracking_number]").fill("123456789");
    await brand.getByRole("button", { name: "배송정보 등록" }).click();
    await brand.getByText("배송 중", { exact: true }).first().waitFor();
    await influencer.reload();
    await influencer.locator('form[data-action="final"]').waitFor();
    assert.equal(
      await influencer.locator('form[data-action="draft"]').count(),
      0,
    );
    await influencer.locator("#language-select").selectOption("en");
    await influencer.waitForFunction(
      () => document.documentElement.lang === "en",
    );
    await influencer
      .getByRole("button", { name: "Submit final URL", exact: false })
      .waitFor();
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
