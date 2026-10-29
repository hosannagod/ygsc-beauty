const { t, html } = window.ScentI18n;
async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(t(data.error) || t("요청을 처리하지 못했습니다."));
  return data;
}
const form = document.querySelector("#auth-form");
const campaignParam = new URLSearchParams(location.search).get("campaign");
const campaignId = campaignParam && /^[1-9]\d{0,8}$/.test(campaignParam) ? campaignParam : null;
if (campaignId) {
  const registerLink = document.querySelector('.auth-register-cta[href="/register"]');
  if (registerLink) registerLink.href = `/register?campaign=${campaignId}`;
}
if (form)
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button"),
      error = document.querySelector("#form-error");
    button.disabled = true;
    error.hidden = true;
    try {
      const data = await request(
        `/api/${form.dataset.mode}`,
        Object.fromEntries(new FormData(form)),
      );
      location.assign(campaignId && data.user?.role === "influencer" ? `/campaigns/${campaignId}` : data.redirect);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
const resetRequestForm = document.querySelector("#reset-request-form");
if (resetRequestForm)
  resetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = resetRequestForm.querySelector("button"),
      error = document.querySelector("#form-error"),
      success = document.querySelector("#form-success");
    button.disabled = true;
    error.hidden = true;
    success.hidden = true;
    try {
      await request("/api/password-reset/request", {
        email: resetRequestForm.elements.email.value,
      });
      success.textContent = t(
        "계정에 등록된 이메일이라면 재설정 링크를 보냈습니다. 받은편지함과 스팸함을 확인해 주세요.",
      );
      success.hidden = false;
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
const resetForm = document.querySelector("#password-reset-form");
if (resetForm) {
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  history.replaceState(null, "", location.pathname);
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = resetForm.querySelector("button"),
      error = document.querySelector("#form-error");
    button.disabled = true;
    error.hidden = true;
    try {
      await request("/api/password-reset/confirm", {
        token,
        new_password: resetForm.elements.new_password.value,
        confirm_password: resetForm.elements.confirm_password.value,
      });
      location.assign("/login");
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
}
const logout = document.querySelector("#logout");
if (logout)
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await request("/api/logout", {});
      location.assign("/login");
    } catch {
      logout.textContent = t("다시 시도");
      logout.disabled = false;
    }
  });
const counts = document.querySelector("#user-counts");
if (counts)
  fetch("/api/admin/overview")
    .then(async (response) => {
      if (!response.ok) throw new Error(t("조회 실패"));
      const data = await response.json(),
        labels = {
          admin: t("운영사"),
          brand: t("브랜드"),
          influencer: t("인플루언서"),
        };
      counts.textContent = ["admin", "brand", "influencer"]
        .map(
          (role) =>
            html`${labels[role]}
            ${data.users.find((row) => row.role === role)?.count || 0}명`,
        )
        .join(" · ");
    })
    .catch(() => {
      counts.textContent = t(
        "계정 현황을 불러오지 못했습니다. 새로고침해 주세요.",
      );
    });

if (form?.dataset.mode === "register") {
  if (campaignId) {
    form.querySelector('[name=role][value=influencer]').checked = true;
    const login = document.querySelector('.switch a[href="/login"]');
    if (login) login.href = `/login?campaign=${campaignId}`;
  }
  const update = () => {
    const brand = form.querySelector("[name=role]:checked").value === "brand";
    for (const [id, active] of [
      ["brand-fields", brand],
      ["influencer-fields", !brand],
    ]) {
      const section = document.getElementById(id);
      section.hidden = !active;
      section.querySelectorAll("input").forEach((input) => {
        input.disabled = !active;
        input.required = active;
      });
    }
  };
  form
    .querySelectorAll("[name=role]")
    .forEach((input) => input.addEventListener("change", update));
  update();
}
