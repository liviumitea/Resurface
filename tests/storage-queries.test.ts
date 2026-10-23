import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dueForStage } from "../src/domain";
import {
  CREATE_SCHEMA_SQL, SELECT_NOTIFICATION_CANDIDATES_SQL,
  SELECT_TODAY_DUE_SQL, SELECT_TODAY_EXISTING_SQL,
} from "../src/storage-queries";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(CREATE_SCHEMA_SQL);
  return db;
}

function insight(db: DatabaseSync, id: string, status = "active"): void {
  db.prepare("INSERT INTO insights (id, content, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run(id, `Insight ${id}`, status, "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z");
}

function event(db: DatabaseSync, id: string, insightId: string, scheduledAt: string): void {
  db.prepare("INSERT INTO events (id, insightId, stage, scheduledAt) VALUES (?, ?, 0, ?)")
    .run(id, insightId, scheduledAt);
}

function ids(rows: unknown[]): string[] {
  return rows.map((row) => (row as { id: string }).id);
}

test("Today takes the oldest overdue events up to the cap and leaves the rest due", () => {
  const db = database();
  try {
    for (const id of ["old", "recent", "future", "paused", "archived"]) {
      insight(db, id, id === "paused" || id === "archived" ? id : "active");
    }
    event(db, "event-old", "old", "2026-10-02T09:00:00.000Z");
    event(db, "event-recent", "recent", "2026-10-22T09:00:00.000Z");
    event(db, "event-future", "future", "2026-10-24T09:00:00.000Z");
    event(db, "event-paused", "paused", "2026-10-01T09:00:00.000Z");
    event(db, "event-archived", "archived", "2026-10-01T09:00:00.000Z");

    const clock = "2026-10-23T12:00:00.000Z";
    const day = "2026-10-23";
    const first = db.prepare(SELECT_TODAY_DUE_SQL).all(clock, day, 1);
    assert.deepEqual(ids(first), ["event-old"]);
    db.prepare("UPDATE events SET selectedDay = ?, selectedAt = ? WHERE id = ?")
      .run(day, clock, "event-old");

    assert.deepEqual(ids(db.prepare(SELECT_TODAY_EXISTING_SQL).all(day)), ["event-old"]);
    assert.deepEqual(ids(db.prepare(SELECT_TODAY_DUE_SQL).all(clock, day, 1)), ["event-recent"]);
    assert.deepEqual(ids(db.prepare(SELECT_TODAY_DUE_SQL).all("2026-10-24T12:00:00.000Z", "2026-10-24", 3)),
      ["event-old", "event-recent", "event-future"]);
  } finally {
    db.close();
  }
});

test("an actually shown event leaves Today's due queue and starts the next gap", () => {
  const db = database();
  try {
    insight(db, "one");
    event(db, "first", "one", "2026-10-02T09:00:00.000Z");
    const shownAt = "2026-10-23T12:00:00.000Z";
    db.prepare("UPDATE events SET shownAt = ? WHERE id = ?").run(shownAt, "first");
    const nextDue = dueForStage(new Date(shownAt), 1);
    db.prepare("INSERT INTO events (id, insightId, stage, scheduledAt) VALUES (?, ?, ?, ?)")
      .run("second", "one", 1, nextDue);

    assert.deepEqual(ids(db.prepare(SELECT_TODAY_DUE_SQL).all(shownAt, "2026-10-23", 3)), []);
    assert.deepEqual(ids(db.prepare(SELECT_TODAY_DUE_SQL).all(nextDue, "2026-10-26", 3)), ["second"]);
  } finally {
    db.close();
  }
});

test("notification candidates exclude inactive, shown, cancelled, and already planned-past events", () => {
  const db = database();
  try {
    for (const id of ["active", "paused", "shown", "cancelled", "notified"]) {
      insight(db, id, id === "paused" ? "paused" : "active");
      event(db, id, id, "2026-10-22T09:00:00.000Z");
    }
    db.prepare("UPDATE events SET shownAt = ? WHERE id = 'shown'").run("2026-10-23T09:00:00.000Z");
    db.prepare("UPDATE events SET cancelledAt = ? WHERE id = 'cancelled'").run("2026-10-23T09:00:00.000Z");
    db.prepare("UPDATE events SET notificationPlannedFor = ? WHERE id = 'notified'").run("2026-10-22T10:00:00.000Z");

    assert.deepEqual(ids(db.prepare(SELECT_NOTIFICATION_CANDIDATES_SQL).all("2026-10-23T12:00:00.000Z")), ["active"]);
  } finally {
    db.close();
  }
});
