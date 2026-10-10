import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/seoul/db.js";
import { recalculateTier } from "../src/seoul/workflow.js";
import { tierLabel } from "../src/seoul/tier.js";
import { initializeWorkflow } from "../src/seoul/workflow-db.js";
test("tier boundaries use completions without views and preserve penalties", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO users(id,email,name,role,password_hash) VALUES(1,'test@example.com','Test','influencer','unused')",
  ).run();
  for (const [count, tier, label] of [
    [0, 0, "미등급"],
    [1, 0, "브론즈"],
    [9, 0, "브론즈"],
    [10, 1, "실버"],
    [49, 1, "실버"],
    [50, 2, "골드"],
    [99, 2, "골드"],
    [100, 3, "플래티넘"],
    [101, 3, "플래티넘"],
  ] as const) {
    db.prepare(
      "UPDATE influencer_profiles SET completed_count=?,total_views=0 WHERE user_id=1",
    ).run(count);
    recalculateTier(db, 1);
    const p = db
      .prepare("SELECT * FROM influencer_profiles WHERE user_id=1")
      .get() as any;
    assert.equal(p.tier, tier);
    assert.equal(tierLabel(p.tier, p.completed_count), label);
  }
  db.prepare(
    "UPDATE influencer_profiles SET no_show_count=1 WHERE user_id=1",
  ).run();
  recalculateTier(db, 1);
  assert.equal(
    (
      db
        .prepare("SELECT tier FROM influencer_profiles WHERE user_id=1")
        .get() as any
    ).tier,
    2,
  );
  db.close();
});
test("existing tiers migrate once while later administrator settings remain", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO users(id,email,name,role,password_hash) VALUES(1,'test@example.com','Test','influencer','unused')",
  ).run();
  db.exec(
    "DELETE FROM schema_version WHERE version=9; UPDATE workflow_settings SET tier2_count=3,tier3_count=10,tier4_count=20; UPDATE influencer_profiles SET completed_count=50,tier=3",
  );
  initializeWorkflow(db);
  assert.equal(
    (
      db
        .prepare("SELECT tier FROM influencer_profiles WHERE user_id=1")
        .get() as any
    ).tier,
    2,
  );
  assert.equal(
    (db.prepare("SELECT tier4_count FROM workflow_settings").get() as any)
      .tier4_count,
    100,
  );
  db.exec("UPDATE workflow_settings SET tier2_count=11");
  initializeWorkflow(db);
  assert.equal(
    (db.prepare("SELECT tier2_count FROM workflow_settings").get() as any)
      .tier2_count,
    11,
  );
  db.close();
});
