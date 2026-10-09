async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
const form = document.querySelector("#auth-form");
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
      location.assign(data.redirect);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
const logout = document.querySelector("#logout");
if (logout)
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await request("/api/logout", {});
      location.assign("/login");
    } catch {
      logout.textContent = "다시 시도";
      logout.disabled = false;
    }
  });
const counts = document.querySelector("#user-counts");
if (counts)
  fetch("/api/admin/overview")
    .then(async (response) => {
      if (!response.ok) throw new Error("조회 실패");
      const data = await response.json(),
        labels = { admin: "운영사", brand: "브랜드", influencer: "인플루언서" };
      counts.textContent = ["admin", "brand", "influencer"]
        .map(
          (role) =>
            `${labels[role]} ${data.users.find((row) => row.role === role)?.count || 0}명`,
        )
        .join(" · ");
    })
    .catch(() => {
      counts.textContent =
        "계정 현황을 불러오지 못했습니다. 새로고침해 주세요.";
    });
