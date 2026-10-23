import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  BackupError, DEFAULT_KDF, deriveBackupKey, newKdfParams, openBackup, readBackupHeader, sealBackup,
  type BackupContents, type BackupErrorCode,
} from "../src/backup";
import { harness, local } from "./harness";

process.env.TZ = "Europe/Bucharest";

const random = (length: number) => new Uint8Array(randomBytes(length));
// Low cost for structural tests; one test below uses the production parameters.
const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const PASSWORD = "correct horse battery";
const PHOTO = Buffer.from("not really a jpeg, but bytes all the same").toString("base64");

/** A device with a text insight, a photo insight with a reflected Yes, and a paused insight. */
async function populatedDevice() {
  const h = harness(local(2026, 10, 1));
  await h.store.insertInsight("insight-text", "Private words to remember", "Because it matters", null);
  await h.store.insertInsight("insight-photo", null, null, "file:///device-a/insight-photo.enc");
  await h.store.insertInsight("insight-paused", "Paused thought", null, null);
  h.setClock(local(2026, 10, 2, 10));
  const today = await h.store.selectToday();
  const photoEvent = today.find((item) => item.insight.id === "insight-photo")!.event;
  await h.store.markShown(photoEvent.id);
  await h.store.respondToEvent(photoEvent.id, "yes", "A private reflection");
  await h.store.setInsightStatus("insight-paused", "paused");
  await h.store.saveSettings({ dailyCap: 5, notificationTime: "07:30", showInsightText: true });
  await h.store.setNotificationPlan(h.pending("insight-text")[0]!.id, "device-a-notification", local(2026, 10, 3, 7, 30).toISOString());
  return h;
}

async function exportFrom(h: Awaited<ReturnType<typeof populatedDevice>>): Promise<BackupContents> {
  return { exportedAt: h.clock().toISOString(), ...(await h.store.exportRows()), photos: { "insight-photo": PHOTO } };
}

async function seal(contents: unknown, password = PASSWORD, params = FAST_KDF): Promise<string> {
  const key = await deriveBackupKey(password, newKdfParams(random, params));
  return sealBackup(contents as BackupContents, key, random);
}

async function open(text: string, password = PASSWORD): Promise<BackupContents> {
  return openBackup(text, await deriveBackupKey(password, readBackupHeader(text)));
}

async function rejects(promise: Promise<unknown>, code: BackupErrorCode) {
  await assert.rejects(promise, (error: unknown) => error instanceof BackupError && error.code === code);
}

test("a backup restores insights, photos, history, reflections, and settings on a fresh device", async () => {
  const source = await populatedDevice();
  const target = harness(local(2026, 10, 5, 12));
  try {
    const contents = await exportFrom(source);
    const archive = await seal(contents, PASSWORD, DEFAULT_KDF);
    const opened = await open(archive);
    assert.deepEqual(opened, contents);

    await target.store.insertInsight("insight-existing", "Replaced by the restore", null, null);
    await target.store.replaceAllRows(opened, { "insight-photo": "file:///device-b/insight-photo.enc" });
    const restored = await target.store.exportRows();

    assert.deepEqual(restored.insights.map((insight) => insight.id).sort(), ["insight-paused", "insight-photo", "insight-text"]);
    assert.equal(restored.insights.find((insight) => insight.id === "insight-photo")!.imagePath, "file:///device-b/insight-photo.enc");
    assert.deepEqual(restored.reflections, contents.reflections);
    assert.deepEqual(restored.events, contents.events.map((event) => ({ ...event, notificationId: null, notificationPlannedFor: null })),
      "history is kept; device-specific notification plans are not");
    assert.deepEqual(restored.settings, { dailyCap: 5, notificationTime: "07:30", showInsightText: true });
    assert.equal((await target.store.getSettings()).onboardingComplete, true);

    target.setClock(local(2026, 10, 6, 10));
    assert.deepEqual((await target.store.selectToday()).map((item) => item.insight.id).sort(), ["insight-photo", "insight-text"],
      "the restored schedule resumes; the paused insight stays paused");
  } finally { source.close(); target.close(); }
});

test("the archive contains no personal plaintext", async () => {
  const source = await populatedDevice();
  try {
    const archive = await seal(await exportFrom(source));
    for (const secret of ["Private words", "Because it matters", "A private reflection", "Paused thought", PHOTO, "insight-text", "07:30"]) {
      assert.ok(!archive.includes(secret), `archive leaks ${secret}`);
    }
  } finally { source.close(); }
});

