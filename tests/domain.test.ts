import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarDays, dueForStage, isValidInsight, localDay, nextNotificationDate, shouldAskValueFeedback } from "../src/domain";

test("the first exposure is a day after saving", () => {
  assert.equal(dueForStage(new Date("2026-10-01T09:00:00Z"), 0), "2026-10-02T09:00:00.000Z");
});

test("later gaps are measured from actual viewing and cap at 120 days", () => {
  assert.equal(dueForStage(new Date("2026-10-04T09:00:00Z"), 1), "2026-10-07T09:00:00.000Z");
  const viewed = new Date("2026-10-04T09:00:00Z");
  assert.equal(dueForStage(viewed, 99), addCalendarDays(viewed, 120).toISOString());
});

test("image-only insights are valid, whitespace-only text is not", () => {
  assert.equal(isValidInsight("  ", false), false);
  assert.equal(isValidInsight(null, true), true);
});

test("notifications schedule after due time and in the user's local day", () => {
  const clock = new Date(2026, 9, 1, 10, 0);
  const next = nextNotificationDate(new Date(2026, 9, 1, 8, 0).toISOString(), clock, "09:00");
  assert.equal(localDay(next), localDay(addCalendarDays(clock, 1)));
  assert.equal(next.getHours(), 9);
});

test("feedback stays occasional", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].filter(shouldAskValueFeedback), [1, 3, 6]);
});
