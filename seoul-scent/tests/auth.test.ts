import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openDb, hashPassword } from "../src/seoul/db.js";
import { createApp } from "../src/seoul/app.js";
const password = "Test-password-123!";
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
