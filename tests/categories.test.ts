import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  BackupError, archiveVersion, assembleBackupContents, deriveBackupKey, newKdfParams, openBackup, readBackupHeader,
  sealBackup, validateBackupContents, type BackupContents, type PhotoRead,
} from "../src/backup";
import { CategoryError } from "../src/store";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const random = (length: number) => new Uint8Array(randomBytes(length));
const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
const problem = (expected: string) => (error: unknown) => error instanceof CategoryError && error.problem === expected;

test("categories: names are trimmed, unique ignoring case, and bounded", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("  Work   lessons ");
    assert.equal(work.name, "Work lessons");
    await assert.rejects(h.store.createCategory("work LESSONS"), problem("duplicate"));
    await assert.rejects(h.store.createCategory("   "), problem("empty"));
    await assert.rejects(h.store.createCategory("x".repeat(41)), problem("too_long"));
    const home = await h.store.createCategory("Home");
    await assert.rejects(h.store.renameCategory(home.id, "WORK lessons"), problem("duplicate"));
    await h.store.renameCategory(home.id, "home"); // changing only the case of its own name is fine
    await assert.rejects(h.store.renameCategory("missing", "Anything"), problem("missing"));
    assert.deepEqual((await h.store.listCategories()).map((category) => [category.name, category.insights]), [["home", 0], ["Work lessons", 0]]);
  } finally { h.close(); }
});

test("an insight can have zero, one, or several categories; unknown IDs are ignored", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Work");
    const home = await h.store.createCategory("Home");
    await h.store.insertInsight("none", "No category", null, null);
    await h.store.insertInsight("one", "One category", null, null, [work.id]);
    await h.store.insertInsight("two", "Two categories", null, null, [work.id, home.id, work.id, "unknown"]);
    assert.deepEqual((await h.store.getDetail("none"))!.categories, []);
    assert.deepEqual((await h.store.getDetail("two"))!.categories.map((category) => category.name), ["Home", "Work"]);

    await h.store.setInsightCategories("one", [home.id]);
    assert.deepEqual((await h.store.getDetail("one"))!.categories.map((category) => category.name), ["Home"]);
    await h.store.setInsightCategories("one", []);
    assert.deepEqual((await h.store.getDetail("one"))!.categories, []);
    assert.deepEqual((await h.store.listCategories()).map((category) => [category.name, category.insights]), [["Home", 1], ["Work", 1]]);
  } finally { h.close(); }
});

test("deleting a category keeps its insights; deleting an insight removes its links", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Work");
    await h.store.insertInsight("a", "Kept", null, null, [work.id]);
    await h.store.insertInsight("b", "Also kept", null, null, [work.id]);
    assert.equal(await h.store.deleteCategory(work.id), 2, "reports how many insights it was on");
    assert.deepEqual(ids(await h.store.listInsights("active")), ["a", "b"]);
    assert.deepEqual((await h.store.getDetail("a"))!.categories, []);

    const home = await h.store.createCategory("Home");
    await h.store.setInsightCategories("a", [home.id]);
    await h.store.deleteInsightRow("a");
    assert.equal((await h.store.listCategories())[0]!.insights, 0);
  } finally { h.close(); }
});

test("Library filters by category across lifecycle states and with search; Today is unaffected", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Work");
    await h.store.insertInsight("work-active", "Ship small", null, null, [work.id]);
    await h.store.insertInsight("work-paused", "Write tests", null, null, [work.id]);
    await h.store.insertInsight("other", "Ship gifts", null, null);
    await h.store.setInsightStatus("work-paused", "paused");

    assert.deepEqual(ids(await h.store.listInsights("active", "", work.id)), ["work-active"]);
    assert.deepEqual(ids(await h.store.listInsights("paused", "", work.id)), ["work-paused"]);
    assert.deepEqual(ids(await h.store.listInsights("active", "ship", null)), ["other", "work-active"]);
    assert.deepEqual(ids(await h.store.listInsights("active", "ship", work.id)), ["work-active"]);

    h.setClock(local(2026, 10, 2, 10));
    assert.deepEqual((await h.store.selectToday()).map((item) => item.insight.id).sort(), ["other", "work-active"], "categories don't change eligibility");
  } finally { h.close(); }
});

async function seal(contents: BackupContents): Promise<string> {
  return sealBackup(contents, await deriveBackupKey("password1", newKdfParams(random, FAST_KDF)), random);
}
async function open(text: string): Promise<BackupContents> {
  return openBackup(text, await deriveBackupKey("password1", readBackupHeader(text)));
}

