import assert from "node:assert/strict";
import test from "node:test";
import { matchesSearch, searchKey } from "../src/domain";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

test("search keys ignore case and Romanian diacritics, in both comma and cedilla forms", () => {
  assert.equal(searchKey("ÎNVAȚĂ"), "invata");
  assert.equal(searchKey("Știință"), searchKey("ştiinţă"), "comma-below and cedilla letters fold alike");
  assert.ok(matchesSearch(["Învață să te oprești"], "învață"), "SQLite lower() missed this");
  assert.ok(matchesSearch(["Învață să te oprești"], "invata"), "typed without diacritics");
  assert.ok(matchesSearch([null, "Mâine vei ști"], "  STI "), "any field, trimmed query");
  assert.ok(matchesSearch(["anything"], "   "), "an empty query matches");
  assert.ok(!matchesSearch(["Seara"], "dimineata"));
  assert.ok(matchesSearch(["100% sure_thing"], "100%"), "no SQL wildcards: % and _ are literal");
  assert.ok(!matchesSearch(["100 sure"], "100%"));
});

test("All insights spans every status; search, category, favorites and sort still compose", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const work = await h.store.createCategory("Lucru");
    h.setClock(local(2026, 10, 1)); await h.store.insertInsight("active", "Învață să te oprești", null, null, [work.id]);
    h.setClock(local(2026, 10, 2)); await h.store.insertInsight("paused", "Știința răbdării", null, null, [work.id], "Carte veche");
    h.setClock(local(2026, 10, 3)); await h.store.insertInsight("archived", "Învățături vechi", "Context despre ţară", null);
    await h.store.setInsightStatus("paused", "paused");
    await h.store.setInsightStatus("archived", "archived");
    await h.store.setFavorite("archived", true);

    const all = await h.store.listInsights("all");
    assert.deepEqual(all.map((row) => row.id), ["archived", "paused", "active"], "newest first");
    assert.deepEqual(all.map((row) => row.status), ["archived", "paused", "active"], "each row carries its real status for the badge");
    assert.deepEqual(ids(await h.store.listInsights("active")), ["active"], "status tabs unchanged");

    assert.deepEqual(ids(await h.store.listInsights("all", "invat")), ["active", "archived"], "without diacritics, across statuses");
    assert.deepEqual(ids(await h.store.listInsights("all", "ȚARĂ")), ["archived"], "matches context; capital comma letters vs cedilla content");
    assert.deepEqual(ids(await h.store.listInsights("all", "carte")), ["paused"], "matches source");
    assert.deepEqual(ids(await h.store.listInsights("active", "știința")), [], "a status tab still limits the search");
    assert.deepEqual(ids(await h.store.listInsights("all", "", work.id)), ["active", "paused"]);
    assert.deepEqual(ids(await h.store.listInsights("all", "", null, true)), ["archived"]);
    assert.deepEqual((await h.store.listInsights("all", "", null, false, "oldest")).map((row) => row.id), ["active", "paused", "archived"]);

    // Results follow lifecycle changes and edits.
    await h.store.setInsightStatus("archived", "active");
    await h.store.editInsight("paused", "Răbdare", null, null);
    assert.equal((await h.store.listInsights("all")).find((row) => row.id === "archived")!.status, "active");
    assert.deepEqual(ids(await h.store.listInsights("all", "stiinta")), [], "an edit removes the old text from results");
  } finally { h.close(); }
});

test("searching a large Library stays quick (node:sqlite; SQLCipher on a device will differ)", async () => {
  const h = harness(local(2026, 10, 1));
  try {
    const words = ["Învață", "răbdare", "știință", "lecție", "mâine", "țară", "seara", "dimineața"];
    for (let index = 0; index < 5000; index++) {
      await h.store.insertInsight(`i-${index}`, `${words[index % 8]} ${index} ${words[(index * 3) % 8]}`, index % 5 ? null : "context lung", null);
    }
    const started = performance.now();
    const found = await h.store.listInsights("all", "invata");
    const elapsed = performance.now() - started;
    assert.equal(found.length, 625, "every 8th insight starts with Învață");
    process.stdout.write(`# 5000 insights, all statuses, accent-insensitive search: ${elapsed.toFixed(0)} ms\n`);
    assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  } finally { h.close(); }
});
