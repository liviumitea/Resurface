import assert from "node:assert/strict";
import test from "node:test";
import {
  BackupError, archiveVersion, assembleBackupContents, deriveBackupKey, newKdfParams, openBackup, readBackupHeader,
  sealBackup, validateBackupContents, type BackupContents,
} from "../src/backup";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const counters = (h: ReturnType<typeof harness>) =>
  (h.sqlite.prepare("SELECT name FROM analytics ORDER BY rowid").all() as { name: string }[]).map((row) => row.name);

/** Saves an insight, shows it the next day and answers "yes" with an optional note. */
async function answered(h: ReturnType<typeof harness>, note?: string) {
  await h.store.insertInsight("a", "Keep it simple", null, null);
  h.setClock(local(2026, 10, 2, 10));
  const [item] = await h.store.selectToday();
  await h.store.markShown(item!.event.id);
  await h.store.respondToEvent(item!.event.id, "yes", note);
  return item!.event.id;
}

test("a past note can be added, edited and removed without touching the exposure, answer or schedule", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    const eventId = await answered(h);
    const before = { events: h.events("a"), pending: h.pending("a"), shown: await h.store.getShownCount(), metrics: await h.store.getBetaMetrics() };
    const unchangedHistory = () => {
      assert.deepEqual(h.events("a"), before.events, "events, responses and stages unchanged");
      assert.deepEqual(h.pending("a"), before.pending, "the next due date is unchanged");
    };

    h.setClock(local(2026, 10, 4, 18));
    assert.equal(await h.store.setReflectionNote(eventId, "  Added later  "), "added");
    let [note] = (await h.store.getDetail("a"))!.reflections;
    assert.deepEqual([note!.eventId, note!.content, note!.createdAt, note!.updatedAt], [eventId, "Added later", h.clock().toISOString(), null]);
    unchangedHistory();

    h.setClock(local(2026, 10, 5, 8));
    assert.equal(await h.store.setReflectionNote(eventId, "Changed my mind"), "edited");
    [note] = (await h.store.getDetail("a"))!.reflections;
    assert.equal(note!.content, "Changed my mind");
    assert.equal(note!.createdAt, local(2026, 10, 4, 18).toISOString(), "creation time kept");
    assert.equal(note!.updatedAt, h.clock().toISOString(), "edit time recorded");
    assert.equal(await h.store.setReflectionNote(eventId, "Changed my mind "), "unchanged", "same text is not an edit");
    unchangedHistory();

    const restarted = h.restart();
    assert.equal((await restarted.getDetail("a"))!.reflections[0]!.content, "Changed my mind", "survives a restart");

    assert.equal(await restarted.setReflectionNote(eventId, "   "), "removed");
    assert.deepEqual((await restarted.getDetail("a"))!.reflections, []);
    assert.equal(await restarted.setReflectionNote(eventId, ""), "unchanged", "nothing left to remove");
    unchangedHistory();

    assert.equal(await h.store.getShownCount(), before.shown, "never another exposure");
    const metrics = await h.store.getBetaMetrics();
    assert.deepEqual({ ...metrics, saved: 0 }, { ...before.metrics, saved: 0 }, "never another answer");
    assert.deepEqual(counters(h).filter((name) => name.startsWith("reflection_")), ["reflection_added", "reflection_edited", "reflection_removed"]);
    for (const name of counters(h)) assert.ok(!/later|mind/i.test(name), "counters carry no content");
  } finally { h.close(); }
});

test("only an exposure the user actually saw takes a note; an answered note edits in place", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    const eventId = await answered(h, "First thought");
    const pending = h.pending("a")[0]!;
    assert.equal(await h.store.setReflectionNote(pending.id, "Too early"), "unchanged", "not shown yet");
    assert.equal(await h.store.setReflectionNote("missing", "Nowhere"), "unchanged");
    assert.equal(await h.store.setReflectionNote(eventId, "Second thought"), "edited");
    const detail = (await h.store.getDetail("a"))!;
    assert.deepEqual(detail.reflections.map((note) => note.content), ["Second thought"], "one note per exposure");
    assert.equal(detail.events.find((event) => event.id === eventId)!.response, "yes");
  } finally { h.close(); }
});

test("answering with a note after one was added from history keeps a single note with both texts", async () => {
  const h = harness(local(2026, 10, 1, 9));
  try {
    await h.store.insertInsight("a", "Keep it simple", null, null);
    h.setClock(local(2026, 10, 2, 10));
    const [item] = await h.store.selectToday();
    await h.store.markShown(item!.event.id);
    assert.equal(await h.store.setReflectionNote(item!.event.id, "From history"), "added");
    await h.store.respondToEvent(item!.event.id, "yes", "From Reflect");
    const [note, ...rest] = (await h.store.getDetail("a"))!.reflections;
    assert.deepEqual(rest, [], "still one note for the exposure");
    assert.equal(note!.content, "From history\n\nFrom Reflect");
    assert.equal(note!.updatedAt, h.clock().toISOString());
    assert.equal(h.events("a").find((event) => event.id === item!.event.id)!.response, "yes");
  } finally { h.close(); }
});

async function roundTrip(contents: BackupContents) {
  const key = await deriveBackupKey("password1", newKdfParams((length) => new Uint8Array(length).fill(7), { N: 2 ** 10, r: 8, p: 1 }));
  const archive = sealBackup(contents, key, (length) => new Uint8Array(length).fill(3));
  return { archive, opened: openBackup(archive, await deriveBackupKey("password1", readBackupHeader(archive))) };
}

test("edited notes travel in a version 4 backup; unedited ones keep older versions readable", async () => {
  const source = harness(local(2026, 10, 1, 9));
  const target = harness(local(2026, 10, 9));
  try {
    const eventId = await answered(source, "Original");
    let contents = assembleBackupContents(await source.store.exportRows(), new Map(), source.clock().toISOString());
    assert.equal(archiveVersion(contents), 1, "a note never edited needs no new version");

    source.setClock(local(2026, 10, 3, 9));
    await source.store.setReflectionNote(eventId, "Edited");
    contents = assembleBackupContents(await source.store.exportRows(), new Map(), source.clock().toISOString());
    const { archive, opened } = await roundTrip(contents);
    assert.equal(JSON.parse(archive).version, 4);
    await target.store.replaceAllRows(opened, {});
    const [note] = (await target.store.getDetail("a"))!.reflections;
    assert.deepEqual([note!.content, note!.updatedAt], ["Edited", local(2026, 10, 3, 9).toISOString()]);
    assert.deepEqual((await target.store.getDetail("a"))!.events, (await source.store.getDetail("a"))!.events.map((event) => ({ ...event, notificationId: null, notificationPlannedFor: null })));

    // Archives from before version 4 have no updatedAt and restore as never edited.
    const legacy = { ...contents, reflections: contents.reflections.map(({ updatedAt: _updatedAt, ...rest }) => rest) } as unknown as BackupContents;
    await target.store.replaceAllRows(validateBackupContents(legacy), {});
    assert.equal((await target.store.getDetail("a"))!.reflections[0]!.updatedAt, null);

    const bad = { ...contents, reflections: contents.reflections.map((note) => ({ ...note, updatedAt: "yesterday" })) };
    assert.throws(() => validateBackupContents(bad), (error: unknown) => error instanceof BackupError && error.code === "invalid_contents");
  } finally { source.close(); target.close(); }
});
