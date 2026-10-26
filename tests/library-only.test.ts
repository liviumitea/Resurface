import assert from "node:assert/strict";
import test from "node:test";
import { archiveVersion, validateBackupContents } from "../src/backup";
import { calendarDaysAfter, harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const counters = (h: ReturnType<typeof harness>) =>
  (h.sqlite.prepare("SELECT name FROM analytics ORDER BY rowid").all() as { name: string }[]).map((row) => row.name);

test("an insight saved to Library only gets no event and never enters Today, Upcoming or reminders", async () => {
  const start = local(2026, 10, 1, 9);
  const h = harness(start);
  try {
    const category = await h.store.createCategory("Jokes");
    const saved = await h.store.insertInsight("quiet", "A good joke", "From Ana", null, [category.id], "a friend", false);
    await h.store.insertInsight("photo", null, null, "file:///docs/resurface-images/photo.enc", [], null, false);
    assert.equal(saved.status, "paused");
    assert.deepEqual([h.events("quiet"), h.events("photo")], [[], []], "no event, pending or cancelled");

    const detail = (await h.store.getDetail("quiet"))!;
    assert.deepEqual([detail.insight.content, detail.insight.context, detail.insight.source, detail.categories.map((c) => c.name)], ["A good joke", "From Ana", "a friend", ["Jokes"]]);
    assert.equal(detail.insight.status, "paused");
    assert.deepEqual(h.events("quiet"), [], "opening it is not an exposure");

    for (const days of [0, 1, 3, 30, 200]) {
      const clock = calendarDaysAfter(start, days);
      h.setClock(clock);
      const ids = (await h.restart().selectToday()).map((item) => item.insight.id);
      assert.ok(!ids.includes("quiet") && !ids.includes("photo"), `not in Today after ${days} days`);
      assert.deepEqual(await h.store.notificationCandidates(clock), [], "no reminder");
    }
    assert.deepEqual((await h.store.listUpcoming()).items, []);
    assert.equal(await h.store.getShownCount(), 0);

    const library = await h.store.listInsights("paused");
    assert.deepEqual(library.map((insight) => insight.id).sort(), ["photo", "quiet"], "found under the paused (Resurfacing off) filter");
    assert.deepEqual(counters(h).filter((name) => name.startsWith("insight_created")),
      ["insight_created", "insight_created_library_only", "insight_created_text", "insight_created", "insight_created_library_only", "insight_created_photo"]);
  } finally { h.close(); }
});

test("turning resurfacing on later schedules exactly one stage-0 event a day later, however often it is tapped", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("quiet", "Saved for later", null, null, [], null, false);
    h.setClock(local(2026, 10, 10, 20));
    await h.store.setInsightStatus("quiet", "active");
    await h.store.setInsightStatus("quiet", "active");
    await h.restart().setInsightStatus("quiet", "active");
    const events = h.events("quiet");
    assert.equal(events.length, 1, "no duplicates");
    assert.deepEqual([events[0]!.stage, events[0]!.scheduledAt], [0, local(2026, 10, 11, 20).toISOString()]);
    assert.equal((await h.store.getInsight("quiet"))!.status, "active");

    h.setClock(local(2026, 10, 11, 21));
    assert.deepEqual((await h.store.selectToday()).map((item) => item.insight.id), ["quiet"], "now it comes back");
  } finally { h.close(); }
});

test("saving with resurfacing on keeps today's behaviour", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    const saved = await h.store.insertInsight("on", "Default", null, null);
    assert.equal(saved.status, "active");
    assert.equal(h.pending("on").length, 1);
    assert.ok(!counters(h).includes("insight_created_library_only"));
  } finally { h.close(); }
});

test("a backup keeps a Library-only insight inactive, with its photo and categories, in the same archive version", async () => {
  const source = harness(local(2026, 10, 1, 9));
  const target = harness(local(2026, 10, 5, 12));
  try {
    const category = await source.store.createCategory("Quotes");
    await source.store.insertInsight("quiet", "Words", null, "file:///device-a/quiet.enc", [category.id], null, false);
    const rows = await source.store.exportRows();
    const contents = { exportedAt: source.clock().toISOString(), ...rows, photos: { quiet: Buffer.from("jpeg").toString("base64") } };
    assert.equal(archiveVersion(contents), 2, "no new archive version: categories alone need v2");
    validateBackupContents(contents);

    await target.store.replaceAllRows(contents, { quiet: "file:///device-b/quiet.enc" });
    const restored = (await target.store.getDetail("quiet"))!;
    assert.deepEqual([restored.insight.status, restored.insight.imagePath, restored.categories.map((c) => c.name)], ["paused", "file:///device-b/quiet.enc", ["Quotes"]]);
    assert.deepEqual(target.events("quiet"), []);
    assert.deepEqual(await target.store.selectToday(), []);
  } finally { source.close(); target.close(); }
});
