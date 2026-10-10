import type { openDb } from "./db.js";
export function initializeWorkflow(db: ReturnType<typeof openDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS influencer_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', social_url TEXT NOT NULL DEFAULT '',
      followers INTEGER NOT NULL DEFAULT 0 CHECK(followers>=0), tier INTEGER NOT NULL DEFAULT 0 CHECK(tier BETWEEN 0 AND 3),
      completed_count INTEGER NOT NULL DEFAULT 0, total_views INTEGER NOT NULL DEFAULT 0,
      no_show_count INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0,
      blacklisted INTEGER NOT NULL DEFAULT 0 CHECK(blacklisted IN (0,1))
    );
    CREATE TRIGGER IF NOT EXISTS influencer_profile_insert AFTER INSERT ON users WHEN NEW.role='influencer'
      BEGIN INSERT INTO influencer_profiles(user_id) VALUES(NEW.id); END;
    INSERT OR IGNORE INTO influencer_profiles(user_id) SELECT id FROM users WHERE role='influencer';
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, product TEXT NOT NULL, description TEXT NOT NULL, guidelines TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 500), pay_type TEXT NOT NULL CHECK(pay_type IN ('gifted','paid')),
      compensation INTEGER NOT NULL DEFAULT 0 CHECK(compensation>=0),
      recruit_date TEXT NOT NULL, draft_date TEXT NOT NULL, final_date TEXT NOT NULL,
      recruit_due INTEGER NOT NULL, draft_due INTEGER NOT NULL, final_due INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'recruiting' CHECK(status IN ('recruiting','closed','completed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
      influencer_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','rejected','selected','shipping','draft_submitted','revision_requested','draft_approved','final_submitted','completed','no_show')),
      consent_at INTEGER NOT NULL, consent_version TEXT NOT NULL DEFAULT 'secondary-use-v1',
      phone TEXT NOT NULL, address TEXT NOT NULL, carrier TEXT NOT NULL DEFAULT '', tracking_number TEXT NOT NULL DEFAULT '',
      draft_url TEXT NOT NULL DEFAULT '', final_url TEXT NOT NULL DEFAULT '', feedback TEXT NOT NULL DEFAULT '',
      revision_due INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(campaign_id,influencer_id)
    );
    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id), actor_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), message TEXT NOT NULL,
      path TEXT NOT NULL, event_key TEXT UNIQUE, read_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), penalty_days INTEGER NOT NULL DEFAULT 30,
      demotion INTEGER NOT NULL DEFAULT 1, blacklist_after INTEGER NOT NULL DEFAULT 2,
      tier2_count INTEGER NOT NULL DEFAULT 3, tier3_count INTEGER NOT NULL DEFAULT 10, tier4_count INTEGER NOT NULL DEFAULT 20,
      tier2_views INTEGER NOT NULL DEFAULT 0, tier3_views INTEGER NOT NULL DEFAULT 10000, tier4_views INTEGER NOT NULL DEFAULT 100000
    );
    INSERT OR IGNORE INTO workflow_settings(id) VALUES(1);
    CREATE INDEX IF NOT EXISTS campaigns_brand_idx ON campaigns(brand_id);
    CREATE INDEX IF NOT EXISTS applications_influencer_idx ON applications(influencer_id);
    CREATE INDEX IF NOT EXISTS applications_campaign_idx ON applications(campaign_id,status);
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at);
    CREATE INDEX IF NOT EXISTS events_application_idx ON application_events(application_id,id);
    INSERT OR IGNORE INTO schema_version VALUES(2);
  `);
  const columns = db.prepare("PRAGMA table_info(applications)").all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "revision_due"))
    db.exec(
      "ALTER TABLE applications ADD COLUMN revision_due INTEGER NOT NULL DEFAULT 0",
    );
  db.transaction(() => {
    const campaignColumns = db
      .prepare("PRAGMA table_info(campaigns)")
      .all() as { name: string }[];
    for (const [name, definition] of [
      ["product_url", "TEXT NOT NULL DEFAULT ''"],
      ["recruit_start_date", "TEXT NOT NULL DEFAULT ''"],
      ["recruit_start", "INTEGER NOT NULL DEFAULT 0"],
    ]) {
      if (!campaignColumns.some((column) => column.name === name))
        db.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`UPDATE campaigns SET recruit_start_date=MIN(date(created_at,'+9 hours'),recruit_date) WHERE recruit_start_date='';
      UPDATE campaigns SET recruit_start=CAST(strftime('%s',recruit_start_date || ' 00:00:00','-9 hours') AS INTEGER)*1000 WHERE recruit_start=0;
      INSERT OR IGNORE INTO schema_version VALUES(3);`);
  })();
  db.transaction(() => {
    const users = db.prepare("PRAGMA table_info(users)").all() as {
      name: string;
    }[];
    for (const name of ["brand_name", "contact_name", "phone"])
      if (!users.some((c) => c.name === name))
        db.exec(
          `ALTER TABLE users ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`,
        );
    db.exec(
      "UPDATE users SET brand_name=name WHERE role='brand' AND brand_name=''",
    );
    const applications = db
      .prepare("PRAGMA table_info(applications)")
      .all() as { name: string }[];
    const added: [string, string][] = [
      ["recipient_name", "TEXT NOT NULL DEFAULT ''"],
      ["postal_code", "TEXT NOT NULL DEFAULT ''"],
      ["address_detail", "TEXT NOT NULL DEFAULT ''"],
      ["shipping_address_at", "INTEGER NOT NULL DEFAULT 0"],
      ["secondary_use_consent", "INTEGER NOT NULL DEFAULT 0"],
      ["original_delivery_consent", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [name, definition] of added)
      if (!applications.some((c) => c.name === name))
        db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${definition}`);
    db.exec(
      "UPDATE applications SET secondary_use_consent=1,original_delivery_consent=1 WHERE consent_version='secondary-use-v1' AND consent_at>0; INSERT OR IGNORE INTO schema_version VALUES(4)",
    );
  })();
  if (
    !(
      db.prepare("PRAGMA table_info(campaigns)").all() as { name: string }[]
    ).some((c) => c.name === "review_required")
  )
    db.exec(
      "ALTER TABLE campaigns ADD COLUMN review_required INTEGER NOT NULL DEFAULT 1 CHECK(review_required IN (0,1))",
    );
  db.exec("INSERT OR IGNORE INTO schema_version VALUES(5)");
  const fields = db.prepare("PRAGMA table_info(campaigns)").all() as {
    name: string;
  }[];
  for (const field of [
    "title_en",
    "product_en",
    "description_en",
    "guidelines_en",
  ])
    if (!fields.some((c) => c.name === field))
      db.exec(
        `ALTER TABLE campaigns ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`,
      );
  db.exec(
    `CREATE TABLE IF NOT EXISTS content_translation_cache(source_hash TEXT PRIMARY KEY,translated TEXT NOT NULL,created_at INTEGER NOT NULL); INSERT OR IGNORE INTO schema_version VALUES(6)`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS campaign_images(id INTEGER PRIMARY KEY,campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,position INTEGER NOT NULL,data BLOB NOT NULL); CREATE INDEX IF NOT EXISTS campaign_images_campaign ON campaign_images(campaign_id,position); INSERT OR IGNORE INTO schema_version VALUES(7)`,
  );
  db.exec(`CREATE TABLE IF NOT EXISTS email_outbox (
    id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id),
    event_key TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, last_attempt INTEGER,
    last_error TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL DEFAULT '', sent_at INTEGER, created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS email_outbox_pending ON email_outbox(status,next_attempt);
  CREATE TABLE IF NOT EXISTS email_attempts(id INTEGER PRIMARY KEY,email_id INTEGER NOT NULL REFERENCES email_outbox(id),created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS email_attempts_time ON email_attempts(created_at);`);
  db.exec("INSERT OR IGNORE INTO schema_version VALUES(8)");
}
