import assert from "node:assert/strict";
import test from "node:test";
import { upcomingTiming } from "../src/domain";
import { calendarDaysAfter, harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const ids = (list: { items: { insight: { id: string } }[] }) => list.items.map((item) => item.insight.id);

test("Upcoming follows the production schedule through pause, resume, archive, snooze and showing", async () => {
  const day1 = local(2026, 10, 1, 9);
  const h = harness(day1);
  try {
    assert.deepEqual(await h.store.listUpcoming(), { items: [], total: 0 }, "an empty queue");

    for (const [index, idValue] of ["a", "b", "c"].entries()) {
      h.setClock(local(2026, 10, 1, 9, index));
      await h.store.insertInsight(idValue, `Insight ${idValue}`, null, null);
    }
    h.setClock(local(2026, 10, 1, 12));
    let upcoming = await h.store.listUpcoming();
    assert.deepEqual(ids(upcoming), ["a", "b", "c"], "soonest first");
    assert.equal(upcoming.total, 3);
    for (const item of upcoming.items) {
      assert.equal(item.event.scheduledAt, h.pending(item.insight.id)[0]!.scheduledAt, "the same pending event the scheduler uses");
      assert.deepEqual(upcomingTiming(item.event.scheduledAt, h.clock()), { kind: "tomorrow" });
    }

    await h.store.setInsightStatus("b", "paused");
    await h.store.setInsightStatus("c", "archived");
    assert.deepEqual(ids(await h.store.listUpcoming()), ["a"], "paused and archived insights never come back");

    await h.store.setInsightStatus("b", "active");
    upcoming = await h.store.listUpcoming();
    assert.deepEqual(ids(upcoming), ["a", "b"]);
    assert.equal(upcoming.items[1]!.event.scheduledAt, calendarDaysAfter(h.clock(), 1).toISOString(), "resume restarts at the first gap");

    const until = local(2026, 10, 20, 9);
    assert.ok(await h.store.snoozeInsight("a", until));
    upcoming = await h.store.listUpcoming();
    assert.deepEqual(ids(upcoming), ["b", "a"], "a snoozed insight moves to its new date");
    assert.equal(upcoming.items[1]!.event.scheduledAt, until.toISOString());
    assert.deepEqual(upcomingTiming(upcoming.items[1]!.event.scheduledAt, h.clock()), { kind: "date", at: until.toISOString() });
    assert.equal(upcoming.total, 2, "the cancelled event is history, not a second entry");

    // Once due, the insight moves to Today and leaves Upcoming; showing it schedules the next gap.
    h.setClock(local(2026, 10, 2, 13));
    const today = await h.store.selectToday();
    assert.deepEqual(today.map((item) => item.insight.id), ["b"]);
    assert.deepEqual(ids(await h.store.listUpcoming()), ["a"], "items on Today are not listed twice");
    await h.store.markShown(today[0]!.event.id);
    upcoming = await h.store.listUpcoming();
    assert.deepEqual(ids(upcoming), ["b", "a"]);
    assert.equal(upcoming.items[0]!.event.scheduledAt, calendarDaysAfter(h.clock(), 3).toISOString(), "stage 1 waits three days after the actual showing");
    assert.equal(upcoming.items[0]!.event.stage, 1);

    // Looking at Upcoming never counts as a resurfacing.
    assert.equal(await h.store.getShownCount(), 1);
    assert.deepEqual(ids(await h.restart().listUpcoming()), ["b", "a"], "the same after a restart");
  } finally { h.close(); }
});

test("an insight already due but left out by the daily cap shows as waiting", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.saveSettings({ dailyCap: 1 });
    await h.store.insertInsight("first", "First", null, null);
    h.setClock(local(2026, 10, 1, 10));
    await h.store.insertInsight("second", "Second", null, null);
    h.setClock(local(2026, 10, 2, 12));
    assert.deepEqual((await h.store.selectToday()).map((item) => item.insight.id), ["first"]);
    const upcoming = await h.store.listUpcoming();
    assert.deepEqual(ids(upcoming), ["second"]);
    assert.deepEqual(upcomingTiming(upcoming.items[0]!.event.scheduledAt, h.clock()), { kind: "due" });

    // The next day, the waiting insight is Today's pick, as Upcoming said.
    h.setClock(local(2026, 10, 3, 8));
    assert.deepEqual((await h.store.selectToday()).map((item) => item.insight.id), ["first"], "skipped items stay due and oldest goes first");
    assert.deepEqual(ids(await h.store.listUpcoming()), ["second"]);
  } finally { h.close(); }
});

test("Upcoming lists at most the limit but counts everything pending", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    for (let index = 0; index < 25; index++) {
      h.setClock(local(2026, 10, 1, 9, index));
      await h.store.insertInsight(`i-${String(index).padStart(2, "0")}`, `Insight ${index}`, null, null);
    }
    const upcoming = await h.store.listUpcoming(h.clock(), 20);
    assert.equal(upcoming.items.length, 20);
    assert.equal(upcoming.total, 25);
    assert.equal(upcoming.items[0]!.insight.id, "i-00");
  } finally { h.close(); }
});

test("timing labels follow local calendar days, across a time-zone change and the DST night", () => {
  const original = process.env.TZ;
  try {
    // 22:30 UTC on 27 October is already 28 October in Bucharest but still 27 October in London.
    const due = "2026-10-27T22:30:00.000Z";
    const clock = new Date("2026-10-27T10:00:00.000Z");
    process.env.TZ = "Europe/Bucharest";
    assert.deepEqual(upcomingTiming(due, clock), { kind: "tomorrow" });
    process.env.TZ = "Europe/London";
    assert.deepEqual(upcomingTiming(due, clock), { kind: "later_today" });

    // 25 October 2026 has 25 hours in Bucharest; "tomorrow" is still the next calendar day.
    process.env.TZ = "Europe/Bucharest";
    const lateEvening = local(2026, 10, 24, 23, 30);
    assert.deepEqual(upcomingTiming(local(2026, 10, 25, 23, 59).toISOString(), lateEvening), { kind: "tomorrow" });
    assert.equal(upcomingTiming(local(2026, 10, 26, 0, 30).toISOString(), lateEvening).kind, "date");
    assert.deepEqual(upcomingTiming(local(2026, 10, 24, 23, 0).toISOString(), lateEvening), { kind: "due" });
  } finally { process.env.TZ = original; }
});
