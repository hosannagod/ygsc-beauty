import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
const password = "Test-password-123!";
for (const role of ["brand", "influencer"])
  test(`${role} account editing verifies current password, preserves role and revokes other sessions`, async () => {
    const { db, app } = setup();
    const account = {
      role,
      name: "테스트 성함",
      brand_name: "테스트 브랜드",
      contact_name: "담당자 이름",
      phone: "01012345678",
      email: `${role}@edit.test`,
      password,
    };
    try {
      assert.equal((await post(app, "/api/register", account)).status, 201);
      const login = async (email = account.email, pwd = password) =>
        post(app, "/api/login", { email, password: pwd });
      const first = await login(),
        second = await login();
      let cookie = first.headers.get("set-cookie")!.split(";")[0];
      const other = second.headers.get("set-cookie")!.split(";")[0];
      const put = (data: any, cookieValue = cookie) =>
        app.request("/api/account", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookieValue },
          body: JSON.stringify(data),
        });
      assert.equal((await app.request("/api/account")).status, 401);
      assert.equal(
        (await app.request("/account", { headers: { Cookie: cookie } })).status,
        200,
      );
      const before = (await (
        await app.request("/api/account", { headers: { Cookie: cookie } })
      ).json()) as any;
      assert.ok(!("password_hash" in before.account));
      assert.equal(
        (await put({ phone: "01099998888", current_password: "wrong" })).status,
        400,
      );
      assert.equal(
        (
          await put({
            phone: "01099998888",
            current_password: password,
            new_password: "too-short",
            confirm_password: "too-short",
          })
        ).status,
        400,
      );
      const nextPassword = "Changed-password-456!",
        nextEmail = `updated-${role}@edit.test`;
      const response = await put({
        name: "변경 성함",
        brand_name: "변경 브랜드",
        contact_name: "변경 담당자",
        email: nextEmail,
        phone: "01099998888",
        current_password: password,
        new_password: nextPassword,
        confirm_password: nextPassword,
        role: "admin",
        id: 999,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const current = response.headers.get("set-cookie")!.split(";")[0];
      assert.equal(
        (await app.request("/api/me", { headers: { Cookie: cookie } })).status,
        401,
      );
      assert.equal(
        (await app.request("/api/me", { headers: { Cookie: other } })).status,
        401,
      );
      const saved = (await (
        await app.request("/api/account", { headers: { Cookie: current } })
      ).json()) as any;
      assert.equal(saved.account.role, role);
      assert.equal(saved.account.email, nextEmail);
      assert.equal(saved.account.phone, "01099998888");
      if (role === "brand") {
        assert.equal(saved.account.brand_name, "변경 브랜드");
        assert.equal(saved.account.contact_name, "변경 담당자");
      } else
        assert.equal(
          (
            db
              .prepare("SELECT phone FROM influencer_profiles WHERE user_id=?")
              .get(saved.account.id) as any
          ).phone,
          "01099998888",
        );
      assert.equal((await login()).status, 401);
      assert.equal((await login(nextEmail, password)).status, 401);
      assert.equal((await login(nextEmail, nextPassword)).status, 200);
    } finally {
      db.close();
    }
  });
