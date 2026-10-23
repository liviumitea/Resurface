import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { localDay, planNotifications, type ResurfaceEvent } from "../src/domain";
import { CREATE_SCHEMA_SQL } from "../src/storage-queries";
import { createStore, type StoreDatabase } from "../src/store";

// A zone with daylight-saving changes, where local midnight differs from UTC midnight.
// Each test file runs in its own process, so this does not leak into other tests.
process.env.TZ = "Europe/Bucharest";

/** Runs the production store over node:sqlite, the same SQLite engine family SQLCipher wraps. */
function harness(start: Date) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(CREATE_SCHEMA_SQL);
  const plain = <T>(row: unknown) => ({ ...(row as object) }) as T;
  const database: StoreDatabase = {
    runAsync: async (source, ...params) => ({ changes: Number(sqlite.prepare(source).run(...(params as SQLInputValue[])).changes) }),
    getFirstAsync: async <T>(source: string, ...params: (string | number | null)[]) => {
      const row = sqlite.prepare(source).get(...(params as SQLInputValue[]));
      return row ? plain<T>(row) : null;
    },
    getAllAsync: async <T>(source: string, ...params: (string | number | null)[]) =>
      sqlite.prepare(source).all(...(params as SQLInputValue[])).map((row) => plain<T>(row)),
    withTransactionAsync: async (task) => {
      sqlite.exec("BEGIN");
      try { await task(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  let current = new Date(start);
  let counter = 0;
  const open = () => createStore({ db: () => database, id: () => `id-${String(++counter).padStart(4, "0")}`, now: () => new Date(current) });
  return {
    sqlite,
    store: open(),
    /** A fresh store over the same database, as after an app restart. */
    restart: open,
    setClock: (next: Date) => { current = new Date(next); },
    clock: () => new Date(current),
    events: (insightId: string) => sqlite.prepare("SELECT * FROM events WHERE insightId = ? ORDER BY scheduledAt").all(insightId).map((row) => plain<ResurfaceEvent>(row)),
    pending: (insightId: string) => sqlite.prepare("SELECT * FROM events WHERE insightId = ? AND shownAt IS NULL AND cancelledAt IS NULL").all(insightId).map((row) => plain<ResurfaceEvent>(row)),
    close: () => sqlite.close(),
  };
}

const local = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute);
const calendarDaysAfter = (from: Date, days: number) =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds());
const insightIds = (items: { insight: { id: string } }[]) => items.map((item) => item.insight.id);

test("saving schedules one pending event, due one calendar day later", async () => {
  const h = harness(local(2026, 10, 1, 9, 0));
  try {
    const insight = await h.store.insertInsight("insight-a", "Write it down", null, null);
    const pending = h.pending(insight.id);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.stage, 0);
    assert.equal(pending[0]!.scheduledAt, local(2026, 10, 2, 9, 0).toISOString());

    assert.deepEqual(await h.store.selectToday(local(2026, 10, 2, 8, 59)), []);
    assert.deepEqual(insightIds(await h.store.selectToday(local(2026, 10, 2, 9, 0))), [insight.id]);
  } finally { h.close(); }
});

test("each gap starts when the card is actually shown and the 120-day gap repeats", async () => {
  const h = harness(local(2026, 1, 5, 9, 0));
  try {
    await h.store.insertInsight("insight-a", "Gaps", null, null);
    let from = h.clock();
    for (const [index, gap] of [1, 3, 7, 14, 30, 60, 120, 120].entries()) {
      const pending = h.pending("insight-a");
      assert.equal(pending.length, 1, `exactly one pending event at step ${index}`);
      assert.equal(pending[0]!.stage, Math.min(index, 6));
      assert.equal(pending[0]!.scheduledAt, calendarDaysAfter(from, gap).toISOString(), `gap ${gap} at step ${index}`);
      // The user opens the app five hours after it became due; the next gap runs from then.
      const shownAt = new Date(new Date(pending[0]!.scheduledAt).getTime() + 5 * 60 * 60 * 1000);
      h.setClock(shownAt);
      const [item] = await h.store.selectToday();
      assert.equal(item?.event.id, pending[0]!.id);
      await h.store.markShown(item!.event.id);
      from = shownAt;
    }
  } finally { h.close(); }
});

test("opening a notification does not count as seeing the insight", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("insight-a", "Notified", null, null);
    const [event] = h.pending("insight-a");
    h.setClock(local(2026, 10, 2, 10));
    await h.store.markOpened(event!.id);
    const after = h.pending("insight-a");
    assert.deepEqual(after.map((row) => row.id), [event!.id]);
    assert.ok(after[0]!.openedAt);
    assert.deepEqual(insightIds(await h.store.selectToday()), ["insight-a"]);
    assert.equal(h.events("insight-a").length, 1, "no next event until the card is shown");
  } finally { h.close(); }
});