test("a wrong password or any altered byte is rejected", async () => {
  const source = await populatedDevice();
  try {
    const archive = await seal(await exportFrom(source));
    await rejects(open(archive, "wrong horse battery"), "wrong_password_or_damaged");

    const envelope = JSON.parse(archive);
    const flipped = Buffer.from(envelope.ciphertext, "base64");
    flipped[flipped.length >> 1]! ^= 1;
    await rejects(open(JSON.stringify({ ...envelope, ciphertext: flipped.toString("base64") })), "wrong_password_or_damaged");
    await rejects(open(JSON.stringify({ ...envelope, nonce: Buffer.from(random(12)).toString("base64") })), "wrong_password_or_damaged");
    await rejects(open(JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, r: 4 } })), "wrong_password_or_damaged");
    await rejects(open(JSON.stringify({ ...envelope, ciphertext: Buffer.from(flipped.subarray(0, 40)).toString("base64") })), "wrong_password_or_damaged");
  } finally { source.close(); }
});

test("files that are not backups, newer versions, and abusive key parameters are refused before decryption", async () => {
  const archive = JSON.parse(await seal({}));
  assert.throws(() => readBackupHeader("plain text"), (error: unknown) => error instanceof BackupError && error.code === "not_a_backup");
  assert.throws(() => readBackupHeader(JSON.stringify({ hello: "world" })), (error: unknown) => error instanceof BackupError && error.code === "not_a_backup");
  assert.throws(() => readBackupHeader(JSON.stringify({ ...archive, version: 2 })), (error: unknown) => error instanceof BackupError && error.code === "unsupported_version");
  for (const kdf of [{ N: 2 ** 24 }, { N: 3000 }, { r: 64 }, { p: 0 }, { salt: "%%%" }]) {
    assert.throws(() => readBackupHeader(JSON.stringify({ ...archive, kdf: { ...archive.kdf, ...kdf } })),
      (error: unknown) => error instanceof BackupError && error.code === "not_a_backup", JSON.stringify(kdf));
  }
});

test("archives with broken structure or references are refused", async () => {
  const source = await populatedDevice();
  try {
    const good = await exportFrom(source);
    const [first, second] = good.insights;
    const textEvent = good.events.find((event) => event.insightId === "insight-text")!;
    const cases: [string, unknown][] = [
      ["duplicate insight", { ...good, insights: [...good.insights, first] }],
      ["duplicate event", { ...good, events: [...good.events, good.events[0]] }],
      ["event without insight", { ...good, events: [...good.events, { ...textEvent, id: "orphan", insightId: "missing" }] }],
      ["two pending events", { ...good, events: [...good.events, { ...textEvent, id: "second-pending" }] }],
      ["reflection on another insight", { ...good, reflections: good.reflections.map((reflection) => ({ ...reflection, insightId: "insight-text" })) }],
      ["photo without image", { ...good, photos: {} }],
      ["photo for unknown insight", { ...good, photos: { ...good.photos, stranger: PHOTO } }],
      ["empty insight", { ...good, insights: good.insights.map((insight) => insight.id === "insight-text" ? { ...insight, content: " " } : insight) }],
      ["unknown status", { ...good, insights: [{ ...first!, status: "deleted" }, second, ...good.insights.slice(2)] }],
      ["bad settings", { ...good, settings: { ...good.settings, dailyCap: 100 } }],
      ["not an object", ["insights"]],
    ];
    for (const [name, contents] of cases) await rejects(open(await seal(contents)), "invalid_contents").catch((error) => { throw new Error(name, { cause: error }); });
  } finally { source.close(); }
});

test("a restore that fails partway leaves the current data intact", async () => {
  const source = await populatedDevice();
  const target = harness(local(2026, 10, 5));
  try {
    await target.store.insertInsight("insight-existing", "Keep me", null, null);
    const before = await target.store.exportRows();
    const contents = await open(await seal(await exportFrom(source)));

    await assert.rejects(target.store.replaceAllRows(contents, {}), /photo is missing/);
    assert.deepEqual(await target.store.exportRows(), before);

    // A database constraint failure after some rows were written also rolls back completely.
    const clash = { ...contents, reflections: [...contents.reflections, contents.reflections[0]!] };
    await assert.rejects(target.store.replaceAllRows(clash, { "insight-photo": "file:///device-b/p.enc" }));
    assert.deepEqual(await target.store.exportRows(), before);
  } finally { source.close(); target.close(); }
});
