import assert from "node:assert/strict";
import test from "node:test";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

/** Every counter name the app may record. A new name must be added here deliberately. */
const KNOWN_EVENTS = new Set([
  "insight_created", "insight_created_text", "insight_created_photo", "insight_created_ocr",
  "resurface_selected", "resurface_shown", "notification_opened", "notification_scheduled",
  "reflection_added", "reflection_edited", "reflection_removed", "still_relevant", "insight_paused", "insight_archived", "insight_resumed",
  "insight_restored", "insight_snoozed", "insight_deleted", "resurface_value_feedback_asked", "resurface_value_feedback",
  "category_created", "category_deleted", "backup_created", "backup_created_incomplete", "backup_verified", "backup_restored", "share_received", "onboarding_started", "onboarding_completed",
]);

test("beta signals match fixture data", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    for (const name of ["a", "b", "c", "d"]) await h.store.insertInsight(`insight-${name}`, name, null, null);
    const saveTime = local(2026, 10, 1).toISOString();
    assert.deepEqual(await h.store.getBetaMetrics(), { firstSaveAt: saveTime, coreLoopAt: null, saved: 4, shown: 0, asked: 0, answered: 0, valuable: 0 }, "first-save activation without the core loop");

    h.setClock(local(2026, 10, 2, 10));
    await h.store.saveSettings({ dailyCap: 3 });
    const today = await h.store.selectToday();
    for (const item of today) await h.store.markShown(item.event.id);
    const [first, second] = today;
    await h.store.markValueFeedbackAsked();
    await h.store.saveValueFeedback(first!.event.id, "yes");
    await h.store.markValueFeedbackAsked();
    await h.store.saveValueFeedback(second!.event.id, "not_really");
    await h.store.saveValueFeedback(second!.event.id, "yes");
    await h.store.markValueFeedbackAsked(); // skipped

    const metrics = await h.store.getBetaMetrics();
    const loopTime = local(2026, 10, 2, 10).toISOString();
    assert.deepEqual(metrics, { firstSaveAt: saveTime, coreLoopAt: loopTime, saved: 4, shown: 3, asked: 3, answered: 2, valuable: 1 }, "a second answer to the same event is ignored");
    assert.equal(Math.round((metrics.answered / metrics.shown) * 100), 67, "answer rate = answered / shown");
    assert.equal(Math.round((metrics.valuable / metrics.answered) * 100), 50, "worth rate = yes / answered");

    // Known limitation: deleting an insight removes its history, and so its signals.
    await h.store.deleteInsightRow(first!.insight.id);
    assert.deepEqual(await h.store.getBetaMetrics(), { firstSaveAt: saveTime, coreLoopAt: loopTime, saved: 3, shown: 2, asked: 3, answered: 1, valuable: 0 }, "milestones survive deletion");
  } finally { h.close(); }
});

test("an empty device has neither milestone", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    assert.deepEqual(await h.store.getBetaMetrics(), { firstSaveAt: null, coreLoopAt: null, saved: 0, shown: 0, asked: 0, answered: 0, valuable: 0 });
  } finally { h.close(); }
});

test("usage counters never contain personal content", async () => {
  const h = harness(local(2026, 10, 1));
  const secret = "SECRET-insight-words";
  try {
    await h.store.insertInsight("insight-a", `${secret} text`, `${secret} context`, null);
    await h.store.insertInsight("insight-b", `${secret} photo`, null, "file:///private/insight-b.enc");
    await h.store.insertInsight("insight-c", `${secret} pause`, null, null);
    h.setClock(local(2026, 10, 2, 10));
    const today = await h.store.selectToday();
    for (const item of today) await h.store.markShown(item.event.id);
    await h.store.markOpened(today[0]!.event.id);
    await h.store.respondToEvent(today[0]!.event.id, "yes", `${secret} reflection`);
    await h.store.respondToEvent(today[1]!.event.id, "not_anymore", `${secret} archived`);
    await h.store.markValueFeedbackAsked();
    await h.store.saveValueFeedback(today[0]!.event.id, "yes");
    await h.store.editInsight("insight-a", `${secret} edited`, null);
    await h.store.setInsightStatus("insight-c", "paused");
    await h.store.setInsightStatus("insight-c", "active");
    await h.store.setInsightStatus(today[1]!.insight.id, "active");
    await h.store.setNotificationPlan(h.pending("insight-a")[0]!.id, "notification-1", local(2026, 10, 5, 9).toISOString());
    await h.store.replaceAllRows(await h.store.exportRows(), { "insight-b": "file:///private/restored-b.enc" });
    await h.store.deleteInsightRow("insight-a");

    const rows = h.sqlite.prepare("SELECT * FROM analytics").all() as Record<string, unknown>[];
    assert.ok(rows.length > 10);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ["createdAt", "id", "name"], "counters hold only a name and a time");
      assert.ok(KNOWN_EVENTS.has(row.name as string), `unexpected counter ${String(row.name)}`);
      assert.ok(!JSON.stringify(row).includes(secret));
    }
  } finally { h.close(); }
});
