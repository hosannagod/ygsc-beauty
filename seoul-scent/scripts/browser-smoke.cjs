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
      EMAIL_PROVIDER: "none",
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
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() + n * 86400000));
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
    await brand
      .getByText("English campaign content (optional)", { exact: true })
      .click();
    await brand.locator("[name=title_en]").fill("Air Mood influencer campaign");
    await brand.locator("[name=product_en]").fill("Air Mood skincare");
    await brand
      .locator("[name=description_en]")
      .fill("Air Mood skincare collaboration details.");
    await brand
      .locator("[name=guidelines_en]")
      .fill("Show the product and follow these filming guidelines.");
    const photoBuffer = require("node:fs").readFileSync(
      "tests/fixtures/campaign-photo.jpg",
    );
    await brand.locator("[data-campaign-photos]").setInputFiles(
      Array.from({ length: 4 }, (_, i) => ({
        name: `product-${i}.jpg`,
        mimeType: "image/jpeg",
        buffer: photoBuffer,
      })),
    );
    await brand.waitForFunction(
      () => document.querySelectorAll(".photo-preview").length === 4,
    );
    await brand.getByRole("button", { name: "캠페인 등록" }).click();
    await brand.waitForURL(/\/campaigns\/\d+$/);
    const campaignId = brand.url().split("/").pop();
    await brand.waitForFunction(
      () => document.querySelectorAll(".campaign-gallery img").length === 4,
    );
    assert.ok(
      await brand
        .locator(".campaign-gallery img")
        .first()
        .evaluate(async (img) => {
          await img.decode();
          return img.naturalWidth > 0;
        }),
    );
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
    await brand.locator('.photo-editor [data-remove-photo="0"]').click();
    await brand
      .locator('form[data-task="campaign-details"] [name=product_url]')
      .fill("https://example.com/updated");
    await brand
      .locator('form[data-task="campaign-details"] [name=description]')
      .fill(
        "수정된 제품 소개입니다. 촬영 전에 제품의 상세 정보를 확인해 주세요.",
      );
    await brand
      .locator('form[data-task="campaign-details"] details summary')
      .click();
    await brand
      .locator("[name=description_en]")
      .fill("Updated product information. Please review before filming.");
    await brand.getByRole("button", { name: "캠페인 수정 저장" }).click();
    await brand.locator('a[href="https://example.com/updated"]').waitFor();
    assert.equal(
      await brand
        .getByRole("link", { name: "제품·브랜드 사이트 보기" })
        .getAttribute("href"),
      "https://example.com/updated",
    );
    await influencer.goto(base + "/campaigns/" + campaignId);
    await influencer
      .getByRole("heading", { name: "프로필 등록이 필요합니다" })
      .waitFor();
    assert.equal(await influencer.locator('[data-task="apply"]').count(), 0);
    await influencer.locator('.nav-item[href="/profile"]').click();
    const profileInfo = influencer.getByRole("button", {
      name: "등급 기준 안내",
    });
    await profileInfo.waitFor();
    const profileTooltip = influencer.locator("[role=tooltip]");
    assert.equal(await profileTooltip.isVisible(), false);
    await profileInfo.click();
    await profileTooltip.waitFor({ state: "visible" });
    await profileInfo.click();
    await profileTooltip.waitFor({ state: "hidden" });
    await profileInfo.click();
    await profileTooltip.waitFor({ state: "visible" });
    await influencer
      .getByRole("heading", { name: "내 프로필", exact: true })
      .click();
    await profileTooltip.waitFor({ state: "hidden" });
    await profileInfo.click();
    await profileTooltip.waitFor({ state: "visible" });
    await influencer.keyboard.press("Escape");
    await profileTooltip.waitFor({ state: "hidden" });
    await influencer.setViewportSize({ width: 390, height: 844 });
    await profileInfo.click();
    await profileTooltip.waitFor({ state: "visible" });
    await profileInfo.click();
    await profileTooltip.waitFor({ state: "hidden" });
    await influencer.setViewportSize({ width: 1280, height: 720 });

    await influencer.locator("[name=phone]").fill("01012345678");

    await influencer
      .locator("[name=social_url]")
      .fill("https://www.instagram.com/seoulcreator");
    await influencer.locator("[name=followers]").fill("12000");
    await influencer.getByRole("button", { name: "프로필 저장" }).click();
    await influencer.locator("#toast").getByText("저장되었습니다.").waitFor();
    const admin = await browser.newPage();
    admin.on("pageerror", (e) => errors.push(e.message));
    await admin.goto(base + "/login");
    await admin.locator("[name=email]").fill("admin@example.test");
    await admin.locator("[name=password]").fill(password);
    await admin.getByRole("button", { name: "로그인", exact: false }).click();
    await admin.waitForURL("**/dashboard/admin");
    await admin.goto(base + "/admin/users");
    const memberName = await admin
      .locator("#user-results tbody tr strong")
      .first()
      .innerText();
    const listToggle = admin.locator("[data-toggle-users]");
    await listToggle.click();
    assert.equal(await admin.locator("#user-results").isVisible(), false);
    assert.equal(await listToggle.getAttribute("aria-expanded"), "false");
    await listToggle.click();
    assert.equal(await admin.locator("#user-results").isVisible(), true);
    await admin.locator("[data-history]").first().click();
    const memberDialog = admin.locator("#influencer-detail");
    await memberDialog.waitFor({ state: "visible" });
    assert.equal(await memberDialog.locator("h2").innerText(), memberName);
    assert.ok(
      (await memberDialog.locator(".influencer-fields").innerText()).includes(
        "https://www.instagram.com/seoulcreator",
      ),
    );
    assert.equal(await admin.locator("#history-results").innerText(), "");
    await memberDialog.getByText("프로필 정보 수정", { exact: true }).click();
    const profileEditor = memberDialog.locator(
      'form[data-task="admin-profile"]',
    );
    await profileEditor
      .locator("[name=social_url]")
      .fill("https://www.tiktok.com/@seoulcreator");
    await profileEditor.locator("[name=followers]").fill("15000");
    await profileEditor.getByRole("button", { name: "프로필 저장" }).click();
    await memberDialog.waitFor({ state: "hidden" });
    await admin.locator("[data-history]").first().click();
    await memberDialog.waitFor({ state: "visible" });
    assert.ok(
      (await memberDialog.locator(".influencer-fields").innerText()).includes(
        "https://www.tiktok.com/@seoulcreator",
      ),
    );
    assert.ok(
      (await memberDialog.locator(".influencer-fields").innerText()).includes(
        "15,000",
      ),
    );
    await memberDialog.locator("[data-close-influencer]").click();
    assert.equal(await memberDialog.isVisible(), false);
    await admin.locator("[data-history]").first().click();
    await memberDialog.waitFor({ state: "visible" });
    await admin.keyboard.press("Escape");
    assert.equal(await memberDialog.isVisible(), false);
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.locator("[data-history]").first().click();
    await memberDialog.waitFor({ state: "visible" });
    assert.ok(
      await memberDialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await memberDialog.locator("[data-close-influencer]").click();
    await admin.setViewportSize({ width: 1280, height: 720 });
    await admin
      .locator('form[data-task="promotion-image"] input[type=file]')
      .setInputFiles({
        name: "promotion.jpg",
        mimeType: "image/jpeg",
        buffer: photoBuffer,
      });
    await admin.getByRole("button", { name: "홍보 이미지 저장" }).click();
    await admin.getByRole("link", { name: "현재 홍보 이미지 보기" }).waitFor();
    await influencer.goto(base + "/campaigns/" + campaignId);
    await influencer
      .getByRole("heading", { name: "브론즈 홍보 인증이 필요합니다" })
      .waitFor();
    await influencer.getByRole("link", { name: "홍보 인증하기" }).click();
    await influencer
      .locator('form[data-task="onboarding"] [name=url]')
      .fill("https://instagram.com/p/promotion-proof");
    await influencer
      .getByRole("link", { name: "홍보 이미지 다운로드" })
      .waitFor();
    await influencer
      .locator('form[data-task="onboarding"] input[type=file]')
      .setInputFiles({
        name: "story-proof.jpg",
        mimeType: "image/jpeg",
        buffer: photoBuffer,
      });
    await influencer
      .locator('form[data-task="onboarding"] [name=confirmation]')
      .check();
    await influencer.getByRole("button", { name: "홍보 인증 제출" }).click();
    await influencer
      .getByText("운영사가 제출 자료를 확인하고 있습니다.")
      .waitFor();
    await admin.goto(base + "/admin/users");
    await admin.getByAltText("홍보 인증 스크린샷").evaluate(async (img) => {
      await img.decode();
      if (!img.naturalWidth) throw new Error("Proof image failed to load");
    });
    await admin
      .locator('form[data-task="onboarding-review"]')
      .getByRole("button", { name: "검토 결과 저장" })
      .click();
    await admin.getByText(/· 승인 완료/).waitFor();
    const approvedProfile = await (
      await influencer.request.get(base + "/api/work/profile")
    ).json();
    assert.equal(approvedProfile.profile.onboarding_approved, 1);
    assert.equal(approvedProfile.profile.completed_count, 0);
    const initialCertificate = await (
      await influencer.request.get(base + "/api/work/certificate")
    ).json();
    assert.equal(initialCertificate.eligible, false);
    await influencer.goto(base + "/campaigns/" + campaignId);
    await influencer.waitForFunction(
      () => document.querySelectorAll(".campaign-gallery img").length === 3,
    );
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
    await brand.getByRole("link", { name: "최종 선정하러 가기" }).click();
    await brand.locator("[data-select-applicant]").check();
    const pendingSelection = await (
      await brand.request.get(base + "/api/work/campaigns/" + campaignId)
    ).json();
    assert.equal(
      pendingSelection.applications.filter((a) => a.status === "selected")
        .length,
      0,
    );
    await brand
      .getByRole("button", { name: "최종 선정", exact: false })
      .click();
    await brand.locator("#confirm-accept").click();
    await brand.getByText("선정됨", { exact: true }).first().waitFor();
    await brand.goto(base + "/applications/" + appId);
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
      .getByRole("link", { name: "배송 조회", exact: false })
      .waitFor();
    assert.equal(
      await influencer
        .getByRole("link", { name: "배송 조회", exact: false })
        .getAttribute("href"),
      "https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=00123456789",
    );
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
    await influencer.getByRole("button", { name: "활동증명서 발급" }).click();
    await influencer.waitForURL(/\/certificates\//);
    await influencer
      .getByRole("heading", { name: "Certificate of Participation" })
      .waitFor();
    const certificatePdf = await influencer.pdf({ format: "A4" });
    assert.equal(certificatePdf.subarray(0, 4).toString(), "%PDF");
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
    await admin.goto(base + "/dashboard/admin");
    await admin
      .getByRole("heading", { name: "전체 캠페인", exact: true })
      .waitFor();
    await admin.screenshot({ path: tmp + "/dashboard.png", fullPage: true });
    await admin.getByRole("link", { name: "인플루언서·등급관리" }).click();
    await admin.getByRole("heading", { name: "인플루언서·등급관리" }).waitFor();
    assert.equal(await admin.locator("#user-role").inputValue(), "influencer");
    await admin.locator("#user-grade").selectOption("basic");
    assert.equal(
      await admin.getByRole("button", { name: "이력 보기" }).count(),
      0,
    );
    await admin.locator("#user-grade").selectOption("all");
    await admin.locator("#user-search").fill("01012345678");
    await admin.getByRole("button", { name: "이력 보기" }).waitFor();
    await admin.locator("#user-search").fill("");
    await admin.getByRole("button", { name: "이력 보기" }).click();
    await admin.locator("#influencer-detail").waitFor({ state: "visible" });
    await admin.locator("#influencer-detail [data-close-influencer]").click();
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
      .getByText("Updated product information. Please review before filming.", {
        exact: true,
      })
      .waitFor();
    await influencer
      .getByRole("heading", {
        name: "Air Mood influencer campaign",
        exact: true,
      })
      .waitFor();
    await influencer
      .getByText("Show the product and follow these filming guidelines.", {
        exact: true,
      })
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
    await brand
      .getByText("English campaign content (optional)", { exact: true })
      .click();
    await brand.locator("[name=title_en]").fill("No review campaign");
    await brand.locator("[name=product_en]").fill("Test skincare product");
    await brand
      .locator("[name=description_en]")
      .fill("Campaign without a draft review step.");
    await brand
      .locator("[name=guidelines_en]")
      .fill("Publish your final content after receiving the product.");
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
    await brand.getByRole("link", { name: "최종 선정하러 가기" }).click();
    await brand.locator("[data-select-applicant]").check();
    await brand
      .getByRole("button", { name: "최종 선정", exact: false })
      .click();
    await brand.locator("#confirm-accept").click();
    await brand.getByText("선정됨", { exact: true }).first().waitFor();
    await brand.goto(base + "/applications/" + directApp);
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
    for (const [page, role] of [
      [brand, "brand"],
      [influencer, "influencer"],
    ]) {
      await page.goto(base + "/account");
      await page.locator("[name=current_password]").waitFor();
      const email = `updated-${role}@example.test`;
      await page.locator("[name=email]").fill(email);
      await page.locator("[name=phone]").fill("01099998888");
      await page.locator("[name=current_password]").fill(password);
      await page
        .locator("[name=new_password]")
        .fill("Updated-browser-password-123!");
      await page
        .locator("[name=confirm_password]")
        .fill("Updated-browser-password-123!");
      await Promise.all([
        page.waitForNavigation(),
        page.locator("form[data-task=account] button[type=submit]").click(),
      ]);
      await page.locator("[name=email]").waitFor();
      assert.equal(await page.locator("[name=email]").inputValue(), email);
      assert.equal(
        await page.locator("[name=current_password]").inputValue(),
        "",
      );
      const result = await page.request.get(base + "/api/me");
      assert.equal((await result.json()).user.email, email);
      if (role === "influencer") {
        const profile = await page.request.get(base + "/api/work/profile");
        assert.equal((await profile.json()).profile.phone, "01099998888");
      }
    }
    const importBook = new (require("exceljs").Workbook)(),
      importSheet = importBook.addWorksheet("responses");
    importSheet.addRow([
      "Name / 이름",
      "Email / 이메일",
      "연락처(Contact number)",
      "Profile URL / 채널 링크",
      "Current follower count on this channel / 해당 채널 팔로워 수",
    ]);
    importSheet.addRow([
      "Imported Creator",
      "imported@example.test",
      "01012345678",
      "https://instagram.com/imported",
      2500,
    ]);
    await admin.goto(base + "/admin/users");
    await admin
      .locator('form[data-task="influencer-import"] input[type=file]')
      .setInputFiles({
        name: "responses.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await importBook.xlsx.writeBuffer()),
      });
    await admin
      .locator('form[data-task="influencer-import"]')
      .getByRole("button", { name: "검토 후 등록" })
      .click();
    await admin.locator("#confirm-accept").click();
    await admin
      .locator("#influencer-import-result")
      .getByText(/등록 완료: 1/)
      .waitFor();
    assert.equal(
      await admin
        .locator("#user-stats .kpi")
        .first()
        .locator("strong")
        .innerText(),
      "2",
    );
    const importedPage = await browser.newPage();
    importedPage.on("pageerror", (e) => errors.push(e.message));
    await importedPage.goto(base + "/login");
    await importedPage.locator("[name=email]").fill("imported@example.test");
    await importedPage.locator("[name=password]").fill("0000");
    await importedPage
      .getByRole("button", { name: "로그인", exact: false })
      .click();
    await importedPage.waitForURL("**/account");
    await importedPage.locator("[name=current_password]").waitFor();
    assert.equal(
      (await importedPage.request.get(base + "/api/work/campaigns")).status(),
      403,
    );
    await importedPage.locator("[name=current_password]").fill("0000");
    await importedPage
      .locator("[name=new_password]")
      .fill("Imported-new-password-123!");
    await importedPage
      .locator("[name=confirm_password]")
      .fill("Imported-new-password-123!");
    await Promise.all([
      importedPage.waitForNavigation(),
      importedPage
        .locator("form[data-task=account] button[type=submit]")
        .click(),
    ]);
    assert.equal(
      (await importedPage.request.get(base + "/api/work/campaigns")).status(),
      200,
    );
    const historyBook = new (require("exceljs").Workbook)();
    for (const project of [
      "Aeluri Formula",
      "뷰티비티",
      "두유본색",
      "로레코",
    ]) {
      const sheet = historyBook.addWorksheet(project);
      sheet.addRow(["이메일", "올린 링크", "제출일시"]);
      sheet.addRow([
        "imported@example.test",
        "https://instagram.com/p/history",
        "2026-09-01",
      ]);
      sheet.addRow([
        "imported@example.test",
        "https://tiktok.com/@imported/video/123",
        "2026-09-02",
      ]);
    }
    await admin
      .locator('form[data-task="activity-import"] input[type=file]')
      .setInputFiles({
        name: "history.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await historyBook.xlsx.writeBuffer()),
      });
    await admin
      .locator('form[data-task="activity-import"]')
      .getByRole("button", { name: "검토 후 등록" })
      .click();
    await admin.locator("#confirm-accept").click();
    await admin
      .locator("#activity-import-result")
      .getByText(/등록 완료: 4/)
      .waitFor();
    await importedPage.goto(base + "/profile");
    await importedPage
      .getByRole("heading", { name: "기존 프로젝트 이력" })
      .waitFor();
    const importedProfile = await (
      await importedPage.request.get(base + "/api/work/profile")
    ).json();
    assert.equal(importedProfile.profile.completed_count, 4);
    assert.equal(importedProfile.history.length, 4);
    assert.equal(importedProfile.history[0].links.length, 2);
    const batchResponse = await brand.request.post(
      base + "/api/work/campaigns",
      {
        data: {
          title: "다중 선정 테스트",
          product: "Test product",
          description: "Test product description",
          guidelines: "Test filming guidelines",
          capacity: 2,
          pay_type: "gifted",
          compensation: 0,
          recruit_date: future(2),
          draft_date: future(5),
          final_date: future(10),
        },
      },
    );
    assert.equal(batchResponse.status(), 201);
    const batchCampaign = (await batchResponse.json()).id;
    for (const page of [influencer, importedPage])
      assert.equal(
        (
          await page.request.post(
            base + `/api/work/campaigns/${batchCampaign}/apply`,
            {
              data: {
                secondary_use_consent: true,
                original_delivery_consent: true,
              },
            },
          )
        ).status(),
        201,
      );
    await brand.goto(base + "/campaigns/" + batchCampaign);
    await brand.getByRole("button", { name: "등급 기준 안내" }).click();
    await brand
      .getByRole("tooltip")
      .getByText(/브론즈: 홍보 승인 또는 완료 1회/)
      .waitFor();
    await brand.keyboard.press("Escape");
    await brand.getByRole("button", { name: "참여 횟수 안내" }).click();
    await brand
      .getByRole("tooltip")
      .getByText(/완료 횟수에는 기존 프로젝트 이력이 포함됩니다/)
      .waitFor();
    await brand.keyboard.press("Escape");
    await brand
      .getByRole("button", { name: "미선정 지원자 전체 선택" })
      .click();
    assert.equal(
      await brand.locator("[data-select-applicant]:checked").count(),
      2,
    );
    await brand.reload();
    await brand.locator("[data-select-applicant]:checked").last().waitFor();
    assert.equal(
      await brand.locator("[data-select-applicant]:checked").count(),
      2,
    );
    assert.equal(
      (
        await (
          await brand.request.get(base + "/api/work/campaigns/" + batchCampaign)
        ).json()
      ).applications.filter((a) => a.status === "selected").length,
      0,
    );
    await brand
      .getByRole("button", { name: "최종 선정", exact: false })
      .click();
    await brand.locator("#confirm-accept").click();
    await brand.getByText("선정됨", { exact: true }).last().waitFor();
    assert.equal(
      (
        await (
          await brand.request.get(base + "/api/work/campaigns/" + batchCampaign)
        ).json()
      ).applications.filter((a) => a.status === "selected").length,
      2,
    );
    assert.equal(await brand.locator("[data-delete-campaign]").count(), 0);
    await admin.goto(base + "/campaigns/" + batchCampaign);
    await admin
      .locator('[data-task="campaign-capacity"] [name=capacity]')
      .fill("8");
    await admin.getByRole("button", { name: "선정 정원 저장" }).click();
    await admin.locator("#toast").getByText("저장되었습니다.").waitFor();
    assert.equal(
      (
        await (
          await admin.request.get(base + "/api/work/campaigns/" + batchCampaign)
        ).json()
      ).campaign.capacity,
      8,
    );
    await admin
      .getByRole("button", { name: "캠페인 삭제", exact: true })
      .click();
    await admin.locator("#confirm-cancel").click();
    assert.equal(
      (
        await admin.request.get(base + "/api/work/campaigns/" + batchCampaign)
      ).status(),
      200,
    );
    await admin
      .getByRole("button", { name: "캠페인 삭제", exact: true })
      .click();
    await admin.locator("#confirm-accept").click();
    await admin.waitForURL("**/campaigns");
    assert.equal(
      (
        await admin.request.get(base + "/api/work/campaigns/" + batchCampaign)
      ).status(),
      404,
    );
    const visibleCampaigns = (
      await (await admin.request.get(base + "/api/work/campaigns")).json()
    ).campaigns;
    assert.ok(!visibleCampaigns.some((c) => c.id === batchCampaign));
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
    assert.equal(
      restored.prepare("SELECT COUNT(*) AS n FROM campaign_images").get().n,
      3,
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