test("backups carry categories as version 2; version 1 archives restore with none", async () => {
  const source = harness(local(2026, 10, 1));
  const target = harness(local(2026, 10, 5));
  try {
    const work = await source.store.createCategory("Work");
    const home = await source.store.createCategory("Home");
    await source.store.insertInsight("a", "Text", null, null, [work.id, home.id]);
    await source.store.insertInsight("photo-only", null, null, "file:///p.enc", [work.id]);
    const reads = new Map<string, PhotoRead>([["photo-only", { status: "ok", bytes: new Uint8Array([1, 2, 3]) }]]);
    const contents = assembleBackupContents(await source.store.exportRows(), reads, source.clock().toISOString());
    assert.equal(archiveVersion(contents), 2);
    const archive = await seal(contents);
    assert.equal(JSON.parse(archive).version, 2);

    await target.store.createCategory("Will be replaced");
    await target.store.replaceAllRows(await open(archive), { "photo-only": "file:///target/p.enc" });
    assert.deepEqual((await target.store.listCategories()).map((category) => [category.name, category.insights]), [["Home", 1], ["Work", 2]]);
    assert.deepEqual((await target.store.getDetail("a"))!.categories.map((category) => category.id).sort(), [home.id, work.id].sort());

    // A device without categories writes version 1, which also restores cleanly (replacing categories).
    const plain = harness(local(2026, 10, 1));
    try {
      await plain.store.insertInsight("p", "Plain", null, null);
      const v1 = assembleBackupContents(await plain.store.exportRows(), new Map(), plain.clock().toISOString());
      assert.equal(archiveVersion(v1), 1);
      const v1Archive = await seal(v1);
      assert.equal(JSON.parse(v1Archive).version, 1);
      await target.store.replaceAllRows(await open(v1Archive), {});
      assert.deepEqual(await target.store.listCategories(), []);
    } finally { plain.close(); }
  } finally { source.close(); target.close(); }
});

test("an incomplete backup drops the links of insights it leaves out", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Work");
    await h.store.insertInsight("photo-only", null, null, "file:///p.enc", [work.id]);
    await h.store.insertInsight("text", "Text", null, null, [work.id]);
    const contents = assembleBackupContents(await h.store.exportRows(), new Map([["photo-only", { status: "missing" } as PhotoRead]]), h.clock().toISOString(), { allowIncomplete: true });
    assert.deepEqual(contents.insightCategories, [{ insightId: "text", categoryId: work.id }]);
    assert.deepEqual(contents.categories!.map((category) => category.name), ["Work"]);
  } finally { h.close(); }
});

test("category data in an archive is validated", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Work");
    await h.store.insertInsight("a", "Text", null, null, [work.id]);
    const good = assembleBackupContents(await h.store.exportRows(), new Map(), h.clock().toISOString());
    const bad: [string, unknown][] = [
      ["link to missing insight", { ...good, insightCategories: [{ insightId: "nope", categoryId: work.id }] }],
      ["link to missing category", { ...good, insightCategories: [{ insightId: "a", categoryId: "nope" }] }],
      ["duplicate link", { ...good, insightCategories: [...good.insightCategories!, ...good.insightCategories!] }],
      ["duplicate name ignoring case", { ...good, categories: [...good.categories!, { ...work, id: "other", name: "WORK" }] }],
      ["untrimmed name", { ...good, categories: [{ ...work, name: " Work " }] }],
    ];
    for (const [name, value] of bad) {
      assert.throws(() => validateBackupContents(value), (error: unknown) => error instanceof BackupError && error.code === "invalid_contents", name);
    }
  } finally { h.close(); }
});

test("Library sorts by newest, oldest, or most recently resurfaced, and reports exposure counts", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    h.setClock(local(2026, 10, 1)); await h.store.insertInsight("first", "First saved", null, null);
    h.setClock(local(2026, 10, 2)); await h.store.insertInsight("second", "Second saved", null, null);
    h.setClock(local(2026, 10, 3)); await h.store.insertInsight("third", "Never shown", null, null);

    // "first" is shown twice, "second" once and more recently.
    h.setClock(local(2026, 10, 2, 12));
    const [a] = h.pending("first"); await h.store.markShown(a!.id);
    h.setClock(local(2026, 10, 6, 12));
    const [b] = h.pending("first"); await h.store.markShown(b!.id);
    h.setClock(local(2026, 10, 8, 12));
    const [c] = h.pending("second"); await h.store.markShown(c!.id);

    const order = async (sort: "newest" | "oldest" | "resurfaced") => (await h.store.listInsights("active", "", null, false, sort)).map((item) => item.id);
    assert.deepEqual(await order("newest"), ["third", "second", "first"]);
    assert.deepEqual(await order("oldest"), ["first", "second", "third"]);
    assert.deepEqual(await order("resurfaced"), ["second", "first", "third"], "most recent exposure first, never shown last");

    const byId = Object.fromEntries((await h.store.listInsights("active")).map((item) => [item.id, item]));
    assert.equal(byId.first!.timesShown, 2);
    assert.equal(byId.first!.lastShownAt, local(2026, 10, 6, 12).toISOString());
    assert.equal(byId.third!.timesShown, 0);
    assert.equal(byId.third!.lastShownAt, null);
  } finally { h.close(); }
});
