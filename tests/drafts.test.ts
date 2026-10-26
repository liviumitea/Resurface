import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_VERSION, parseStoredDraft, type StoredDraft } from "../src/domain";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const draft = (overrides: Partial<Omit<StoredDraft, "savedAt">> = {}): Omit<StoredDraft, "savedAt"> => ({
  content: "Half a thought", context: "On the train", source: "a podcast", categoryIds: [], resurface: true, origin: "today", hadPhoto: false, ...overrides,
});
const storedValue = (h: ReturnType<typeof harness>) =>
  (h.sqlite.prepare("SELECT value FROM settings WHERE key = 'captureDraft'").get() as { value: string } | undefined)?.value ?? null;

test("a capture draft survives a restart exactly, and Save or Discard (clear) removes it for good", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    const category = await h.store.createCategory("Ideas");
    const typed = draft({ categoryIds: [category.id], resurface: false, origin: "library", hadPhoto: true });
    await h.store.saveCaptureDraft(typed);
    assert.deepEqual(await h.restart().getCaptureDraft(), { ...typed, savedAt: h.clock().toISOString() }, "every field comes back");
    assert.equal(JSON.parse(storedValue(h)!).version, DRAFT_VERSION);

    h.setClock(local(2026, 10, 1, 9, 5));
    await h.store.saveCaptureDraft({ ...typed, content: "A whole thought" });
    assert.equal((await h.store.getCaptureDraft() as StoredDraft).content, "A whole thought", "one draft, replaced in place");
    assert.equal((h.sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key = 'captureDraft'").get() as { n: number }).n, 1);

    await h.store.clearCaptureDraft();
    assert.equal(await h.restart().getCaptureDraft(), null, "gone after a restart");
    assert.equal(storedValue(h), null, "no leftover row");
  } finally { h.close(); }
});

test("clearing every field clears the draft instead of keeping an empty one", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.saveCaptureDraft(draft());
    await h.store.saveCaptureDraft(draft({ content: "  ", context: "", source: " ", hadPhoto: true }));
    assert.equal(storedValue(h), null, "a lone photo is not kept, so it doesn't make a draft");
    assert.equal(await h.store.getCaptureDraft(), null);
  } finally { h.close(); }
});

test("an unreadable or newer draft is reported and left as it is", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    for (const raw of ["{not json", JSON.stringify({ ...draft(), version: DRAFT_VERSION + 1, savedAt: "2026-10-01T06:00:00.000Z" }), "[]", "null"]) {
      h.sqlite.prepare("INSERT INTO settings (key, value) VALUES ('captureDraft', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(raw);
      assert.equal(await h.store.getCaptureDraft(), "unreadable", raw);
      assert.equal(storedValue(h), raw, "reading never rewrites it");
    }
    await h.store.clearCaptureDraft();
    assert.equal(storedValue(h), null, "an accepted discard leaves nothing behind");
  } finally { h.close(); }
});

test("a draft's deleted categories are dropped, and malformed fields are bounded", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    const kept = await h.store.createCategory("Kept");
    const gone = await h.store.createCategory("Gone");
    await h.store.saveCaptureDraft(draft({ categoryIds: [kept.id, gone.id] }));
    await h.store.deleteCategory(gone.id);
    assert.deepEqual((await h.store.getCaptureDraft() as StoredDraft).categoryIds, [kept.id]);

    const good = { version: DRAFT_VERSION, ...draft(), savedAt: "2026-10-01T06:00:00.000Z" };
    assert.equal((parseStoredDraft({ ...good, source: "s".repeat(500) }) as StoredDraft).source.length, 200, "bounded");
    for (const damaged of [{ categoryIds: [1, "a"] }, { origin: "elsewhere" }, { resurface: "no" }, { savedAt: "never" }, { context: null }, { hadPhoto: undefined }]) {
      assert.equal(parseStoredDraft({ ...good, ...damaged }), "unreadable", `reported, not resumed with fields dropped: ${JSON.stringify(damaged)}`);
    }
    assert.equal(parseStoredDraft({ ...good, content: "", context: " ", source: "" }), null, "nothing worth keeping");
  } finally { h.close(); }
});

test("a draft is not an insight: no Library, Today, reminder, metric or backup, and a restore leaves it alone", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    const metricsBefore = await h.store.getBetaMetrics();
    await h.store.saveCaptureDraft(draft());
    assert.equal(await h.store.countInsights(), 0);
    assert.deepEqual(await h.store.listInsights("all"), []);
    h.setClock(local(2026, 10, 9, 9));
    assert.deepEqual(await h.store.selectToday(), []);
    assert.deepEqual(await h.store.notificationCandidates(h.clock()), []);
    assert.deepEqual(await h.store.getBetaMetrics(), metricsBefore, "metrics unchanged");
    assert.deepEqual((h.sqlite.prepare("SELECT name FROM analytics").all() as { name: string }[]), [], "no counter for keeping a draft");

    const rows = await h.store.exportRows();
    assert.ok(!JSON.stringify(rows).includes("Half a thought"), "never in a backup");
    await h.store.replaceAllRows({ ...rows, insights: [], events: [], reflections: [], categories: [], insightCategories: [] }, {});
    assert.equal((await h.store.getCaptureDraft() as StoredDraft).content, "Half a thought", "restore replaces insights, not the unsaved draft");
  } finally { h.close(); }
});
