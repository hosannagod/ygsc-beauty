import type { openDb } from "./db.js";
type DB = ReturnType<typeof openDb>;
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
const validEmail = (s: string) =>
  /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s);

export function emailConfig(env: Env = process.env) {
  const provider = env.EMAIL_PROVIDER || "none";
  const from = env.EMAIL_FROM || "";
  const replyTo = env.EMAIL_REPLY_TO || "";
  let origin = "";
  try {
    const url = new URL(env.APP_ORIGIN || "");
    if (url.protocol === "https:" && !url.username && !url.password)
      origin = url.origin;
  } catch {}
  const dailyLimit = Number(env.EMAIL_DAILY_LIMIT || "100");
  const configured =
    !!origin &&
    validEmail(from) &&
    (!replyTo || validEmail(replyTo)) &&
    Number.isInteger(dailyLimit) &&
    dailyLimit >= 1 &&
    dailyLimit <= 2000 &&
    provider === "brevo" &&
    !!env.BREVO_API_KEY;
  return { provider, from, replyTo, origin, dailyLimit, configured };
}

export async function sendPasswordResetEmail(
  recipient: string,
  token: string,
  env: Env = process.env,
  request: Fetch = fetch,
) {
  const config = emailConfig(env);
  if (!config.configured || !validEmail(recipient))
    throw new Error("Password reset email unavailable");
  const link = `${config.origin}/password-reset#token=${encodeURIComponent(token)}`;
  await checked(
    await request("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "api-key": env.BREVO_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Seoul Scent", email: config.from },
        to: [{ email: recipient }],
        ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {}),
        subject: "[Seoul Scent] Reset your password / 비밀번호 재설정",
        textContent: `English\n\nUse this link to set a new Seoul Scent password. It expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.\n\n${link}\n\n--------------------\n\n한국어\n\n아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 30분 동안 한 번만 사용할 수 있습니다. 직접 요청하지 않았다면 이 메일을 무시해 주세요.\n\n${link}\n\nSeoul Scent`,
      }),
    }),
  );
}

// Called inside the same transaction as selection. No past selections are backfilled.
export function queueSelectionEmail(
  db: DB,
  applicationId: number,
  env: Env = process.env,
  now = Date.now(),
) {
  if (emailConfig(env).provider !== "brevo") return;
  const row = db
    .prepare(
      `SELECT u.email,u.name,c.title,c.title_en FROM applications a
    JOIN users u ON u.id=a.influencer_id JOIN campaigns c ON c.id=a.campaign_id WHERE c.deleted_at=0 AND a.id=?`,
    )
    .get(applicationId) as any;
  if (!row) throw new Error("Selection recipient not found");
  const title = row.title_en || row.title;
  const subject = "[Seoul Scent] Campaign selection / 캠페인 선정 안내";
  const body = `English

Hello ${row.name},

You have been selected for the campaign: ${title}.

Please sign in and open My Campaigns → Selected Campaigns.
- Check or update your shipping address for this campaign.
- Complete any required consent.
- Check the boxes confirming your participation, that you have read the content guide, and that you will upload by the deadline.

Save your confirmation after checking all items.

Even if you have already entered an address, you must confirm it for this campaign before your product can be shipped.

--------------------

한국어

안녕하세요, ${row.name}님.

${row.title} 캠페인에 선정되었습니다.

로그인 후 내 캠페인 → 선정된 캠페인에서 아래 항목을 확인하고 저장해 주세요.
- 이번 캠페인의 배송지를 확인하거나 수정해 주세요.
- 필수 동의를 완료해 주세요.
- 참여 의사·콘텐츠 가이드 확인·기한 내 업로드 약속 항목을 모두 체크해 주세요.

기존에 배송지를 등록하셨더라도 이번 캠페인에서 다시 확인해야 제품 발송이 가능합니다.

`;
  db.prepare(
    `INSERT OR IGNORE INTO email_outbox(application_id,event_key,recipient,subject,body,next_attempt,created_at)
    VALUES(?,?,?,?,?,?,?)`,
  ).run(
    applicationId,
    `selection:${applicationId}`,
    row.email,
    subject,
    body,
    now,
    now,
  );
}

