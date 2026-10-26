import assert from "node:assert/strict";
import test from "node:test";
import { assembleBackupContents, validateBackupContents } from "../src/backup";
import { supersededPhotoFiles } from "../src/domain";
import { PhotoError } from "../src/store";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const counters = (h: ReturnType<typeof harness>) =>
  (h.sqlite.prepare("SELECT name FROM analytics ORDER BY rowid").all() as { name: string }[]).map((row) => row.name).filter((name) => name.startsWith("photo_"));

const isPhotoError = (problem: string) => (error: unknown) => error instanceof PhotoError && error.problem === problem;

test("a saved insight's photo can be added, replaced and removed without touching its schedule or history", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("a", "Keep it simple", null, null);
    h.setClock(local(2026, 10, 2, 10));
    const [item] = await h.store.selectToday();
    await h.store.markShown(item!.event.id);
    await h.store.respondToEvent(item!.event.id, "yes", "A note");
    const before = { events: h.events("a"), reflections: (await h.store.getDetail("a"))!.reflections, shown: await h.store.getShownCount() };
    const unchanged = async () => {
      assert.deepEqual(h.events("a"), before.events, "exposures, answers and the next due date are unchanged");
      assert.deepEqual((await h.store.getDetail("a"))!.reflections, before.reflections);
      assert.equal(await h.store.getShownCount(), before.shown, "never an exposure");
    };

    h.setClock(local(2026, 10, 3, 8));
    assert.deepEqual(await h.store.setInsightImage("a", "file:///docs/resurface-images/a-1.enc"), { previous: null });
    let insight = (await h.store.getInsight("a"))!;
    assert.deepEqual([insight.imagePath, insight.imageMime, insight.content], ["file:///docs/resurface-images/a-1.enc", "image/jpeg", "Keep it simple"]);
    assert.equal(insight.updatedAt, h.clock().toISOString());
    await unchanged();

    assert.deepEqual(await h.store.setInsightImage("a", "file:///docs/resurface-images/a-2.enc"), { previous: "file:///docs/resurface-images/a-1.enc" },
      "the replaced file is handed back for deletion");
    assert.equal((await h.store.getInsight("a"))!.imagePath, "file:///docs/resurface-images/a-2.enc");
    await unchanged();

    const restarted = h.restart();
    assert.deepEqual(await restarted.setInsightImage("a", null), { previous: "file:///docs/resurface-images/a-2.enc" });
    insight = (await restarted.getInsight("a"))!;
    assert.deepEqual([insight.imagePath, insight.imageMime, insight.content], [null, null, "Keep it simple"]);
    await unchanged();
    assert.deepEqual(counters(h), ["photo_added", "photo_replaced", "photo_removed"], "content-free counters");
  } finally { h.close(); }
});

test("a photo-only insight keeps its photo until it has text, and a missing insight is refused", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("p", null, "Context alone is not enough", "file:///docs/resurface-images/p.enc");
    await assert.rejects(h.store.setInsightImage("p", null), isPhotoError("empty"));
    assert.equal((await h.store.getInsight("p"))!.imagePath, "file:///docs/resurface-images/p.enc", "refusal changes nothing");
    assert.deepEqual(counters(h), []);

    // Replacing is always allowed: the insight still has a photo.
    assert.deepEqual(await h.store.setInsightImage("p", "file:///docs/resurface-images/p-2.enc"), { previous: "file:///docs/resurface-images/p.enc" });

    await h.store.editInsight("p", "   ", null);
    await assert.rejects(h.store.setInsightImage("p", null), isPhotoError("empty"), "whitespace is not text");
    await h.store.editInsight("p", "Now with words", null);
    assert.deepEqual(await h.store.setInsightImage("p", null), { previous: "file:///docs/resurface-images/p-2.enc" });

    await assert.rejects(h.store.setInsightImage("gone", "file:///docs/resurface-images/gone-1.enc"), isPhotoError("missing"));
  } finally { h.close(); }
});

