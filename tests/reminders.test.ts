import assert from "node:assert/strict";
import test from "node:test";
import { localDay, nextNotificationDate, normalizeQuietDays, planNotifications } from "../src/domain";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const WEEKEND = [0, 6];
const event = (id: string, scheduledAt: Date) => ({ id, insightId: `insight-${id}`, scheduledAt: scheduledAt.toISOString(), content: null });
const days = (plans: { when: Date }[]) => plans.map((plan) => `${localDay(plan.when)} ${plan.when.toTimeString().slice(0, 5)}`);

test("quiet days are opt-in, validated, and all seven count as none", () => {
  assert.deepEqual(normalizeQuietDays(undefined), []);
  assert.deepEqual(normalizeQuietDays([6, 0, 6, 9, -1, 1.5, "2"]), [0, 6]);
  assert.deepEqual(normalizeQuietDays([0, 1, 2, 3, 4, 5, 6]), [], "every day quiet would silence reminders; notifications off does that");
});

test("a reminder due on a quiet day moves to the next allowed day at the same time", () => {
  // 2 October 2026 is a Friday.
  const clock = local(2026, 10, 2, 12);
  const due = local(2026, 10, 2, 6).toISOString();
  assert.equal(localDay(nextNotificationDate(due, clock, "09:00")), "2026-10-03", "without quiet days: Saturday");
  const moved = nextNotificationDate(due, clock, "09:00", WEEKEND);
  assert.equal(localDay(moved), "2026-10-05");
  assert.equal(moved.getHours(), 9);
  assert.equal(localDay(nextNotificationDate(due, clock, "09:00", [0, 1, 2, 3, 4, 5, 6])), "2026-10-03", "all seven are ignored");
});

test("one reminder per day still holds around quiet days, and none is planned before it is due", () => {
  const clock = local(2026, 10, 2, 12);
  const candidates = ["a", "b", "c", "d"].map((id) => event(id, local(2026, 10, 2, 6)));
  const plans = planNotifications(candidates, { notificationTime: "09:00", showInsightText: false, quietDays: WEEKEND }, clock);
  assert.deepEqual(days(plans), ["2026-10-05 09:00", "2026-10-06 09:00", "2026-10-07 09:00", "2026-10-08 09:00"]);

  const later = planNotifications([event("x", local(2026, 10, 9, 18))], { notificationTime: "09:00", showInsightText: false, quietDays: WEEKEND }, clock);
  assert.deepEqual(days(later), ["2026-10-12 09:00"], "due Friday evening: past Friday's slot, so the next weekday");
});

test("the chosen time holds across both daylight-saving changes", () => {
  // Europe/Bucharest: clocks go back at 04:00 on 25 October 2026 and forward at 03:00 on 28 March 2027.
  const autumn = planNotifications(["a", "b", "c"].map((id) => event(id, local(2026, 10, 24, 6))),
    { notificationTime: "09:00", showInsightText: false }, local(2026, 10, 24, 12));
  assert.deepEqual(days(autumn), ["2026-10-25 09:00", "2026-10-26 09:00", "2026-10-27 09:00"]);

  const spring = planNotifications(["a", "b", "c"].map((id) => event(id, local(2027, 3, 27, 6))),
    { notificationTime: "03:30", showInsightText: false }, local(2027, 3, 27, 12));
  assert.deepEqual(days(spring), ["2027-03-28 04:30", "2027-03-29 03:30", "2027-03-30 03:30"],
    "03:30 does not exist on 28 March; the next day is back at 03:30, not 04:30");
});

test("after a time-zone change, reconciliation plans reminders at the chosen local time there", () => {
  const due = new Date("2026-10-02T03:00:00.000Z");
  const clock = new Date("2026-10-02T10:00:00.000Z");
  try {
    const here = planNotifications([event("a", due)], { notificationTime: "09:00", showInsightText: false }, clock);
    process.env.TZ = "America/New_York";
    const there = planNotifications([event("a", due)], { notificationTime: "09:00", showInsightText: false }, clock);
    assert.equal(here[0]!.when.toISOString(), "2026-10-03T06:00:00.000Z", "09:00 in Bucharest");
    assert.equal(there[0]!.when.toISOString(), "2026-10-02T13:00:00.000Z", "09:00 the same day in New York, which is still ahead");
  } finally { process.env.TZ = "Europe/Bucharest"; }
});

test("quiet days are stored with the settings and drive the store's reminder queue", async () => {
  const h = harness(local(2026, 10, 1, 8));
  try {
    assert.deepEqual((await h.store.getSettings()).quietDays, [], "off by default");
    const saved = await h.store.saveSettings({ quietDays: [6, 0, 6] });
    assert.deepEqual(saved.quietDays, [0, 6]);
    assert.deepEqual((await h.restart().getSettings()).quietDays, [0, 6], "kept across a restart");

    await h.store.insertInsight("a", "First", null, null);
    await h.store.insertInsight("b", "Second", null, null);
    h.setClock(local(2026, 10, 2, 12));
    const settings = await h.store.getSettings();
    const plans = planNotifications(await h.store.notificationCandidates(), settings, h.clock());
    assert.deepEqual(days(plans), ["2026-10-05 09:00", "2026-10-06 09:00"]);
    for (const plan of plans) await h.store.setNotificationPlan(plan.eventId, `n-${plan.eventId}`, plan.when.toISOString());

    // Turning quiet days off re-plans the future queue from the same pending events.
    await h.store.saveSettings({ quietDays: [] });
    await h.store.clearFutureNotificationPlans();
    const replanned = planNotifications(await h.store.notificationCandidates(), await h.store.getSettings(), h.clock());
    assert.deepEqual(days(replanned), ["2026-10-03 09:00", "2026-10-04 09:00"]);
  } finally { h.close(); }
});
