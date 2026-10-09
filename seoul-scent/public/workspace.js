(() => {
  const { t, html } = window.ScentI18n;
  const root = document.querySelector("#workspace");
  if (!root) return;
  const role = document.body.dataset.role;
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const labels = {
    applied: t("지원 완료"),
    rejected: t("반려"),
    selected: t("선정됨"),
    shipping: t("배송 중"),
    draft_submitted: t("초안 검수 대기"),
    revision_requested: t("수정 요청 중"),
    draft_approved: t("초안 승인 · 업로드 대기"),
    final_submitted: t("최종 제출 완료"),
    completed: t("완료"),
    no_show: t("노쇼 · 페널티"),
    recruiting: t("모집 중"),
    scheduled: t("모집 예정"),
    closed: t("모집 마감"),
  };
  const date = (n) =>
    new Intl.DateTimeFormat(
      window.ScentI18n.lang === "en" ? "en-US" : "ko-KR",
      {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
      },
    ).format(new Date(n));
  const datetime = (n) =>
    new Intl.DateTimeFormat(
      window.ScentI18n.lang === "en" ? "en-US" : "ko-KR",
      {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      },
    ).format(new Date(n));
  const badge = (s) =>
    `<span class="status status-${esc(s)}">${labels[s] || esc(s)}</span>`;
  const money = (n) =>
    Number(n).toLocaleString(
      window.ScentI18n.lang === "en" ? "en-US" : "ko-KR",
    );
  const link = (url, label) =>
    `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  const input = (name, label, type = "text", attrs = "", value = "") =>
    `<label>${label}<input name="${name}" type="${type}" ${attrs} value="${esc(value)}"></label>`;
  const textarea = (name, label, attrs = "", value = "") =>
    `<label>${label}<textarea name="${name}" ${attrs}>${esc(value)}</textarea></label>`;
  const error = '<p class="form-error" role="alert" hidden></p>';
  const submit = (label) =>
    `${error}<button class="primary" type="submit">${label} <span>→</span></button>`;
  const empty = (heading, message) =>
    `<div class="empty"><div class="empty-icon">◇</div><h3>${heading}</h3><p>${message}</p></div>`;
  const heading = (title, description, cta = "") =>
    `<div class="page-heading"><div><p class="eyebrow">SEOUL SCENT WORKSPACE</p><h1>${title}</h1><p class="muted">${description}</p></div>${cta}</div>`;
  const englishRequests = new Map();
  async function englishCopy(row, campaignId, summary = true) {
    if (!campaignId) return row;
    const key = JSON.stringify([
      campaignId,
      summary,
      row.title,
      row.product,
      row.description,
      row.guidelines,
    ]);
    if (!englishRequests.has(key))
      englishRequests.set(
        key,
        fetch(
          `/api/work/campaigns/${campaignId}/english${summary ? "?scope=summary" : ""}`,
        ).then(async (r) => {
          if (!r.ok) throw new Error("Translation unavailable");
          return r.json();
        }),
      );
    try {
      const data = await englishRequests.get(key);
      return {
        ...row,
        ...data.translated,
        _original: row,
        _translationUnavailable: data.unavailable.length > 0,
      };
    } catch {
      englishRequests.delete(key);
      return { ...row, _translationUnavailable: true };
    }
  }
  async function englishRows(rows, campaignList = false) {
    const result = [];
    for (const row of rows)
      result.push(
        await englishCopy(row, campaignList ? row.id : row.campaign_id),
      );
    return result;
  }
  async function api(path, method = "GET", body) {
    const response = await fetch("/api/work" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) location.assign("/login");
      throw new Error(t(data.error) || t("요청을 처리하지 못했습니다."));
    }
    if (window.ScentI18n.lang === "en" && method === "GET") {
      if (data.campaign)
        data.campaign = await englishCopy(
          data.campaign,
          data.campaign.id,
          false,
        );
      if (data.application)
        data.application = await englishCopy(
          data.application,
          data.application.campaign_id,
        );
      if (data.campaigns)
        data.campaigns = await englishRows(data.campaigns, true);
      if (data.applications)
        data.applications = await englishRows(data.applications);
    }
    return data;
  }
  function toast(message) {
    const node = document.querySelector("#toast");
    node.textContent = message;
    node.hidden = false;
    setTimeout(() => (node.hidden = true), 4000);
  }
  function confirmAction(message) {
    return new Promise((resolve) => {
      const dialog = document.querySelector("#confirm-dialog");
      document.querySelector("#confirm-message").textContent = message;
      dialog.showModal();
      const close = (answer) => {
        dialog.close();
        dialog.oncancel = null;
        resolve(answer);
      };
      document.querySelector("#confirm-accept").onclick = () => close(true);
      document.querySelector("#confirm-cancel").onclick = () => close(false);
      dialog.oncancel = (e) => {
        e.preventDefault();
        close(false);
      };
    });
  }
  const campaignStatus = (c) =>
    c.status === "recruiting" && c.recruit_start > Date.now()
      ? "scheduled"
      : c.status;
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  function linkedText(value) {
    const raw = String(value ?? "");
    let output = "",
      offset = 0;
    for (const match of raw.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      output += esc(raw.slice(offset, match.index));
      const address = match[0].replace(/[).,!?:;]+$/, "");
      try {
        const url = new URL(address);
        output +=
          url.username || url.password ? esc(address) : link(url.href, address);
      } catch {
        output += esc(address);
      }
      output += esc(match[0].slice(address.length));
      offset = match.index + match[0].length;
    }
    return output + esc(raw.slice(offset));
  }
  const campaignCard = (c) =>
    html`<article class="campaign-card">
      <div class="card-top">
        ${badge(campaignStatus(c))}<span class="muted"
          >${esc(c.brand_name)}</span
        >
      </div>
      <a href="/campaigns/${c.id}"><h3>${esc(c.title)}</h3></a>
      <p class="product">${esc(c.product)}</p>
      <p class="muted clamp">${esc(c.description)}</p>
      <div class="campaign-meta">
        <span
          >${c.pay_type === "paid" ? html`${money(c.compensation)}원` : t("제품 제공")}</span
        ><span>모집 ${c.capacity}명</span>
      </div>
      <div class="card-bottom">
        <span>모집 ${esc(c.recruit_start_date)} ~ ${esc(c.recruit_date)}</span
        ><a class="text-link" href="/campaigns/${c.id}">상세 보기 →</a>
      </div>
      ${role !== "influencer" ? html`<p class="small muted">지원 ${c.applicant_count} · 선정 ${c.selected_count} · 완료 ${c.completed_count}</p>` : ""}
    </article>`;
  const applicationCard = (a) =>
    html`<article class="campaign-card">
      <div class="card-top">
        ${badge(a.status)}${a.best ? '<span class="best">★ Best</span>' : ""}
      </div>
      <h3>${esc(a.title)}</h3>
      <p class="muted">${esc(a.brand_name)} · ${esc(a.product)}</p>
      <p class="small muted">
        ${a.review_required ? html`초안 ${esc(a.draft_date)} · ` : t("초안 검수 없음 · ")}최종 ${esc(a.final_date)}
      </p>
      ${a.feedback ? `<p class="feedback-excerpt">${esc(a.feedback)}</p>` : ""}<a
        class="primary link-button"
        href="/applications/${a.id}"
        >${{ selected: t("배송지 등록·확인"), shipping: a.review_required ? t("초안 제출하기") : t("최종 URL 제출하기"), revision_requested: t("수정 반영하기"), draft_approved: t("최종 URL 제출하기") }[a.status] || t("진행 상황 보기")}
        →</a
      >
    </article>`;
  const kpi = (label, value) =>
    `<article class="kpi"><span>${label}</span><strong>${value}</strong></article>`;
  async function dashboard() {
    const me = await (await fetch("/api/me")).json(),
      { campaigns } = await api("/campaigns");
    let main = "",
      stats = "";
    if (role === "influencer") {
      const [{ applications }, { profile }] = await Promise.all([
        api("/applications"),
        api("/profile"),
      ]);
      stats =
        kpi(
          t("참여 중"),
          applications.filter(
            (a) => !["completed", "rejected", "no_show"].includes(a.status),
          ).length,
        ) +
        kpi(t("누적 완료"), profile.completed_count) +
        kpi(t("현재 티어"), `T${profile.tier + 1}`) +
        kpi(t("노쇼 이력"), profile.no_show_count);
      main = html`${profile.blacklisted ? t('<div class="warning">누적 노쇼로 신규 캠페인 지원이 영구 제한되어 있습니다.</div>') : profile.blocked_until > Date.now() ? html`<div class="warning">${date(profile.blocked_until)}까지 신규 지원이 제한됩니다.</div>` : ""}${!profile.social_url ? t('<div class="notice">SNS 정보를 등록하면 브랜드가 선정할 때 참고할 수 있습니다. <a href="/profile">프로필 완성하기 →</a></div>') : ""}
        <div class="section-heading">
          <h2>내 캠페인</h2>
          <a href="/applications">전체 보기 →</a>
        </div>
        ${applications.length ? `<section class="campaign-grid">${applications.slice(0, 4).map(applicationCard).join("")}</section>` : empty(t("아직 참여 중인 캠페인이 없어요"), t("관심 있는 캠페인을 찾아 첫 협업을 시작해 보세요."))}
        <div class="section-heading">
          <h2>모집 중인 캠페인</h2>
          <a href="/campaigns">전체 보기 →</a>
        </div>
        <section class="campaign-grid">
          ${campaigns
            .filter((c) => campaignStatus(c) === "recruiting")
            .slice(0, 4)
            .map(campaignCard)
            .join("")}
        </section>`;
    } else {
      stats =
        kpi(t("전체 캠페인"), campaigns.length) +
        kpi(
          t("모집 중"),
          campaigns.filter((c) => campaignStatus(c) === "recruiting").length,
        ) +
        kpi(
          t("지원자"),
          campaigns.reduce((n, c) => n + c.applicant_count, 0),
        ) +
        kpi(
          t("완료 활동"),
          campaigns.reduce((n, c) => n + c.completed_count, 0),
        );
      main = html`<div class="section-heading">
          <h2>${role === "admin" ? t("전체 캠페인") : t("내 캠페인")}</h2>
          <a href="/campaigns">전체 보기 →</a>
        </div>
        ${campaigns.length ? `<section class="campaign-grid">${campaigns.slice(0, 4).map(campaignCard).join("")}</section>` : empty(t("첫 캠페인을 준비해 보세요"), t("제품과 가이드라인을 등록하면 인플루언서 모집을 시작할 수 있습니다."))}`;
      if (role === "admin") {
        const { alerts } = await api("/admin/alerts");
        main += html`<div class="section-heading">
            <h2>마감 임박 · 노쇼</h2>
          </div>
          ${
            alerts.length
              ? `<section class="panel">${alerts
                  .map(
                    (a) =>
                      html`<div class="alert-row">
                        <div>
                          ${badge(a.status)} <strong>${esc(a.name)}</strong>
                          <p>${esc(a.title)}</p>
                        </div>
                        <a class="text-link" href="/applications/${a.id}"
                          >내역 보기 →</a
                        >
                      </div>`,
                  )
                  .join("")}</section>`
              : empty(
                  t("확인할 알림이 없습니다"),
                  t("현재 마감 임박 또는 노쇼 참여자가 없습니다."),
                )
          }`;
      }
    }
    root.innerHTML =
      heading(
        html`${esc(me.user.name)}님, 안녕하세요`,
        t("오늘의 협업 현황을 확인하세요."),
        role === "brand"
          ? t(
              '<a class="primary link-button" href="/campaigns/new">+ 캠페인 만들기</a>',
            )
          : "",
      ) +
      `<section class="kpi-grid">${stats}</section>` +
      main;
  }
  async function campaigns() {
    const { campaigns } = await api("/campaigns");
    root.innerHTML =
      heading(
        role === "influencer" ? t("나에게 맞는 캠페인") : t("캠페인 관리"),
        t("브랜드와 크리에이터의 새로운 협업을 시작하세요."),
        role === "brand"
          ? t(
              '<a class="primary link-button" href="/campaigns/new">+ 캠페인 만들기</a>',
            )
          : "",
      ) +
      t(
        `<div class="toolbar"><input id="campaign-search" placeholder="캠페인·브랜드 검색" aria-label="캠페인 검색"><select id="campaign-status" aria-label="캠페인 상태"><option value="">전체 상태</option><option value="scheduled">모집 예정</option><option value="recruiting">모집 중</option><option value="closed">모집 마감</option><option value="completed">완료</option></select></div><section class="campaign-grid" id="campaign-results"></section>`,
      );
    const render = () => {
      const search = document
          .querySelector("#campaign-search")
          .value.toLowerCase(),
        status = document.querySelector("#campaign-status").value;
      const filtered = campaigns.filter(
        (c) =>
          (!status || campaignStatus(c) === status) &&
          (c.title + " " + c.brand_name).toLowerCase().includes(search),
      );
      document.querySelector("#campaign-results").innerHTML = filtered.length
        ? filtered.map(campaignCard).join("")
        : empty(
            t("캠페인이 없습니다"),
            t("검색 조건을 바꾸거나 새로운 캠페인을 등록해 주세요."),
          );
    };
    document.querySelector("#campaign-search").oninput = render;
    document.querySelector("#campaign-status").onchange = render;
    render();
  }
  function englishEditor(c = {}) {
    return `<details><summary>English campaign content (optional)</summary><p class="note left">Leave blank for automatic English translation. Enter English text to override the translation.</p>${input("title_en", "Campaign title (English)", "text", 'maxlength="400"', c.title_en || "")}${input("product_en", "Product name (English)", "text", 'maxlength="400"', c.product_en || "")}${textarea("description_en", "Product description (English)", 'maxlength="8000" rows="4"', c.description_en || "")}${textarea("guidelines_en", "Content guidelines (English)", 'maxlength="12000" rows="5"', c.guidelines_en || "")}</details>`;
  }
  function campaignForm() {
    root.innerHTML =
      heading(
        t("새 캠페인 만들기"),
        t("모집부터 최종 업로드까지의 기준을 설정해 주세요."),
      ) +
      html`<form class="panel editor" data-task="campaign">
        <h2>제품과 협업 정보</h2>
        ${input("title", t("캠페인명"), "text", 'required minlength="2" maxlength="100"')}${input("product", t("제품명"), "text", 'required minlength="2" maxlength="200"')}${input("product_url", t("제품·브랜드 링크 (선택)"), "url", 'maxlength="2000" placeholder="https://example.com/product"')}${textarea("description", t("제품 소개"), 'required minlength="10" maxlength="4000" rows="4"')}${textarea("guidelines", t("콘텐츠 가이드라인"), 'required minlength="10" maxlength="6000" rows="5"')}
        <div class="form-grid">
          ${input("capacity", t("모집 인원"), "number", 'required min="1" max="500"', "10")}<label
            >보상 유형<select name="pay_type">
              <option value="gifted">무가 · 제품 제공</option>
              <option value="paid">유가 · 제품 + 활동비</option>
            </select></label
          >${input("compensation", t("활동비 (원 · 무가일 때 0)"), "number", 'required min="0" max="100000000"', "0")}
        </div>
        <label class="check"
          ><input type="checkbox" name="review_required" checked /><span
            >초안 검수 필요 (해제하면 최종 SNS 링크만 제출)</span
          ></label
        >
        <h2>일정</h2>
        <p class="note left">
          모든 마감은 해당 날짜 종료 시점(한국 시간 자정) 기준입니다.
        </p>
        <div class="form-grid">
          ${input("recruit_start_date", t("모집 시작일"), "date", "required", today())}${input("recruit_date", t("모집 마감일"), "date", "required")}${input("draft_date", t("초안 제출 마감일"), "date", "required")}${input("final_date", t("최종 업로드 마감일"), "date", "required")}
        </div>
        ${englishEditor()}${submit(t("캠페인 등록"))}
      </form>`;
  }
  document.addEventListener("change", (event) => {
    if (event.target.name === "review_required") syncReviewFields();
  });
  function syncReviewFields() {
    document
      .querySelectorAll('input[name="review_required"]')
      .forEach((toggle) => {
        const draft = toggle.form.querySelector('[name="draft_date"]');
        if (draft) {
          draft.disabled = !toggle.checked;
          draft.required = toggle.checked;
          draft.closest("label").hidden = !toggle.checked;
        }
      });
  }
  async function campaignDetail(id) {
    const { campaign: c, applications } = await api(`/campaigns/${id}`);
    root.innerHTML =
      heading(
        esc(c.title),
        `${esc(c.brand_name)} · ${esc(c.product)}`,
        badge(campaignStatus(c)),
      ) +
      html`<section class="kpi-grid">
          ${kpi(t("모집 인원"), c.capacity)}${kpi(t("지원"), applications.length)}${kpi(t("보상"), c.pay_type === "paid" ? money(c.compensation) + t("원") : t("제품 제공"))}${kpi(t("모집 마감"), esc(c.recruit_date))}
        </section>
        <section class="panel">
          <h2>제품 소개</h2>
          <p class="preline">${linkedText(c.description)}</p>
          ${c.product_url ? `<p>${link(c.product_url, t("제품·브랜드 사이트 보기"))}</p>` : ""}
          <h3>콘텐츠 가이드라인</h3>
          <p class="preline">${linkedText(c.guidelines)}</p>
          <div class="deadline-strip">
            <span>모집 시작 <strong>${esc(c.recruit_start_date)}</strong></span
            ><span>모집 마감 <strong>${esc(c.recruit_date)}</strong></span
            >${c.review_required ? html`<span>초안 <strong>${esc(c.draft_date)}</strong></span>` : t("<span>초안 검수 없음</span>")}<span>최종 <strong>${esc(c.final_date)}</strong></span
            ><span>한국 시간 · 당일 자정 마감</span>
          </div>
        </section>`;
    if (c._translationUnavailable)
      root.innerHTML +=
        '<div class="warning">English translation is temporarily unavailable for some content. The original is shown. Please try again later or ask the brand to add English content.</div>';
    if (role === "influencer") {
      const { profile } = await api("/profile");
      root.innerHTML += applications.length
        ? html`<section class="panel">
            <h2>내 지원 상태</h2>
            ${badge(applications[0].status)}
            <a class="text-link" href="/applications/${applications[0].id}"
              >참여 내역 보기 →</a
            >
          </section>`
        : c.status !== "recruiting"
          ? t('<div class="notice">모집이 마감되었습니다.</div>')
          : campaignStatus(c) === "scheduled"
            ? html`<div class="notice">
                ${esc(c.recruit_start_date)}부터 지원할 수 있습니다.
              </div>`
            : profile.blacklisted || profile.blocked_until > Date.now()
              ? t(
                  '<div class="warning">현재 노쇼 제재로 지원할 수 없습니다.</div>',
                )
              : html`<form class="panel" data-task="apply" data-id="${id}">
                  <h2>이 캠페인에 지원하기</h2>
                  <p class="muted">
                    지원 시 연락처가 브랜드에 전달됩니다. 배송지는 선정된 뒤
                    해당 캠페인에 등록합니다.
                  </p>
                  <label class="check"
                    ><input
                      type="checkbox"
                      name="secondary_use_consent"
                      required
                    /><span
                      >[필수] 해당 캠페인에서 제작한 콘텐츠의 2차 활용에
                      동의합니다.</span
                    ></label
                  ><label class="check"
                    ><input
                      type="checkbox"
                      name="original_delivery_consent"
                      required
                    /><span
                      >[필수] 브랜드 검수 및 활용을 위해 고화질 원본 파일을 공유
                      링크로 제공하는 데 동의합니다.</span
                    ></label
                  >${submit(t("지원하기"))}
                </form>`;
    } else {
      if (c.status !== "completed") {
        const locked = applications.length > 0 || c.status !== "recruiting";
        root.innerHTML += html`<section class="panel">
          <details>
            <summary>캠페인 편집</summary>
            <form class="editor" data-task="campaign-details" data-id="${id}">
              ${input("title", t("캠페인명"), "text", 'required minlength="2" maxlength="100"', (c._original || c).title)}${input("product", t("제품명"), "text", 'required minlength="2" maxlength="200"', (c._original || c).product)}${input("product_url", t("제품·브랜드 링크 (선택)"), "url", 'maxlength="2000"', c.product_url)}${textarea("description", t("제품 소개"), 'required minlength="10" maxlength="4000" rows="4"', (c._original || c).description)}${textarea("guidelines", t("콘텐츠 가이드라인"), 'required minlength="10" maxlength="6000" rows="5"', (c._original || c).guidelines)}
              <div class="form-grid">
                ${input("capacity", t("모집 인원"), "number", 'required min="1" max="500"', c.capacity)}<label
                  >보상 유형<select name="pay_type" ${locked ? "disabled" : ""}>
                    <option
                      value="gifted"
                      ${c.pay_type === "gifted" ? "selected" : ""}
                    >
                      무가 · 제품 제공
                    </option>
                    <option
                      value="paid"
                      ${c.pay_type === "paid" ? "selected" : ""}
                    >
                      유가 · 제품 + 활동비
                    </option>
                  </select></label
                >${input("compensation", t("활동비 (원 · 무가일 때 0)"), "number", 'required min="0" max="100000000"' + (locked ? " readonly" : ""), c.compensation)}
              </div>
              <label class="check"
                ><input
                  type="checkbox"
                  name="review_required"
                  ${c.review_required ? "checked" : ""}
                  ${locked ? "disabled" : ""}
                /><span
                  >초안 검수 필요 (해제하면 최종 SNS 링크만 제출)</span
                ></label
              >
              <h3>일정</h3>
              <div class="form-grid">
                ${input("recruit_start_date", t("모집 시작일"), "date", locked ? "required readonly" : "required", c.recruit_start_date)}${input("recruit_date", t("모집 마감일"), "date", locked ? "required readonly" : "required", c.recruit_date)}${input("draft_date", t("초안 제출 마감일"), "date", locked ? "required readonly" : "required", c.draft_date)}${input("final_date", t("최종 업로드 마감일"), "date", locked ? "required readonly" : "required", c.final_date)}
              </div>
              ${locked ? t('<p class="note left">지원자가 있거나 모집이 마감되면 일정과 보상 조건은 유지됩니다. 캠페인명·제품·소개·링크·가이드라인·모집 인원은 수정할 수 있습니다.</p>') : ""}
              <p class="note left">
                모집 인원은 이미 선정된 인원보다 줄일 수 없습니다. 정보 수정 시
                진행 중인 지원자에게 알림이 전달됩니다.
              </p>
              ${englishEditor(c)}${submit(t("캠페인 수정 저장"))}
            </form>
          </details>
        </section>`;
      }
      const selected = applications.filter(
          (a) => !["applied", "rejected"].includes(a.status),
        ).length,
        review = applications.filter((a) =>
          ["draft_submitted", "final_submitted"].includes(a.status),
        ).length;
      root.innerHTML += html`<div class="section-heading">
          <h2>참여자 관리</h2>
          <span class="muted"
            >선정 ${selected}/${c.capacity} · 검수 대기 ${review}</span
          >
        </div>
        <div class="tabs" role="group" aria-label="참여자 단계">
          <button data-tab="all" class="active">전체</button
          ><button data-tab="applicants">지원자</button
          ><button data-tab="shipping">배송</button
          ><button data-tab="review">검수</button
          ><button data-tab="completed">완료</button
          ><button data-tab="no_show">노쇼</button>
        </div>
        <div id="applicants-table" class="panel table-wrap"></div>
        <section class="panel">
          <h3>배송 엑셀</h3>
          <p class="muted">
            배송지가 등록된 선정·배송 중 참여자의 정보를 내려받고 carrier,
            tracking_number 열을 입력해 업로드하세요. 송장번호 셀은 텍스트
            형식을 유지해 주세요.
          </p>
          <div class="button-row">
            <a class="secondary" href="/api/work/campaigns/${id}/shipments.xlsx"
              >배송지 XLSX 다운로드</a
            ><label class="secondary upload-label"
              >송장 XLSX 업로드<input
                id="shipping-file"
                type="file"
                accept=".xlsx"
                data-id="${id}"
            /></label>
          </div>
          <p class="form-error" id="import-error" role="alert" hidden></p>
        </section>
        <section class="panel">
          <h3>캠페인 운영</h3>
          <p>
            <a class="text-link" href="/api/work/campaigns/${id}/results.xlsx"
              >캠페인 결과 XLSX 다운로드 →</a
            >
          </p>
          ${
            c.status === "recruiting"
              ? html`<button
                  class="secondary"
                  data-campaign-action="close"
                  data-id="${id}"
                >
                  모집 마감하기
                </button>`
              : c.status === "closed"
                ? html`<button
                      class="secondary"
                      data-campaign-action="complete"
                      data-id="${id}"
                    >
                      캠페인 종료하기
                    </button>
                    <p class="note left">
                      진행 중인 활동과 미처리 지원자가 없어야 종료할 수
                      있습니다.
                    </p>`
                : t('<p class="muted">종료된 캠페인입니다.</p>')
          }
        </section>`;
      function table(tab) {
        let rows = applications.filter(
          (a) =>
            tab === "all" ||
            (tab === "applicants" &&
              ["applied", "rejected"].includes(a.status)) ||
            (tab === "shipping" &&
              ["selected", "shipping"].includes(a.status)) ||
            (tab === "review" &&
              [
                "draft_submitted",
                "revision_requested",
                "draft_approved",
                "final_submitted",
              ].includes(a.status)) ||
            (tab === "completed" && a.status === "completed") ||
            (tab === "no_show" && a.status === "no_show"),
        );
        document.querySelector("#applicants-table").innerHTML = rows.length
          ? html`<table>
              <thead>
                <tr>
                  <th>인플루언서</th>
                  <th>팔로워 · 티어</th>
                  <th>상태</th>
                  <th>활동</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (a) =>
                      html`<tr>
                        <td>
                          <strong>${esc(a.influencer_name)}</strong
                          ><small>${esc(a.influencer_email)}</small>
                        </td>
                        <td>${money(a.followers)} · T${a.tier + 1}</td>
                        <td>${badge(a.status)}${a.best ? " ★ Best" : ""}</td>
                        <td>
                          <a class="text-link" href="/applications/${a.id}"
                            >검토·관리 →</a
                          >
                        </td>
                      </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>`
          : empty(
              t("해당 단계의 참여자가 없습니다"),
              t("다른 탭에서 진행 현황을 확인해 주세요."),
            );
      }
      document.querySelectorAll("[data-tab]").forEach(
        (button) =>
          (button.onclick = () => {
            document
              .querySelectorAll("[data-tab]")
              .forEach((b) => b.classList.toggle("active", b === button));
            table(button.dataset.tab);
          }),
      );
      table("all");
    }
  }
  async function myApplications() {
    const { applications } = await api("/applications");
    root.innerHTML =
      heading(
        t("내 캠페인"),
        t("현재 단계의 작업과 브랜드 피드백을 확인하세요."),
      ) +
      (applications.length
        ? `<section class="campaign-grid">${applications.map(applicationCard).join("")}</section>`
        : empty(
            t("참여 중인 캠페인이 없습니다"),
            t("캠페인 찾기에서 첫 협업을 시작해 주세요."),
          ));
  }
  function actionForm(a, action, fields, label, confirm = "") {
    return `<form class="action-form" data-task="action" data-id="${a.id}" data-action="${action}" ${confirm ? `data-confirm="${esc(confirm)}"` : ""}>${fields}${submit(label)}</form>`;
  }
  async function applicationDetail(id) {
    const { application: a, events } = await api(`/applications/${id}`);
    const influencer = role === "influencer";
    let actions = "";
    if (influencer) {
      if (a.status === "selected")
        actions = actionForm(
          a,
          "address",
          input(
            "recipient_name",
            t("수령인"),
            "text",
            'required minlength="2" maxlength="60"',
            a.recipient_name || a.influencer_name,
          ) +
            input(
              "phone",
              t("연락처"),
              "tel",
              'required minlength="8" maxlength="30"',
              a.phone,
            ) +
            input(
              "postal_code",
              t("우편번호"),
              "text",
              'required minlength="3" maxlength="12"',
              a.postal_code,
            ) +
            input(
              "address",
              t("주소"),
              "text",
              'required minlength="5" maxlength="200"',
              a.address,
            ) +
            input(
              "address_detail",
              t("상세주소 (선택)"),
              "text",
              'maxlength="150"',
              a.address_detail,
            ),
          t("배송지 저장"),
        );

      if (
        a.review_required &&
        ["shipping", "revision_requested"].includes(a.status)
      )
        actions = actionForm(
          a,
          "draft",
          input(
            "url",
            t("검수용 초안 링크"),
            "url",
            'required placeholder="https://example.com/video"',
          ) +
            t(
              '<p class="note left">Drive, Dropbox, YouTube 등 웹 링크를 입력할 수 있습니다. 브랜드가 열어볼 수 있도록 보기 권한을 허용해 주세요.</p><label class="check"><input type="checkbox" name="public_confirmed" required> 링크 공개 보기 권한을 확인했습니다.</label>',
            ),
          a.status === "revision_requested"
            ? t("수정 초안 제출")
            : t("초안 링크 제출"),
        );
      if (
        a.status === "draft_approved" ||
        (!a.review_required && a.status === "shipping")
      )
        actions = actionForm(
          a,
          "final",
          input(
            "url",
            t("최종 SNS 게시물 URL"),
            "url",
            'required placeholder="https://www.instagram.com/reel/…"',
          ),
          t("최종 URL 제출"),
          t("콘텐츠의 SNS 게시물 URL을 최종 제출할까요?"),
        );
    } else {
      if (a.status === "applied")
        actions = `<div class="review-actions">${actionForm(a, "select", "", t("참여자로 선정"), t("이 인플루언서를 참여자로 선정할까요?"))}${actionForm(a, "reject", textarea("note", t("반려 사유 (선택)"), 'maxlength="1000"'), t("지원 반려"), t("이 지원을 반려할까요?"))}</div>`;
      if (["selected", "shipping"].includes(a.status))
        actions = !a.address
          ? t(
              '<p class="notice">선정자가 배송지를 등록하면 배송정보를 입력할 수 있습니다.</p>',
            )
          : actionForm(
              a,
              "ship",
              input(
                "carrier",
                t("택배사"),
                "text",
                'required minlength="2" maxlength="40"',
                a.carrier,
              ) +
                input(
                  "tracking_number",
                  t("송장번호"),
                  "text",
                  'required minlength="5" maxlength="40"',
                  a.tracking_number,
                ),
              t("배송정보 등록"),
            );
      if (a.status === "draft_submitted")
        actions = `<div class="review-actions">${actionForm(a, "approve", "", t("초안 승인"), t("초안을 승인하고 SNS 업로드를 요청할까요?"))}${actionForm(a, "revision", textarea("feedback", t("수정 요청 사유"), 'required minlength="5" maxlength="3000" rows="4"') + input("revision_date", t("수정 초안 제출 마감일"), "date", "required"), t("수정 요청"))}</div>`;
      if (a.status === "final_submitted")
        actions = actionForm(
          a,
          "complete",
          input(
            "views",
            t("직접 확인한 게시물 조회수"),
            "number",
            'required min="0" max="1000000000"',
            "0",
          ) +
            t(
              '<label class="check"><input type="checkbox" name="best"> 우수 활동자 · Best 태그 부여</label>',
            ),
          t("활동 완료 처리"),
          t(
            "이 활동을 완료하고 참여 횟수·티어에 반영할까요? 완료 처리는 한 번만 가능합니다.",
          ),
        );
      if (
        ["draft_submitted", "draft_approved", "final_submitted"].includes(
          a.status,
        )
      )
        actions += html`<details>
          <summary>최종 마감일 연장</summary>
          ${actionForm(a, "extend", input("final_date", t("새 최종 마감일 (캠페인 전체 적용)"), "date", "required"), t("마감 연장"), t("이 캠페인 전체 참여자의 최종 마감일을 연장할까요? 이미 발생한 제재는 취소되지 않습니다."))}
        </details>`;
    }
    const effectiveDraft =
      a.status === "revision_requested" && a.revision_due
        ? date(a.revision_due - 1)
        : esc(a.draft_date);
    root.innerHTML =
      heading(
        esc(a.title),
        `${esc(a.influencer_name)} · ${esc(a.influencer_email)}`,
        badge(a.status),
      ) +
      html`<div class="deadline-strip">
          ${a.review_required ? html`<span>초안 마감 <strong>${effectiveDraft}</strong></span>` : t("<span>초안 검수 없음</span>")}<span
            >최종 마감 <strong>${esc(a.final_date)}</strong></span
          >
        </div>
        ${a.status === "no_show" ? t('<div class="warning">제출 마감 경과로 노쇼 처리되었습니다. 지원 제한과 티어 페널티는 내 프로필에서 확인할 수 있습니다.</div>') : ""}
        <div class="detail-grid">
          <div>
            <section class="panel">
              <h2>제출 콘텐츠</h2>
              ${a.social_url ? html`<p>${link(a.social_url, t("인플루언서 SNS 프로필"))} · ${money(a.followers)} 팔로워 · T${a.tier + 1}</p>` : ""}${a.draft_url ? html`<p>초안 · ${link(a.draft_url, t("초안 링크 열기"))}</p>` : a.review_required ? t('<p class="muted">초안 링크가 아직 제출되지 않았습니다.</p>') : t('<p class="muted">초안 검수 없음</p>')}${a.final_url ? html`<p>최종 · ${link(a.final_url, t("SNS 게시물 보기"))}</p>` : ""}${a.best ? t('<span class="best">★ Best 활동</span>') : ""}${a.status === "completed" ? html`<p class="muted">브랜드 확인 조회수 ${money(a.views)}</p>` : ""}
            </section>
            <section class="panel">
              <h3>배송 정보</h3>
              <dl class="info-list">
                <dt>수령인</dt>
                <dd>${esc(a.recipient_name) || esc(a.influencer_name)}</dd>
                <dt>택배사</dt>
                <dd>${esc(a.carrier) || t("등록 전")}</dd>
                <dt>송장번호</dt>
                <dd>${esc(a.tracking_number) || t("등록 전")}${a.tracking_url ? `<p>${link(a.tracking_url, t("배송 조회"))}</p>` : ""}</dd>
                <dt>배송지</dt>
                <dd>
                  ${a.address ? `${esc(a.postal_code)} ${esc(a.address)} ${esc(a.address_detail)}` : t("선정 후 등록 대기")}
                </dd>
                <dt>연락처</dt>
                <dd>${esc(a.phone)}</dd>
              </dl>
              <p class="note left">${a.tracking_url ? t("배송 조회를 누르면 택배사 페이지가 새 탭으로 열립니다. 발송 직후에는 조회 내역이 아직 없을 수 있습니다.") : a.tracking_number ? t("이 택배사는 자동 조회 링크를 지원하지 않습니다. 택배사 홈페이지에서 송장번호로 조회해 주세요.") : t("택배사와 송장번호가 등록되면 배송 조회 링크가 표시됩니다.")}</p>
            </section>
            <section class="panel">
              <h3>동의 기록</h3>
              <p class="small muted">
                2차 활용:
                ${a.secondary_use_consent ? t("동의 완료") : t("미동의")}<br />고화질
                원본 제공:
                ${a.original_delivery_consent ? t("동의 완료") : t("미동의")}<br />${datetime(a.consent_at)}
                · ${esc(a.consent_version)}
              </p>
            </section>
          </div>
          <div>
            <section class="panel">
              <h2>현재 단계의 작업</h2>
              ${influencer ? (a.review_required ? t('<p class="notice">선정 후 배송지 등록 → 배송 시작 후 검수용 초안 링크 제출 → 초안 승인 후 최종 SNS 게시물 링크 제출 순서로 진행합니다. 각 단계가 되면 아래에 제출 버튼이 표시됩니다.</p>') : t('<p class="notice">이 캠페인은 초안 검수가 없습니다. 선정 후 배송지를 등록하고, 배송 시작 후 콘텐츠를 게시한 뒤 최종 SNS 링크를 제출해 주세요.</p>')) : ""}${
                a.feedback
                  ? html`<div class="feedback-box">
                      <strong>브랜드 수정 요청</strong>
                      <p class="preline">${esc(a.feedback)}</p>
                    </div>`
                  : ""
              }${actions || t('<p class="muted">현재 단계에서는 진행 상황을 확인해 주세요. 상태가 변경되면 알림으로 안내합니다.</p>')}
            </section>
            <section class="panel">
              <h2>협업 타임라인</h2>
              <ol class="timeline">
                ${events.map((e) => `<li>${badge(e.status)}<p class="preline">${esc(["revision_requested", "rejected"].includes(e.status) ? e.note : window.ScentI18n.message(e.note))}</p>${e.link ? link(e.link, t("당시 제출 링크")) : ""}<small>${esc(e.actor_name || t("시스템"))} · ${datetime(e.created_at)}</small></li>`).join("")}
              </ol>
            </section>
          </div>
        </div>`;
  }
  async function profile() {
    const { profile: p } = await api("/profile");
    root.innerHTML =
      heading(
        t("내 프로필"),
        t("브랜드에 전달할 연락처와 SNS 정보를 입력해 주세요."),
      ) +
      html`<section class="kpi-grid">
          ${kpi(t("현재 티어"), `T${p.tier + 1}`)}${kpi(t("완료 캠페인"), p.completed_count)}${kpi(t("누적 조회수"), money(p.total_views))}${kpi(t("노쇼"), p.no_show_count)}
        </section>
        ${p.blacklisted ? t('<div class="warning">누적 노쇼로 신규 캠페인 지원이 영구 제한됩니다.</div>') : p.blocked_until > Date.now() ? html`<div class="warning">지원 제한 종료: ${datetime(p.blocked_until)}</div>` : ""}
        <form class="panel editor" data-task="profile">
          ${input("phone", t("연락처"), "tel", 'required minlength="8" maxlength="30"', p.phone)}${input("social_url", t("대표 SNS 프로필 링크"), "url", 'required maxlength="500"', p.social_url)}${input("followers", t("현재 팔로워 수"), "number", 'required min="0" max="100000000"', p.followers)}
          <p class="note left">
            배송지는 선정된 캠페인의 참여 내역에서 입력합니다. 송장 등록 전까지
            해당 캠페인의 배송지를 수정할 수 있습니다.
          </p>
          ${submit(t("프로필 저장"))}
        </form>`;
  }
  async function notifications() {
    const { notifications } = await api("/notifications");
    root.innerHTML =
      heading(
        t("알림"),
        t("선정·검수·마감 안내를 한곳에서 확인하세요."),
        t(
          '<button class="secondary" data-read-notifications>모두 읽음</button>',
        ),
      ) +
      (notifications.length
        ? `<section class="panel">${notifications.map((n) => `<a class="notification-row ${n.read_at ? "" : "unread"}" href="${esc(n.path)}"><span class="notification-dot"></span><div><p>${esc(window.ScentI18n.message(n.message))}</p><small>${datetime(n.created_at)}</small></div><span>→</span></a>`).join("")}</section>`
        : empty(
            t("새로운 알림이 없습니다"),
            t("캠페인 상태가 바뀌면 이곳에서 확인할 수 있습니다."),
          )) +
      t(
        '<p class="note left">현재 알림은 시스템 내부에서 제공됩니다. 이메일·SMS 발송은 외부 서비스 연결 후 활성화됩니다.</p>',
      );
  }
  async function users() {
    const { users } = await api("/admin/users");
    root.innerHTML =
      heading(t("계정·티어 관리"), t("참여 이력과 노쇼 제재를 확인하세요.")) +
      t(
        '<div class="toolbar"><input id="user-search" aria-label="계정 검색" placeholder="이름·이메일 검색"></div><div class="panel table-wrap" id="user-results"></div>',
      );
    const render = () => {
      const q = document.querySelector("#user-search").value.toLowerCase(),
        rows = users.filter((u) =>
          (u.name + " " + u.email).toLowerCase().includes(q),
        );
      document.querySelector("#user-results").innerHTML = html`<table>
        <thead>
          <tr>
            <th>계정</th>
            <th>역할</th>
            <th>티어 · 완료</th>
            <th>노쇼 · 제한</th>
            <th>이력</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((u) => `<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></td><td>${{ admin: t("운영사"), brand: t("브랜드"), influencer: t("인플루언서") }[u.role]}</td><td>${u.role === "influencer" ? html`T${u.tier + 1} · ${u.completed_count}회<br />${money(u.total_views)} 조회` : "—"}</td><td>${u.role === "influencer" ? html`${u.no_show_count}회 · ${u.blacklisted ? t("영구 제한") : u.blocked_until > Date.now() ? date(u.blocked_until) + t("까지") : t("없음")}` : "—"}</td><td>${u.role === "influencer" ? html`<button class="secondary" data-history="${u.id}">이력 보기</button>${u.blacklisted || u.blocked_until > Date.now() ? html`<button class="secondary" data-release="${u.id}">제재 검토</button>` : ""}` : "—"}</td></tr>`).join("")}
        </tbody>
      </table>`;
    };
    document.querySelector("#user-search").oninput = render;
    render();
    root.insertAdjacentHTML(
      "beforeend",
      '<section id="history-results"></section>',
    );
  }
  async function settings() {
    const [{ settings: s }, { audit }] = await Promise.all([
      api("/admin/settings"),
      api("/admin/audit"),
    ]);
    root.innerHTML =
      heading(t("운영 정책"), t("노쇼와 티어 자동 갱신의 기준을 설정하세요.")) +
      html`<form
          class="panel editor"
          data-task="settings"
          data-confirm="운영 정책을 변경하고 전체 인플루언서의 티어를 재계산할까요? 기존 노쇼 이력과 이미 발생한 지원 제한은 유지됩니다."
        >
          <h2>노쇼 제재</h2>
          <div class="form-grid">
            ${input("penalty_days", t("신규 지원 제한 일수"), "number", 'required min="1" max="365"', s.penalty_days)}${input("demotion", t("노쇼당 티어 강등 단계"), "number", 'required min="1" max="2"', s.demotion)}${input("blacklist_after", t("영구 제한 누적 노쇼 횟수"), "number", 'required min="1" max="10"', s.blacklist_after)}
          </div>
          <p class="note left">
            제출 시각은 서버 시간으로 판단합니다. 검수 대기·최종 제출 완료인
            참여자는 브랜드 검수 지연만으로 노쇼 처리하지 않습니다. 수정 요청은
            별도 재제출 마감일을 사용합니다.
          </p>
          <h2>티어 기준</h2>
          <p class="muted">
            완료 횟수와 브랜드가 확인한 누적 조회수를 모두 충족해야 승급합니다.
            노쇼 누적에 따른 강등이 함께 반영됩니다.
          </p>
          ${[2, 3, 4].map((n) => `<h3>T${n}</h3><div class="form-grid">${input(`tier${n}_count`, t("최소 완료 횟수"), "number", 'required min="1"', s[`tier${n}_count`])}${input(`tier${n}_views`, t("최소 누적 조회수"), "number", 'required min="0"', s[`tier${n}_views`])}</div>`).join("")}${submit(t("운영 정책 저장"))}
        </form>
        <section class="panel">
          <h3>운영 변경 기록</h3>
          ${audit.length ? audit.map((a) => `<p class="small">${esc(a.actor_name)} · ${a.action === "settings" ? t("정책 변경") : t("지원 제한 해제")} · ${datetime(a.created_at)}</p>`).join("") : t('<p class="muted">변경 기록이 없습니다.</p>')}
        </section>`;
  }
  async function refreshCount() {
    const { unread } = await api("/notifications");
    document.querySelector("#notification-count").textContent = unread
      ? html`알림 ${unread}`
      : t("알림");
  }
  new MutationObserver(syncReviewFields).observe(root, {
    childList: true,
    subtree: true,
  });
  async function render() {
    const path = location.pathname;
    document
      .querySelectorAll(".nav-item")
      .forEach((a) =>
        a.classList.toggle(
          "nav-active",
          path === a.getAttribute("href") ||
            (a.getAttribute("href") === "/dashboard" &&
              path.startsWith("/dashboard/")),
        ),
      );
    try {
      if (path.startsWith("/dashboard")) await dashboard();
      else if (path === "/campaigns/new") campaignForm();
      else if (/^\/campaigns\/\d+$/.test(path))
        await campaignDetail(path.split("/")[2]);
      else if (path === "/campaigns") await campaigns();
      else if (path === "/applications") await myApplications();
      else if (/^\/applications\/\d+$/.test(path))
        await applicationDetail(path.split("/")[2]);
      else if (path === "/profile") await profile();
      else if (path === "/notifications") await notifications();
      else if (path === "/admin/users") await users();
      else if (path === "/admin/settings") await settings();
      else
        root.innerHTML = empty(
          t("페이지를 찾을 수 없습니다"),
          t("메뉴에서 다른 화면을 선택해 주세요."),
        );
      await refreshCount();
    } catch (e) {
      root.innerHTML =
        heading(t("화면을 불러오지 못했습니다"), esc(e.message)) +
        t('<a class="text-link" href="/dashboard">대시보드로 돌아가기 →</a>');
    }
  }
  root.addEventListener("input", (event) => {
    const field = event.target,
      action = field.form?.dataset.action;
    if (field.name !== "url" || !["draft", "final"].includes(action)) return;
    let valid = false;
    try {
      const url = new URL(field.value),
        host = url.hostname.replace(/^www\./, "");
      valid =
        (action === "draft" ? ["http:", "https:"] : ["https:"]).includes(
          url.protocol,
        ) &&
        !url.username &&
        !url.password &&
        (action === "draft" ||
          ({
            "instagram.com": /^\/(p|reel|tv)\/[^/]+/,
            "youtube.com": /^\/(watch|shorts\/[^/]+)/,
            "youtu.be": /^\/[^/]+/,
            "tiktok.com": /^\/@[^/]+\/video\/\d+/,
            "facebook.com": /^\/.+/,
            "x.com": /^\/[^/]+\/status\/\d+/,
          }[host]?.test(url.pathname) &&
            !(
              host === "youtube.com" &&
              url.pathname === "/watch" &&
              !url.searchParams.get("v")
            )));
    } catch {}
    field.setCustomValidity(
      !field.value || valid
        ? ""
        : action === "draft"
          ? t("올바른 HTTP/HTTPS 웹 링크를 입력해 주세요.")
          : t("지원되는 SNS 게시물 링크를 입력해 주세요."),
    );
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form.dataset.task) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit]"),
      errorNode = form.querySelector(".form-error");
    errorNode.hidden = true;
    if (form.dataset.confirm && !(await confirmAction(form.dataset.confirm)))
      return;
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      form
        .querySelectorAll("[type=number]")
        .forEach((n) => (data[n.name] = Number(n.value)));
      form
        .querySelectorAll("[type=checkbox]:not(:disabled)")
        .forEach((n) => (data[n.name] = n.checked));
      switch (form.dataset.task) {
        case "campaign": {
          const r = await api("/campaigns", "POST", data);
          location.assign("/campaigns/" + r.id);
          return;
        }
        case "campaign-details":
          await api(`/campaigns/${form.dataset.id}/details`, "PUT", data);
          break;
        case "apply": {
          const r = await api(
            `/campaigns/${form.dataset.id}/apply`,
            "POST",
            data,
          );
          location.assign("/applications/" + r.id);
          return;
        }
        case "profile":
          await api("/profile", "PUT", data);
          break;
        case "settings":
          await api("/admin/settings", "PUT", data);
          break;
        case "release":
          await api(`/admin/users/${form.dataset.id}/release`, "POST", data);
          break;
        case "action":
          await api(`/applications/${form.dataset.id}/action`, "POST", {
            ...data,
            action: form.dataset.action,
          });
          break;
      }
      toast(t("저장되었습니다."));
      await render();
    } catch (e) {
      errorNode.textContent = e.message;
      errorNode.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.campaignAction) {
        if (
          !(await confirmAction(
            button.dataset.campaignAction === "close"
              ? t("새 지원을 받지 않도록 모집을 마감할까요?")
              : t("모든 활동을 확인하고 캠페인을 종료할까요?"),
          ))
        )
          return;
        button.disabled = true;
        await api(
          `/campaigns/${button.dataset.id}/${button.dataset.campaignAction}`,
          "POST",
          {},
        );
        toast(t("처리되었습니다."));
        await render();
      }
      if (button.hasAttribute("data-read-notifications")) {
        await api("/notifications/read", "POST", {});
        await render();
      }
      if (button.dataset.release) {
        document.querySelector("#history-results").innerHTML = html`<form
          class="panel editor"
          data-task="release"
          data-id="${button.dataset.release}"
          data-confirm="이 인플루언서의 지원 제한을 해제할까요? 노쇼 이력과 티어 강등 기록은 유지됩니다."
        >
          <h2>지원 제한 검토</h2>
          ${textarea("note", t("해제 사유"), 'required minlength="5" maxlength="1000" rows="3"')}
          <p class="note left">
            해제 사유와 운영사 계정이 기록됩니다. 다음 노쇼 발생 시 기존 누적
            횟수에 따라 다시 제재됩니다.
          </p>
          ${submit(t("지원 제한 해제"))}
        </form>`;
        document
          .querySelector("#history-results")
          .scrollIntoView({ behavior: "smooth" });
      }
      if (button.dataset.history) {
        const { applications } = await api(
          `/admin/users/${button.dataset.history}/history`,
        );
        document.querySelector("#history-results").innerHTML = html`<div
            class="section-heading"
          >
            <h2>참여 이력</h2>
          </div>
          <section class="panel">
            ${
              applications.length
                ? applications
                    .map(
                      (a) =>
                        html`<div class="alert-row">
                          <div>
                            ${badge(a.status)} <strong>${esc(a.title)}</strong>
                            <p class="muted">
                              ${esc(a.brand_name)} · ${a.views}
                              조회${a.best ? " · Best" : ""}
                            </p>
                          </div>
                          <a class="text-link" href="/applications/${a.id}"
                            >상세 →</a
                          >
                        </div>`,
                    )
                    .join("")
                : empty(
                    t("참여 이력이 없습니다"),
                    t("아직 지원한 캠페인이 없습니다."),
                  )
            }
          </section>`;
        document
          .querySelector("#history-results")
          .scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      toast(e.message);
    } finally {
      button.disabled = false;
    }
  });
  root.addEventListener("change", async (event) => {
    const input = event.target;
    if (input.id !== "shipping-file" || !input.files[0]) return;
    const file = input.files[0],
      node = document.querySelector("#import-error");
    node.hidden = true;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error(t("2MB 이하 XLSX 파일을 선택해 주세요."));
      if (
        !(await confirmAction(
          t(
            "파일의 송장정보를 일괄 등록할까요? 모든 행이 유효할 때만 반영합니다.",
          ),
        ))
      )
        return;
      input.disabled = true;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { imported } = await api(
        `/campaigns/${input.dataset.id}/shipments/import`,
        "POST",
        { file: base64 },
      );
      toast(html`${imported}건의 송장이 등록되었습니다.`);
      await render();
    } catch (e) {
      node.textContent = e.message;
      node.hidden = false;
    } finally {
      input.disabled = false;
      input.value = "";
    }
  });
  render();
})();
