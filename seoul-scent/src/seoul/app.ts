import { language } from "./i18n.js";
import { workspacePage } from "./workspace-view.js";
import { registerWorkflow } from "./workflow-api.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import { openDb, hashPassword, verifyPassword, type User } from "./db.js";
import { page } from "./views.js";

const selectUser = "id, email, name, role";
const roles = ["admin", "brand", "influencer"] as const;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const dummyHash = hashPassword("unused-comparison-password");
export function createApp(
  db: ReturnType<typeof openDb>,
  production = false,
  publicOrigin?: string,
) {
  const app = new Hono<{ Variables: { user: User | null } }>();
  app.use(
    "*",
    bodyLimit({
      maxSize: 3 * 1024 * 1024,
      onError: (c) => c.json({ error: "요청 크기가 너무 큽니다." }, 413),
    }),
  );
  const cookie = production ? "__Host-seoul_session" : "seoul_session";
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "same-origin");
    c.header("Cache-Control", "no-store");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const origin = c.req.header("Origin");
      const requestOrigin = new URL(c.req.url);
      if (production) requestOrigin.protocol = "https:";
      if (origin && origin !== (publicOrigin || requestOrigin.origin))
        return c.json({ error: "허용되지 않은 요청입니다." }, 403);
      if (c.req.header("Sec-Fetch-Site") === "cross-site")
        return c.json({ error: "허용되지 않은 요청입니다." }, 403);
      if (!c.req.header("Content-Type")?.startsWith("application/json"))
        return c.json({ error: "JSON 요청이 필요합니다." }, 415);
    }
    const token = getCookie(c, cookie);
    c.set(
      "user",
      token
        ? (db
            .prepare(
              `SELECT ${selectUser
                .split(", ")
                .map((x) => "u." + x)
                .join(
                  ", ",
                )} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`,
            )
            .get(digest(token), Date.now()) as User) || null
        : null,
    );
    await next();
  });
  function session(c: any, user: User) {
    const previous = getCookie(c, cookie);
    if (previous)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        digest(previous),
      );
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      digest(token),
      user.id,
      Date.now() + 8 * 3600_000,
    );
    setCookie(c, cookie, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: production,
      path: "/",
      maxAge: 8 * 3600,
    });
  }
  app.get("/health", (c) => {
    db.prepare("SELECT 1").get();
    return c.json({ status: "ok" });
  });
  app.get("/", (c) => c.redirect(c.get("user") ? "/dashboard" : "/login"));
  app.get("/login", (c) =>
    c.get("user")
      ? c.redirect("/dashboard")
      : c.html(page("login", undefined, language(c.req.header("Cookie")))),
  );
  app.get("/register", (c) =>
    c.get("user")
      ? c.redirect("/dashboard")
      : c.html(page("register", undefined, language(c.req.header("Cookie")))),
  );
  app.get("/dashboard", (c) =>
    c.get("user")
      ? c.redirect(`/dashboard/${c.get("user")!.role}`)
      : c.redirect("/login"),
  );
  app.get("/dashboard/:role", (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/login");
    if (c.req.param("role") !== user.role)
      return c.html(
        page("forbidden", user, language(c.req.header("Cookie"))),
        403,
      );
    return c.html(workspacePage(user, language(c.req.header("Cookie"))));
  });
  for (const path of [
    "/campaigns",
    "/campaigns/new",
    "/campaigns/:id",
    "/applications",
    "/applications/:id",
    "/profile",
    "/account",
    "/notifications",
    "/admin/users",
    "/admin/settings",
  ])
    app.get(path, (c) => {
      const user = c.get("user");
      if (!user) return c.redirect("/login");
      if (
        (path.startsWith("/admin/") && user.role !== "admin") ||
        (path === "/profile" && user.role !== "influencer") ||
        (path === "/applications" && user.role !== "influencer") ||
        (path === "/campaigns/new" && user.role !== "brand")
      )
        return c.html(
          page("forbidden", user, language(c.req.header("Cookie"))),
          403,
        );
      return c.html(workspacePage(user, language(c.req.header("Cookie"))));
    });
  app.get("/api/me", (c) =>
    c.get("user")
      ? c.json({ user: c.get("user") })
      : c.json({ error: "로그인이 필요합니다." }, 401),
  );
  app.get("/api/account", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "로그인이 필요합니다." }, 401);
    return c.json({
      account: db
        .prepare(
          "SELECT id,email,name,role,brand_name,contact_name,phone FROM users WHERE id=?",
        )
        .get(user.id),
    });
  });
  app.put("/api/account", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "로그인이 필요합니다." }, 401);
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.current_password !== "string" ||
      body.current_password.length > 128
    )
      return c.json({ error: "현재 비밀번호를 입력해 주세요." }, 400);
    const saved = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(user.id) as any;
    const attemptKey = `account:${user.id}`;
    const attempt = db
      .prepare("SELECT * FROM login_attempts WHERE email=?")
      .get(attemptKey) as any;
    if (attempt?.locked_until > Date.now())
      return c.json({ error: "잠시 후 다시 시도해 주세요." }, 429);
    if (!verifyPassword(body.current_password, saved.password_hash)) {
      const failures =
        attempt?.locked_until && attempt.locked_until <= Date.now()
          ? 1
          : (attempt?.failures || 0) + 1;
      db.prepare(
        "INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until",
      ).run(attemptKey, failures, failures >= 5 ? Date.now() + 15 * 60_000 : 0);
      return c.json({ error: "현재 비밀번호가 일치하지 않습니다." }, 400);
    }
    const field = (key: string, fallback: string) =>
      typeof body[key] === "string"
        ? body[key].trim()
        : body[key] === undefined
          ? fallback
          : "";
    const email = field("email", saved.email).toLowerCase();
    const name = field("name", saved.name),
      phone = field("phone", saved.phone);
    const brandName = field("brand_name", saved.brand_name),
      contactName = field("contact_name", saved.contact_name);
    if (
      !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) ||
      email.length > 254 ||
      !/^[+0-9 ()-]{8,30}$/.test(phone) ||
      (user.role === "brand"
        ? brandName.length < 2 ||
          brandName.length > 80 ||
          contactName.length < 2 ||
          contactName.length > 60
        : name.length < 2 || name.length > 60)
    )
      return c.json({ error: "이름·이메일·연락처를 확인해 주세요." }, 400);
    const password = body.new_password;
    if (
      password !== undefined &&
      (typeof password !== "string" ||
        (password !== "" &&
          (password.length < 12 ||
            password.length > 128 ||
            password !== body.confirm_password)))
    )
      return c.json(
        {
          error: "새 비밀번호는 12~128자로 입력하고 확인 값과 일치해야 합니다.",
        },
        400,
      );
    const duplicate = db
      .prepare("SELECT id FROM users WHERE email=? AND id!=?")
      .get(email, user.id);
    if (duplicate)
      return c.json({ error: "이미 사용 중인 이메일입니다." }, 409);
    const nextName = user.role === "brand" ? brandName : name;
    db.transaction(() => {
      db.prepare(
        "UPDATE users SET email=?,name=?,phone=?,brand_name=?,contact_name=?,password_hash=? WHERE id=?",
      ).run(
        email,
        nextName,
        phone,
        user.role === "brand" ? brandName : saved.brand_name,
        user.role === "brand" ? contactName : saved.contact_name,
        password ? hashPassword(password) : saved.password_hash,
        user.id,
      );
      if (user.role === "influencer") {
        db.prepare(
          "UPDATE influencer_profiles SET phone=? WHERE user_id=?",
        ).run(phone, user.id);
        if (email !== saved.email)
          db.prepare(
            "UPDATE email_outbox SET recipient=? WHERE application_id IN (SELECT id FROM applications WHERE influencer_id=?) AND status IN ('pending','failed')",
          ).run(email, user.id);
      }
      db.prepare("DELETE FROM login_attempts WHERE email=?").run(attemptKey);
      if (email !== saved.email || password)
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    })();
    // Rotate this session after credential changes; all other sessions stay revoked.
    if (email !== saved.email || password)
      session(c, { ...user, email, name: nextName });
    return c.json({
      success: true,
      credentials_changed: email !== saved.email || !!password,
    });
  });
  app.post("/api/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      !["brand", "influencer"].includes(body.role)
    )
      return c.json({ error: "입력 내용을 확인해 주세요." }, 400);
    const email = body.email.trim().toLowerCase(),
      name =
        typeof (body.role === "brand" ? body.brand_name : body.name) ===
        "string"
          ? (body.role === "brand" ? body.brand_name : body.name).trim()
          : "";
    const contactName =
      body.role === "brand" && typeof body.contact_name === "string"
        ? body.contact_name.trim()
        : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof name !== "string" ||
      name.length < 2 ||
      name.length > 60 ||
      body.password.length < 12 ||
      body.password.length > 128 ||
      !/^[+0-9 ()-]{8,30}$/.test(phone) ||
      (body.role === "brand" &&
        (contactName.length < 2 || contactName.length > 60))
    )
      return c.json(
        {
          error:
            "이메일, 이름·브랜드명·담당자명(2~60자), 연락처, 비밀번호(12~128자)를 확인해 주세요.",
        },
        400,
      );
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      return c.json({ error: "이미 사용 중인 이메일입니다." }, 409);
    const user = db.transaction(() => {
      const result = db
        .prepare(
          "INSERT INTO users (email,name,role,password_hash,brand_name,contact_name,phone) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          email,
          name,
          body.role,
          hashPassword(body.password),
          body.role === "brand" ? name : "",
          contactName,
          phone,
        );
      if (body.role === "influencer")
        db.prepare(
          "UPDATE influencer_profiles SET phone=? WHERE user_id=?",
        ).run(phone, result.lastInsertRowid);
      return db
        .prepare(`SELECT ${selectUser} FROM users WHERE id=?`)
        .get(result.lastInsertRowid) as User;
    })();
    session(c, user);
    return c.json({ user, redirect: `/dashboard/${user.role}` }, 201);
  });
  app.post("/api/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      body.email.length > 254 ||
      body.password.length > 128
    )
      return c.json({ error: "입력 내용을 확인해 주세요." }, 400);
    const email = body.email.trim().toLowerCase();
    const attempt = db
      .prepare("SELECT * FROM login_attempts WHERE email=?")
      .get(email) as any;
    if (attempt?.locked_until > Date.now())
      return c.json(
        { error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." },
        429,
      );
    const user = db
      .prepare(`SELECT ${selectUser}, password_hash FROM users WHERE email=?`)
      .get(email) as (User & { password_hash: string }) | undefined;
    if (
      !verifyPassword(body.password, user?.password_hash || dummyHash) ||
      !user
    ) {
      const failures =
        attempt?.locked_until > 0 ? 1 : (attempt?.failures || 0) + 1;
      db.prepare(
        "INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET failures=excluded.failures, locked_until=excluded.locked_until",
      ).run(email, failures, failures >= 5 ? Date.now() + 15 * 60_000 : 0);
      return c.json(
        { error: "이메일 또는 비밀번호가 올바르지 않습니다." },
        401,
      );
    }
    db.prepare("DELETE FROM login_attempts WHERE email=?").run(email);
    const safeUser: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    session(c, safeUser);
    return c.json({ user: safeUser, redirect: `/dashboard/${user.role}` });
  });
  app.post("/api/logout", (c) => {
    const token = getCookie(c, cookie);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
    deleteCookie(c, cookie, { path: "/", secure: production });
    return c.json({ success: true });
  });
  for (const role of roles)
    app.get(`/api/${role}/overview`, (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "로그인이 필요합니다." }, 401);
      if (user.role !== role)
        return c.json({ error: "접근 권한이 없습니다." }, 403);
      return c.json({
        role,
        ...(role === "admin"
          ? {
              users: db
                .prepare(
                  "SELECT role, COUNT(*) AS count FROM users GROUP BY role",
                )
                .all(),
            }
          : {}),
      });
    });
  registerWorkflow(app, db);
  app.onError((error, c) => {
    console.error("Request failed:", error.message);
    return c.json({ error: "요청을 처리하지 못했습니다." }, 500);
  });
  return app;
}
