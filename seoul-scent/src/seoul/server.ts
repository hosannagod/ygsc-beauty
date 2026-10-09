import { sweepDeadlines } from "./workflow.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
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
const port = Number(process.env.PORT || 3000);
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`Seoul Scent listening on port ${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      clearInterval(sweep);
      db.close();
      process.exit(0);
    }),
  );
