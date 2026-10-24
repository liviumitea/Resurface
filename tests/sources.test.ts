import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  BackupError, archiveVersion, assembleBackupContents, deriveBackupKey, newKdfParams, openBackup, readBackupHeader,
  sealBackup, validateBackupContents, type BackupContents,
} from "../src/backup";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const random = (length: number) => new Uint8Array(randomBytes(length));
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

test("source is optional, trimmed and capped; editing can set or clear it", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("none", "No source", null, null);
    await h.store.insertInsight("book", "From a book", null, null, [], "  Meditations,   Marcus Aurelius ");
    await h.store.insertInsight("long", "Long", null, null, [], "x".repeat(300));
    assert.equal((await h.store.getInsight("none"))!.source, null);
    assert.equal((await h.store.getInsight("book"))!.source, "Meditations, Marcus Aurelius");
    assert.equal((await h.store.getInsight("long"))!.source!.length, 200);

    await h.store.editInsight("none", "No source", null, "A friend");
    assert.equal((await h.store.getInsight("none"))!.source, "A friend");
    await h.store.editInsight("none", "No source", null, "   ");
    assert.equal((await h.store.getInsight("none"))!.source, null);
  } finally { h.close(); }
});

test("search matches the source; favorites filter combines with status, category and search", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Work");
    await h.store.insertInsight("a", "Ship small", null, null, [work.id], "Team retro");
    await h.store.insertInsight("b", "Ship gifts", null, null, [], "Grandma");
    await h.store.insertInsight("c", "Rest well", null, null);
    assert.deepEqual(ids(await h.store.listInsights("active", "grandma")), ["b"], "search includes the source");

    await h.store.setFavorite("a", true);
    await h.store.setFavorite("c", true);
    assert.deepEqual(ids(await h.store.listInsights("active", "", null, true)), ["a", "c"]);
    assert.deepEqual(ids(await h.store.listInsights("active", "ship", null, true)), ["a"]);
    assert.deepEqual(ids(await h.store.listInsights("active", "", work.id, true)), ["a"]);
    await h.store.setInsightStatus("c", "paused");
    assert.deepEqual(ids(await h.store.listInsights("paused", "", null, true)), ["c"], "a favorite keeps its star when paused");
    await h.store.setFavorite("a", false);
    assert.deepEqual(ids(await h.store.listInsights("active", "", null, true)), []);
  } finally { h.close(); }
});

test("starring is not a response and does not change resurfacing", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("a", "Starred", null, null);
    await h.store.insertInsight("b", "Plain", null, null);
    const before = h.pending("a");
    await h.store.setFavorite("a", true);
    assert.deepEqual(h.pending("a"), before);
    assert.ok(h.events("a").every((event) => event.response === null));
    h.setClock(local(2026, 10, 2, 10));
    assert.deepEqual((await h.store.selectToday()).map((item) => item.insight.id).sort(), ["a", "b"]);
  } finally { h.close(); }
});

async function roundTrip(contents: BackupContents): Promise<{ archive: string; opened: BackupContents }> {
  const key = await deriveBackupKey("password1", newKdfParams(random, { N: 2 ** 10, r: 8, p: 1 }));
  const archive = sealBackup(contents, key, random);
  return { archive, opened: openBackup(archive, await deriveBackupKey("password1", readBackupHeader(archive))) };
}

test("backups keep sources and favorites as version 3; older archives restore without them", async () => {
  const source = harness(local(2026, 10, 1));
  const target = harness(local(2026, 10, 5));
  try {
    await source.store.insertInsight("a", "With source", null, null, [], "Podcast");
    await source.store.insertInsight("b", "Plain", null, null);
    await source.store.setFavorite("b", true);
    const contents = assembleBackupContents(await source.store.exportRows(), new Map(), source.clock().toISOString());
    assert.equal(archiveVersion(contents), 3);
    const { archive, opened } = await roundTrip(contents);
    assert.equal(JSON.parse(archive).version, 3);
    await target.store.replaceAllRows(opened, {});
    assert.equal((await target.store.getInsight("a"))!.source, "Podcast");
    assert.equal((await target.store.getInsight("b"))!.favorite, 1);

    // An archive written before version 3 has neither field.
    const legacy = { ...contents, insights: contents.insights.map(({ source: _source, favorite: _favorite, ...rest }) => rest) } as unknown as BackupContents;
    assert.equal(archiveVersion(legacy), 1);
    await target.store.replaceAllRows(validateBackupContents(legacy), {});
    assert.equal((await target.store.getInsight("a"))!.source, null);
    assert.equal((await target.store.getInsight("b"))!.favorite, 0);
  } finally { source.close(); target.close(); }
});

test("source and favorite values in an archive are validated", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    await h.store.insertInsight("a", "Text", null, null);
    const good = assembleBackupContents(await h.store.exportRows(), new Map(), h.clock().toISOString());
    for (const [name, change] of [["favorite 2", { favorite: 2 }], ["blank source", { source: "  " }], ["long source", { source: "x".repeat(201) }]] as const) {
      const bad = { ...good, insights: good.insights.map((insight) => ({ ...insight, ...change })) };
      assert.throws(() => validateBackupContents(bad), (error: unknown) => error instanceof BackupError && error.code === "invalid_contents", name);
    }
  } finally { h.close(); }
});