test("text and photo can't both be cleared, even when an edit and a removal overlap", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("t", "Only words", null, null);
    await assert.rejects(h.store.editInsight("t", "  ", "context stays"), isPhotoError("empty"), "a text-only insight keeps its text");
    assert.deepEqual([(await h.store.getInsight("t"))!.content, (await h.store.getInsight("t"))!.context], ["Only words", null], "refusal changes nothing");
    await h.store.editInsight("missing", "", null); // nothing to refuse

    // Removal after the text was cleared by an edit that saw the photo: the second step is refused.
    await h.store.insertInsight("both", "Words", null, "file:///docs/resurface-images/both.enc");
    await h.store.editInsight("both", "", null);
    await assert.rejects(h.store.setInsightImage("both", null), isPhotoError("empty"));
    // And the other order: once the photo is gone, clearing the text is refused.
    await h.store.editInsight("both", "Words again", null);
    await h.store.setInsightImage("both", null);
    await assert.rejects(h.store.editInsight("both", "", null), isPhotoError("empty"));
    assert.equal((await h.store.getInsight("both"))!.content, "Words again");
  } finally { h.close(); }
});

test("of two overlapping photo changes, the one based on a stale photo is refused", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("a", "Words", null, "file:///docs/resurface-images/a.enc");
    // Both read a.enc before either writes; only the first may replace it, so a.enc is handed back once.
    const results = await Promise.allSettled([
      h.store.setInsightImage("a", "file:///docs/resurface-images/a-1.enc"),
      h.store.setInsightImage("a", "file:///docs/resurface-images/a-2.enc"),
    ]);
    assert.deepEqual(results[0], { status: "fulfilled", value: { previous: "file:///docs/resurface-images/a.enc" } });
    assert.equal(results[1]!.status, "rejected");
    assert.ok(isPhotoError("changed")((results[1] as PromiseRejectedResult).reason));
    assert.equal((await h.store.getInsight("a"))!.imagePath, "file:///docs/resurface-images/a-1.enc", "the refused file is not referenced, so its caller deletes it");
    assert.deepEqual(counters(h), ["photo_replaced"]);
  } finally { h.close(); }
});

test("a backup after a replacement carries only the new photo, and after a removal none", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("a", "Words", null, "file:///docs/resurface-images/a.enc");
    await h.store.setInsightImage("a", "file:///docs/resurface-images/a-2.enc");
    const reads = new Map([["a", { status: "ok" as const, bytes: new Uint8Array([1, 2, 3]) }]]);
    let rows = await h.store.exportRows();
    assert.equal(rows.insights[0]!.imagePath, "file:///docs/resurface-images/a-2.enc", "the backup reads the new file");
    let contents = assembleBackupContents(rows, reads, h.clock().toISOString());
    assert.deepEqual(Object.keys(contents.photos), ["a"]);
    assert.equal(contents.omissions, undefined);
    validateBackupContents(contents);

    await h.store.setInsightImage("a", null);
    rows = await h.store.exportRows();
    contents = assembleBackupContents(rows, new Map(), h.clock().toISOString());
    assert.deepEqual(contents.photos, {}, "no reference to the removed photo");
    assert.deepEqual([contents.insights[0]!.imagePath, contents.insights[0]!.imageMime], [null, null]);
    validateBackupContents(contents);
  } finally { h.close(); }
});

test("only files superseded on an existing insight are swept", () => {
  const a = "0b5f6f5e-9d1c-4a9e-8a0e-1f2e3d4c5b6a";
  const b = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const lost = "11111111-2222-4333-8444-555555555555";
  const insights = [
    { id: a, imagePath: `file:///old/container/resurface-images/${a}-new.enc` },
    { id: b, imagePath: null },
  ];
  const files = [
    `${a}-new.enc`, // referenced, by file name even though the container moved
    `${a}.enc`, // the original that a replacement superseded
    `${a}-older.enc`, // a replacement whose database update never happened
    `${b}.enc`, // removed from b but not deleted
    `${lost}.enc`, // no such insight: perhaps a database that could not be opened, so kept
    `${lost}-x.enc`,
    "notes.txt",
    `${a}.enc.tmp`,
  ];
  assert.deepEqual(supersededPhotoFiles(files, insights).sort(), [`${a}-older.enc`, `${a}.enc`, `${b}.enc`].sort());
  assert.deepEqual(supersededPhotoFiles(files, []), [], "an empty database sweeps nothing");
});