class DeliveryError extends Error {
  constructor(
    public code: string,
    public permanent = false,
  ) {
    super(code);
  }
}
async function checked(response: Response) {
  if (!response.ok)
    throw new DeliveryError(
      `provider_http_${response.status}`,
      response.status >= 400 &&
        response.status < 500 &&
        ![401, 403, 408, 429].includes(response.status),
    );
  return response;
}
export async function deliverEmail(row: any, env: Env, request: Fetch = fetch) {
  const config = emailConfig(env);
  if (!config.configured) throw new DeliveryError("configuration_missing");
  if (!validEmail(row.recipient))
    throw new DeliveryError("invalid_recipient", true);
  const text =
    row.body +
    new URL(`/applications/${row.application_id}`, config.origin).href +
    "\n\nSeoul Scent\nThis email relates to a campaign you applied for. / 지원한 캠페인의 진행 안내입니다.";
  const signal = AbortSignal.timeout(20_000);
  const response = await checked(
    await request("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal,
      headers: {
        "api-key": env.BREVO_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Seoul Scent", email: config.from },
        to: [{ email: row.recipient }],
        ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {}),
        subject: row.subject,
        textContent: text,
      }),
    }),
  );
  return String(((await response.json()) as any).messageId || "accepted").slice(
    0,
    500,
  );
}

export function emailStatus(db: DB, env: Env = process.env) {
  const config = emailConfig(env);
  return {
    provider: config.provider,
    configured: config.configured,
    daily_limit: config.dailyLimit,
    counts: db
      .prepare(
        "SELECT status,COUNT(*) AS count FROM email_outbox GROUP BY status",
      )
      .all(),
    messages: db
      .prepare(
        `SELECT id,application_id,recipient,status,attempts,last_error,created_at,sent_at
      FROM email_outbox ORDER BY id DESC LIMIT 50`,
      )
      .all(),
  };
}

export function emailWorker(
  db: DB,
  env: Env = process.env,
  request: Fetch = fetch,
) {
  let busy = false;
  return async (now = Date.now()) => {
    if (busy || !emailConfig(env).configured) return;
    busy = true;
    try {
      const claim = db.transaction(() => {
        db.prepare(
          "UPDATE email_outbox SET status='pending' WHERE status='sending' AND last_attempt<?",
        ).run(now - 15 * 60_000);
        db.prepare(
          "UPDATE email_outbox SET status='failed',last_error='campaign_deleted' WHERE status='pending' AND application_id IN (SELECT a.id FROM applications a JOIN campaigns c ON c.id=a.campaign_id WHERE c.deleted_at>0)",
        ).run();
        const recent = db
          .prepare(
          "SELECT (SELECT COUNT(*) FROM email_attempts WHERE created_at>?) + (SELECT COUNT(*) FROM password_reset_mail_attempts WHERE created_at>?) AS n",
          )
          .get(now - 86400_000, now - 86400_000) as any;
        if (recent.n >= emailConfig(env).dailyLimit) return null;
        const row = db
          .prepare(
            "SELECT * FROM email_outbox WHERE status='pending' AND next_attempt<=? AND application_id IN (SELECT a.id FROM applications a JOIN campaigns c ON c.id=a.campaign_id WHERE c.deleted_at=0) ORDER BY id LIMIT 1",
          )
          .get(now) as any;
        if (!row) return null;
        db.prepare(
          "UPDATE email_outbox SET status='sending',attempts=attempts+1,last_attempt=? WHERE id=?",
        ).run(now, row.id);
        db.prepare(
          "INSERT INTO email_attempts(email_id,created_at) VALUES(?,?)",
        ).run(row.id, now);
        return { ...row, attempts: row.attempts + 1 };
      });
      const row = claim();
      if (!row) return;
      try {
        const providerId = await deliverEmail(row, env, request);
        db.prepare(
          "UPDATE email_outbox SET status='sent',provider_id=?,sent_at=?,last_error='' WHERE id=?",
        ).run(providerId, now, row.id);
      } catch (error) {
        const code =
          error instanceof DeliveryError ? error.code : "network_or_timeout";
        const failed =
          row.attempts >= 5 ||
          (error instanceof DeliveryError && error.permanent);
        db.prepare(
          "UPDATE email_outbox SET status=?,last_error=?,next_attempt=? WHERE id=?",
        ).run(
          failed ? "failed" : "pending",
          code,
          now + Math.min(3600_000, 60_000 * 2 ** row.attempts),
          row.id,
        );
      }
    } finally {
      busy = false;
    }
  };
}