test("Today takes the oldest overdue first up to the cap, stays stable within a local day, and survives a restart", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    for (const [index, name] of ["a", "b", "c", "d", "e"].entries()) {
      h.setClock(local(2026, 10, 1 + index));
      await h.store.insertInsight(`insight-${name}`, name, null, null);
    }
    h.setClock(local(2026, 10, 20, 8));
    const morning = await h.store.selectToday();
    assert.deepEqual(insightIds(morning), ["insight-a", "insight-b", "insight-c"], "default cap 3, oldest first");

    h.setClock(local(2026, 10, 20, 21));
    assert.deepEqual(insightIds(await h.restart().selectToday()), insightIds(morning), "same selection after restart");

    await h.store.saveSettings({ dailyCap: 1 });
    assert.deepEqual(insightIds(await h.store.selectToday()), insightIds(morning), "lowering the cap keeps today's selection");
    await h.store.saveSettings({ dailyCap: 5 });
    assert.deepEqual(insightIds(await h.store.selectToday()), ["insight-a", "insight-b", "insight-c", "insight-d", "insight-e"]);
  } finally { h.close(); }
});

test("items not shown stay due and return on the next local day", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    for (const [index, name] of ["a", "b", "c", "d"].entries()) {
      h.setClock(local(2026, 10, 1 + index));
      await h.store.insertInsight(`insight-${name}`, name, null, null);
    }
    h.setClock(local(2026, 10, 20, 8));
    const [first] = await h.store.selectToday();
    await h.store.markShown(first!.event.id);
    await h.store.markCompleted(first!.event.id);

    h.setClock(local(2026, 10, 21, 8));
    assert.deepEqual(insightIds(await h.store.selectToday()), ["insight-b", "insight-c", "insight-d"],
      "the shown insight waits for its 3-day gap; the skipped ones are still due");
  } finally { h.close(); }
});

test("Today follows the local day, not the UTC day", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("insight-a", "Late night", null, null);
    await h.store.insertInsight("insight-b", "Also due", null, null);
    await h.store.saveSettings({ dailyCap: 1 });

    const lateEvening = local(2026, 10, 10, 23, 50);
    const afterMidnight = local(2026, 10, 11, 0, 10);
    assert.notEqual(localDay(afterMidnight), afterMidnight.toISOString().slice(0, 10), "00:10 local is still the previous UTC day");

    assert.deepEqual(insightIds(await h.store.selectToday(lateEvening)), ["insight-a"]);
    assert.deepEqual(insightIds(await h.store.selectToday(new Date(lateEvening.getTime() + 5 * 60 * 1000))), ["insight-a"]);
    const nextDay = await h.store.selectToday(afterMidnight);
    assert.equal(nextDay.length, 1);
    assert.equal(nextDay[0]!.event.selectedDay, localDay(afterMidnight), "a new local day makes a new selection");
  } finally { h.close(); }
});

test("calendar-day gaps keep the local time across daylight-saving changes", async () => {
  // Europe/Bucharest leaves DST on 25 Oct 2026 and enters it on 28 Mar 2027.
  for (const [saved, hours] of [[local(2026, 10, 24, 9), 25], [local(2027, 3, 27, 9), 23]] as const) {
    const h = harness(saved);
    try {
      await h.store.insertInsight("insight-a", "DST", null, null);
      const due = new Date(h.pending("insight-a")[0]!.scheduledAt);
      assert.equal(due.getHours(), 9);
      assert.equal(due.getDate(), saved.getDate() + 1);
      assert.equal((due.getTime() - saved.getTime()) / 3_600_000, hours);
    } finally { h.close(); }
  }
});

for (const [response, status, keepsResurfacing] of [["yes", "active", true], ["not_now", "paused", false], ["not_anymore", "archived", false]] as const) {
  test(`responding "${response}" keeps the reflection note and leaves the insight ${status}`, async () => {
    const h = harness(local(2026, 10, 1));
    try {
      await h.store.insertInsight("insight-a", "Respond", null, null);
      h.setClock(local(2026, 10, 2, 10));
      const [item] = await h.store.selectToday();
      await h.store.markShown(item!.event.id);
      await h.store.respondToEvent(item!.event.id, response, `  Note for ${response}  `);

      const detail = await h.store.getDetail("insight-a");
      assert.equal(detail!.insight.status, status);
      assert.deepEqual(detail!.reflections.map((reflection) => [reflection.eventId, reflection.content]), [[item!.event.id, `Note for ${response}`]]);
      assert.equal(detail!.events.find((event) => event.id === item!.event.id)!.response, response);
      assert.equal(h.pending("insight-a").length, keepsResurfacing ? 1 : 0);

      await h.store.respondToEvent(item!.event.id, "yes", "second answer");
      assert.equal((await h.store.getDetail("insight-a"))!.reflections.length, 1, "an event can be answered once");
    } finally { h.close(); }
  });
}