test("account update rejects duplicate email, cross-site writes and throttles password guesses", async () => {
  const { db, app } = setup();
  try {
    for (const email of ["one@test.com", "two@test.com"])
      assert.equal(
        (
          await post(app, "/api/register", {
            role: "influencer",
            name: "테스트 이름",
            phone: "01012345678",
            email,
            password,
          })
        ).status,
        201,
      );
    const response = await post(app, "/api/login", {
      email: "one@test.com",
      password,
    });
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const update = (data: any, extra = {}) =>
      app.request("/api/account", {
        method: "PUT",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...extra,
        },
        body: JSON.stringify(data),
      });
    assert.equal(
      (await update({ current_password: password, email: "TWO@test.com" }))
        .status,
      409,
    );
    assert.equal(
      (await update({ current_password: password, phone: "invalid-number" }))
        .status,
      400,
    );
    assert.equal(
      (
        await update(
          { current_password: password },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await update({ current_password: "incorrect" })).status,
        400,
      );
    assert.equal((await update({ current_password: password })).status, 429);
    assert.equal(
      (
        db
          .prepare("SELECT email FROM users WHERE email='one@test.com'")
          .get() as any
      ).email,
      "one@test.com",
    );
  } finally {
    db.close();
  }
});
function setup(production = false) {
  const db = openDb(":memory:");
  return { db, app: createApp(db, production) };
}
function post(app: any, path: string, data: any, cookie = "", extra = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...extra },
    body: JSON.stringify(data),
  });
}
for (const role of ["brand", "influencer", "admin"])
  test(`${role}: session, role authorization, logout`, async () => {
    const { app, db } = setup();
    try {
      db.prepare(
        "INSERT INTO users(email,name,role,password_hash) VALUES (?,?,?,?)",
      ).run(`${role}@test.com`, "테스트 계정", role, hashPassword(password));
      assert.equal((await app.request(`/api/${role}/overview`)).status, 401);
      const login = await post(app, "/api/login", {
        email: `${role}@test.com`,
        password,
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
      assert.match(login.headers.get("set-cookie")!, /SameSite=Lax/);
      assert.equal(
        (await app.request("/api/me", { headers: { Cookie: cookie } })).status,
        200,
      );
      assert.equal(
        (
          await app.request(`/dashboard/${role}`, {
            headers: { Cookie: cookie },
          })
        ).status,
        200,
      );
      for (const other of ["admin", "brand", "influencer"].filter(
        (r) => r !== role,
      )) {
        assert.equal(
          (
            await app.request(`/api/${other}/overview`, {
              headers: { Cookie: cookie },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await app.request(`/dashboard/${other}`, {
              headers: { Cookie: cookie },
            })
          ).status,
          403,
        );
      }
      assert.equal((await post(app, "/api/logout", {}, cookie)).status, 200);
      assert.equal(
        (await app.request("/api/me", { headers: { Cookie: cookie } })).status,
        401,
      );
    } finally {
      db.close();
    }
  });
test("registration validation, duplicate, password hashing, admin escalation rejection", async () => {
  const { app, db } = setup();
  try {
    const data = {
      email: "New@Test.com",
      name: "새 사용자",
      brand_name: "새 사용자",
      contact_name: "테스트 담당자",
      phone: "01012345678",
      password,
      role: "brand",
    };
    assert.equal(
      (await post(app, "/api/register", { ...data, role: "admin" })).status,
      400,
    );
    assert.equal(
      (await post(app, "/api/register", { ...data, password: "short" })).status,
      400,
    );
    assert.equal((await post(app, "/api/register", data)).status, 201);
    assert.equal((await post(app, "/api/register", data)).status, 409);
    const row = db.prepare("SELECT * FROM users").get() as any;
    assert.equal(row.email, "new@test.com");
    assert.notEqual(row.password_hash, password);
    assert.equal(
      (await post(app, "/api/login", { email: data.email, password: "wrong" }))
        .status,
      401,
    );
    assert.equal(
      (await post(app, "/api/login", { email: data.email, password })).status,
      200,
    );
  } finally {
    db.close();
  }
});
test("CSRF rejection, malformed input, expired sessions and login throttling", async () => {
  const { app, db } = setup();
  try {
    assert.equal(
      (
        await post(app, "/api/register", {}, "", {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/api/login", {
          method: "POST",
          body: "bad",
          headers: { "Content-Type": "application/json" },
        })
      ).status,
      400,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await post(app, "/api/login", { email: "nobody@test.com", password }))
          .status,
        401,
      );
    assert.equal(
      (await post(app, "/api/login", { email: "nobody@test.com", password }))
        .status,
      429,
    );
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES (?,?,?,?)",
    ).run("expired@test.com", "테스트", "brand", hashPassword(password));
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      createHash("sha256").update("expired").digest("hex"),
      1,
      Date.now() - 1,
    );
    assert.equal(
      (
        await app.request("/api/me", {
          headers: { Cookie: "seoul_session=expired" },
        })
      ).status,
      401,
    );
  } finally {
    db.close();
  }
});
test("production cookie is secure; names are escaped in dashboard", async () => {
  const { app, db } = setup(true);
  try {
    const response = await post(app, "/api/register", {
      email: "safe@test.com",
      name: "<script>alert(1)</script>",
      phone: "01012345678",
      password,
      role: "influencer",
    });
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /__Host-seoul_session=/);
    assert.match(cookie, /Secure/);
    const html = await (
      await app.request("/dashboard/influencer", {
        headers: { Cookie: cookie.split(";")[0] },
      })
    ).text();
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert(1)</script>"));
  } finally {
    db.close();
  }
});
test("HTTPS reverse proxy origin is accepted; cross-site production writes remain forbidden", async () => {
  const db = openDb(":memory:"),
    app = createApp(db, true, "https://seoul.example.com");
  try {
    const body = {
      email: "proxy@test.com",
      password,
      name: "프록시 계정",
      brand_name: "프록시 계정",
      contact_name: "테스트 담당자",
      phone: "01012345678",
      role: "brand",
    };
    const request = (origin: string) =>
      app.request("http://internal:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    assert.equal((await request("https://evil.example")).status, 403);
    assert.equal((await request("https://seoul.example.com")).status, 201);
  } finally {
    db.close();
  }
});

test("role-specific signup stores contact fields and initializes influencer phone", async () => {
  const { app, db } = setup();
  try {
    const brand = {
      role: "brand",
      brand_name: "서울 브랜드",
      contact_name: "김담당",
      phone: "010-1234-5678",
      email: "brand-new@test.com",
      password,
    };
    assert.equal(
      (await post(app, "/api/register", { ...brand, contact_name: "" })).status,
      400,
    );
    assert.equal(
      (await post(app, "/api/register", { ...brand, phone: "" })).status,
      400,
    );
    assert.equal((await post(app, "/api/register", brand)).status, 201);
    const row = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(brand.email) as any;
    assert.equal(row.name, brand.brand_name);
    assert.equal(row.brand_name, brand.brand_name);
    assert.equal(row.contact_name, brand.contact_name);
    assert.equal(row.phone, brand.phone);
    const influencer = {
      role: "influencer",
      name: "김크리에이터",
      phone: "01098765432",
      email: "creator-new@test.com",
      password,
    };
    assert.equal((await post(app, "/api/register", influencer)).status, 201);
    const profile = db
      .prepare(
        "SELECT p.* FROM influencer_profiles p JOIN users u ON u.id=p.user_id WHERE u.email=?",
      )
      .get(influencer.email) as any;
    assert.equal(profile.phone, influencer.phone);
    assert.equal(profile.address, "");
  } finally {
    db.close();
  }
});
