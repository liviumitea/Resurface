import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MIGRATIONS, MigrationError, SCHEMA_VERSION, runMigrations, schemaVersion, type Migration } from "../src/migrations";
import { createStore } from "../src/store";
import { SCHEMA_0_1_0_SQL } from "./fixtures/schema-0.1.0";
import { local, migrationDatabase } from "./harness";

process.env.TZ = "Europe/Bucharest";

const TABLES = ["insights", "events", "reflections", "settings", "analytics"];

/** A database exactly as the 0.1.0 build left it: tables, no user_version, and real-looking data. */
function releasedDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(SCHEMA_0_1_0_SQL);
  const insert = (sql: string, ...values: (string | number | null)[]) => sqlite.prepare(sql).run(...values);
  insert("INSERT INTO insights VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "text", "Kept words", "Context", null, null, "active", "2026-10-01T06:00:00.000Z", "2026-10-01T06:00:00.000Z");
  insert("INSERT INTO insights VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "photo", null, null, "file:///old/photo.enc", "image/jpeg", "paused", "2026-10-02T06:00:00.000Z", "2026-10-02T06:00:00.000Z");
  insert("INSERT INTO events (id, insightId, stage, scheduledAt, shownAt, response) VALUES (?, ?, ?, ?, ?, ?)", "e1", "text", 0, "2026-10-02T06:00:00.000Z", "2026-10-02T07:00:00.000Z", "yes");
  insert("INSERT INTO events (id, insightId, stage, scheduledAt) VALUES (?, ?, ?, ?)", "e2", "text", 1, "2026-10-05T07:00:00.000Z");
  insert("INSERT INTO events (id, insightId, stage, scheduledAt, cancelledAt) VALUES (?, ?, ?, ?, ?)", "e3", "photo", 0, "2026-10-03T06:00:00.000Z", "2026-10-02T08:00:00.000Z");
  insert("INSERT INTO reflections VALUES (?, ?, ?, ?, ?)", "r1", "text", "e1", "Still true", "2026-10-02T07:01:00.000Z");
  insert("INSERT INTO settings VALUES (?, ?)", "dailyCap", "5");
  insert("INSERT INTO analytics VALUES (?, ?, ?)", "a1", "insight_created", "2026-10-01T06:00:00.000Z");
  return sqlite;
}

const snapshot = (sqlite: DatabaseSync) =>
  Object.fromEntries(TABLES.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map((row) => ({ ...row }))]));

test("the 0.1.0 database upgrades to the current schema with every record intact", async () => {
  const sqlite = releasedDatabase();
  try {
    const before = snapshot(sqlite);
    assert.equal(await schemaVersion(migrationDatabase(sqlite)), 0);
    assert.equal(await runMigrations(migrationDatabase(sqlite)), SCHEMA_VERSION);
    assert.equal(await schemaVersion(migrationDatabase(sqlite)), SCHEMA_VERSION);
    assert.deepEqual(snapshot(sqlite), before, "insights, photo paths, events, reflections, settings and counters unchanged");

    // The production store works on the upgraded data.
    const store = createStore({ db: () => adapt(sqlite), id: () => "new-id", now: () => local(2026, 10, 6, 10) });
    assert.equal((await store.getSettings()).dailyCap, 5);
    assert.deepEqual((await store.selectToday()).map((item) => item.insight.id), ["text"]);
    assert.equal((await store.getDetail("photo"))!.insight.imagePath, "file:///old/photo.enc");
  } finally { sqlite.close(); }
});

test("a new, empty database is created at the current version", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    assert.equal(await runMigrations(migrationDatabase(sqlite)), SCHEMA_VERSION);
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => (row as { name: string }).name);
    assert.deepEqual(tables, [...TABLES].sort());
  } finally { sqlite.close(); }
});

test("reopening an already-migrated database changes nothing", async () => {
  const sqlite = releasedDatabase();
  try {
    await runMigrations(migrationDatabase(sqlite));
    const once = snapshot(sqlite);
    const schema = sqlite.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
    assert.equal(await runMigrations(migrationDatabase(sqlite)), SCHEMA_VERSION);
    assert.deepEqual(snapshot(sqlite), once);
    assert.deepEqual(sqlite.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(), schema);
  } finally { sqlite.close(); }
});

test("a failed migration rolls back to the previous readable version with a non-destructive error", async () => {
  const sqlite = releasedDatabase();
  try {
    await runMigrations(migrationDatabase(sqlite));
    const before = snapshot(sqlite);
    const broken: Migration[] = [...MIGRATIONS, {
      version: SCHEMA_VERSION + 1,
      // The first statement succeeds, the second fails: both must be undone.
      sql: "ALTER TABLE insights ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0; UPDATE insights SET favorite = 1; ALTER TABLE missing_table ADD COLUMN x TEXT;",
    }];
    await assert.rejects(runMigrations(migrationDatabase(sqlite), broken),
      (error: unknown) => error instanceof MigrationError && error.reason === "migration_failed" && /has not been changed/.test(error.message));
    assert.equal(await schemaVersion(migrationDatabase(sqlite)), SCHEMA_VERSION, "version not bumped");
    assert.deepEqual(snapshot(sqlite), before, "data and columns as before");
    const columns = sqlite.prepare("PRAGMA table_info(insights)").all().map((row) => (row as { name: string }).name);
    assert.ok(!columns.includes("favorite"), "the partly applied column was rolled back");
  } finally { sqlite.close(); }
});

test("a later migration applies on top and keeps data", async () => {
  const sqlite = releasedDatabase();
  try {
    const next: Migration[] = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, sql: "ALTER TABLE insights ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;" }];
    const before = snapshot(sqlite);
    assert.equal(await runMigrations(migrationDatabase(sqlite), next), SCHEMA_VERSION + 1);
    const after = snapshot(sqlite);
    assert.deepEqual(after.insights, before.insights!.map((row) => ({ ...row, favorite: 0 })));
    assert.deepEqual(after.events, before.events);
  } finally { sqlite.close(); }
});

test("a database from a newer app version is refused without being touched", async () => {
  const sqlite = releasedDatabase();
  try {
    await runMigrations(migrationDatabase(sqlite));
    sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    const before = snapshot(sqlite);
    await assert.rejects(runMigrations(migrationDatabase(sqlite)),
      (error: unknown) => error instanceof MigrationError && error.reason === "schema_too_new" && /newer version/.test(error.message));
    assert.equal(await schemaVersion(migrationDatabase(sqlite)), SCHEMA_VERSION + 1);
    assert.deepEqual(snapshot(sqlite), before);
  } finally { sqlite.close(); }
});

test("migrations are consecutive and start at 1", () => {
  assert.deepEqual(MIGRATIONS.map((migration) => migration.version), MIGRATIONS.map((_, index) => index + 1));
});

/** Minimal store adapter over the upgraded fixture database. */
function adapt(sqlite: DatabaseSync) {
  const plain = <T>(row: unknown) => ({ ...(row as object) }) as T;
  return {
    runAsync: async (source: string, ...params: (string | number | null)[]) => ({ changes: Number(sqlite.prepare(source).run(...params).changes) }),
    getFirstAsync: async <T>(source: string, ...params: (string | number | null)[]) => { const row = sqlite.prepare(source).get(...params); return row ? plain<T>(row) : null; },
    getAllAsync: async <T>(source: string, ...params: (string | number | null)[]) => sqlite.prepare(source).all(...params).map((row) => plain<T>(row)),
    withTransactionAsync: async (task: () => Promise<void>) => { sqlite.exec("BEGIN"); try { await task(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
  };
}