test("a response before the card is shown is ignored", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("insight-a", "Not yet", null, null);
    const [event] = h.pending("insight-a");
    await h.store.respondToEvent(event!.id, "not_anymore", "too early");
    const detail = await h.store.getDetail("insight-a");
    assert.equal(detail!.insight.status, "active");
    assert.equal(detail!.reflections.length, 0);
  } finally { h.close(); }
});

for (const [status, restoredEvent] of [["paused", "insight_resumed"], ["archived", "insight_restored"]] as const) {
  test(`${status} cancels the pending event; making it active restarts at the one-day gap`, async () => {
    const h = harness(local(2026, 10, 1));
    try {
      await h.store.insertInsight("insight-a", status, null, null);
      h.setClock(local(2026, 10, 2, 10));
      assert.equal((await h.store.selectToday()).length, 1);
      await h.store.setInsightStatus("insight-a", status);
      assert.equal(h.pending("insight-a").length, 0);
      assert.deepEqual(await h.store.selectToday(), [], "removed from today's selection");
      assert.deepEqual(await h.store.notificationCandidates(), [], "no notification targets it");

      const resumedAt = local(2026, 11, 15, 18, 30);
      h.setClock(resumedAt);
      await h.store.setInsightStatus("insight-a", "active");
      const pending = h.pending("insight-a");
      assert.equal(pending.length, 1);
      assert.equal(pending[0]!.stage, 0);
      assert.equal(pending[0]!.scheduledAt, calendarDaysAfter(resumedAt, 1).toISOString());
      assert.equal(h.events("insight-a").length, 2, "history is kept");
      assert.ok(h.sqlite.prepare("SELECT 1 FROM analytics WHERE name = ?").get(restoredEvent));
    } finally { h.close(); }
  });
}

test("showing a card for an inactive insight does nothing", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("insight-a", "Paused", null, null);
    const [event] = h.pending("insight-a");
    await h.store.setInsightStatus("insight-a", "paused");
    await h.store.markShown(event!.id, local(2026, 10, 3));
    assert.equal(h.events("insight-a").length, 1);
    assert.equal(h.events("insight-a")[0]!.shownAt, null);
  } finally { h.close(); }
});

test("deleting an insight removes its events and reflections", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("insight-a", "Delete me", null, "file:///private/insight-a.enc");
    h.setClock(local(2026, 10, 2, 10));
    const [item] = await h.store.selectToday();
    await h.store.markShown(item!.event.id);
    await h.store.respondToEvent(item!.event.id, "yes", "a note");

    assert.deepEqual(await h.store.deleteInsightRow("insight-a"), { imagePath: "file:///private/insight-a.enc" });
    assert.equal(await h.store.getDetail("insight-a"), null);
    assert.equal(h.events("insight-a").length, 0);
    assert.equal((h.sqlite.prepare("SELECT count(*) AS count FROM reflections").get() as { count: number }).count, 0);
    assert.deepEqual(await h.store.notificationCandidates(), []);
  } finally { h.close(); }
});

test("a notification planned in the past is not planned again; future plans are rebuilt", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("insight-past", "past", null, null);
    await h.store.insertInsight("insight-future", "future", null, null);
    const [past] = h.pending("insight-past");
    const [future] = h.pending("insight-future");
    h.setClock(local(2026, 10, 3, 12));
    await h.store.setNotificationPlan(past!.id, "n-1", local(2026, 10, 2, 9).toISOString());
    await h.store.setNotificationPlan(future!.id, "n-2", local(2026, 10, 4, 9).toISOString());

    await h.store.clearFutureNotificationPlans();
    const candidates = await h.store.notificationCandidates();
    assert.deepEqual(candidates.map((candidate) => candidate.id), [future!.id]);
    assert.equal(candidates[0]!.notificationPlannedFor, null);
  } finally { h.close(); }
});

test("notification plans: at most 30, one per local day, never before due, generic by default", () => {
  const clock = local(2026, 10, 1, 12);
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    id: `event-${String(index).padStart(2, "0")}`, insightId: `insight-${index}`,
    scheduledAt: local(2026, 10, 1 + Math.floor(index / 4), 6).toISOString(), content: "x".repeat(200),
  }));
  const plans = planNotifications(candidates, { notificationTime: "09:00", showInsightText: false }, clock);
  assert.equal(plans.length, 30);
  assert.equal(new Set(plans.map((plan) => localDay(plan.when))).size, 30);
  for (const [index, plan] of plans.entries()) {
    assert.equal(plan.eventId, candidates[index]!.id, "oldest due first");
    assert.ok(plan.when.getTime() > clock.getTime());
    assert.ok(plan.when.getTime() >= new Date(candidates[index]!.scheduledAt).getTime());
    assert.equal(plan.when.getHours(), 9);
    assert.equal(plan.title, "Resurface");
    assert.ok(!plan.body.includes("x"), "no insight text unless the user opted in");
  }

  const personal = planNotifications(candidates.slice(0, 1), { notificationTime: "09:00", showInsightText: true }, clock);
  assert.equal(personal[0]!.body, "x".repeat(140));
});
