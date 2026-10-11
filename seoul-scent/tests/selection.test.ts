import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/seoul/db.js";
import { finalizeSelection } from "../src/seoul/selection.js";
const count = (db: any, sql: string) => (db.prepare(sql).get() as any).n;
test("final selection commits 50 people and queues exactly one email per person; retries are safe", () => {
  const db = openDb(":memory:"),
    old = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_PROVIDER = "brevo";
  try {
    const brand = Number(
      db
        .prepare(
          "INSERT INTO users(email,name,role,password_hash) VALUES('brand@example.com','Brand','brand','test')",
        )
        .run().lastInsertRowid,
    );
    const campaign = Number(
      db
        .prepare(
          "INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due) VALUES(?,'Test','Test','Description','Guide',50,'gifted','2030-01-01','2030-01-10','2030-01-20',?,?,?)",
        )
        .run(
          brand,
          Date.now() + 86400000,
          Date.now() + 864000000,
          Date.now() + 1728000000,
        ).lastInsertRowid,
    );
    const ids: number[] = [];
    for (let i = 0; i < 50; i++) {
      const user = Number(
        db
          .prepare(
            "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,'influencer','test')",
          )
          .run("creator" + i + "@example.com", "Creator " + i).lastInsertRowid,
      );
      ids.push(
        Number(
          db
            .prepare(
              "INSERT INTO applications(campaign_id,influencer_id,consent_at,phone,address) VALUES(?,?,?,'01012345678','')",
            )
            .run(campaign, user, Date.now()).lastInsertRowid,
        ),
      );
    }
    const actor = {
      id: brand,
      role: "brand",
      name: "Brand",
      email: "brand@example.com",
    } as const;
    assert.equal(count(db, "SELECT COUNT(*) n FROM email_outbox"), 0);
    assert.equal(finalizeSelection(db, actor, campaign, ids).selected, 50);
    assert.equal(
      count(db, "SELECT COUNT(*) n FROM applications WHERE status='selected'"),
      50,
    );
    assert.equal(count(db, "SELECT COUNT(*) n FROM email_outbox"), 50);
    assert.equal(count(db, "SELECT COUNT(*) n FROM application_events"), 50);
    assert.throws(() => finalizeSelection(db, actor, campaign, ids));
    assert.equal(count(db, "SELECT COUNT(*) n FROM email_outbox"), 50);
  } finally {
    db.close();
    if (old === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = old;
  }
});
test("batch validation rolls back capacity, status, ownership and sanction errors before queuing mail", () => {
  const db = openDb(":memory:"),
    old = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_PROVIDER = "brevo";
  try {
    const user = (email: string, role: string) =>
      Number(
        db
          .prepare(
            "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,'test')",
          )
          .run(email, email, role).lastInsertRowid,
      );
    const brand = user("brand@example.com", "brand"),
      other = user("other@example.com", "brand"),
      u1 = user("one@example.com", "influencer"),
      u2 = user("two@example.com", "influencer");
    const camp = (owner: number) =>
      Number(
        db
          .prepare(
            "INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due) VALUES(?,'Test','Test','Description','Guide',2,'gifted','2030-01-01','2030-01-10','2030-01-20',?,?,?)",
          )
          .run(
            owner,
            Date.now() + 86400000,
            Date.now() + 864000000,
            Date.now() + 1728000000,
          ).lastInsertRowid,
      );
    const c = camp(brand),
      foreign = camp(other),
      add = (cid: number, uid: number) =>
        Number(
          db
            .prepare(
              "INSERT INTO applications(campaign_id,influencer_id,consent_at,phone,address) VALUES(?,?,?,'01012345678','')",
            )
            .run(cid, uid, Date.now()).lastInsertRowid,
        );
    const a1 = add(c, u1),
      a2 = add(c, u2),
      a3 = add(foreign, u1),
      actor = {
        id: brand,
        role: "brand",
        name: "Brand",
        email: "brand@example.com",
      } as const;
    for (const ids of [[], [a1, a1], [a1, a3], [a1, 9999]])
      assert.throws(() => finalizeSelection(db, actor, c, ids));
    assert.throws(() =>
      finalizeSelection(db, { ...actor, id: other }, c, [a1]),
    );
    assert.throws(() =>
      finalizeSelection(db, { ...actor, id: u1, role: "influencer" }, c, [a1]),
    );
    db.prepare("UPDATE campaigns SET capacity=1 WHERE id=?").run(c);
    assert.throws(() => finalizeSelection(db, actor, c, [a1, a2]));
    db.prepare("UPDATE campaigns SET capacity=2 WHERE id=?").run(c);
    db.prepare(
      "UPDATE influencer_profiles SET blacklisted=1 WHERE user_id=?",
    ).run(u2);
    assert.throws(() => finalizeSelection(db, actor, c, [a1, a2]));
    db.prepare(
      "UPDATE influencer_profiles SET blacklisted=0 WHERE user_id=?",
    ).run(u2);
    db.prepare("UPDATE applications SET status='rejected' WHERE id=?").run(a2);
    assert.throws(() => finalizeSelection(db, actor, c, [a1, a2]));
    assert.equal(
      count(db, "SELECT COUNT(*) n FROM applications WHERE status='selected'"),
      0,
    );
    assert.equal(count(db, "SELECT COUNT(*) n FROM email_outbox"), 0);
    assert.equal(count(db, "SELECT COUNT(*) n FROM application_events"), 0);
  } finally {
    db.close();
    if (old === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = old;
  }
});
