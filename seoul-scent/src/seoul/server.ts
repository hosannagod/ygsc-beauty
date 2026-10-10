import { sweepDeadlines } from "./workflow.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { emailWorker, emailConfig } from "./email.js";
const db = openDb(process.env.DATABASE_PATH || "./data/seoul-scent.db");
const production = process.env.NODE_ENV === "production";
const publicOrigin = process.env.APP_ORIGIN
  ? new URL(process.env.APP_ORIGIN).origin
  : undefined;
if (publicOrigin && production && !publicOrigin.startsWith("https://"))
  throw new Error("APP_ORIGIN must use HTTPS in production");
const app = createApp(db, production, publicOrigin);
app.get(
  "/assets/*",
  serveStatic({
    root: "./public",
    rewriteRequestPath: (path) => path.replace("/assets/", "/"),
  }),
);
sweepDeadlines(db);
const sweep = setInterval(() => {
  try {
    sweepDeadlines(db);
  } catch (error) {
    console.error("Deadline sweep failed:", error);
  }
}, 60_000);
sweep.unref();
const sendEmails = emailWorker(db);
let emailRun: Promise<void> = Promise.resolve();
const runEmails = () => {
  emailRun = sendEmails().catch(() =>
    console.error("Email worker failed; check database health."),
  );
};
const mail = emailConfig();
console.log(`Email provider: ${mail.provider}; configured: ${mail.configured}`);
runEmails();
const mailTimer = setInterval(runEmails, 30_000);
mailTimer.unref();
const port = Number(process.env.PORT || 3000);
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`Seoul Scent listening on port ${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(sweep);
    clearInterval(mailTimer);
    server.close(async () => {
      await emailRun;
      db.close();
      process.exit(0);
    });
  });
