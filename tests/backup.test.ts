import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  BACKUP_LIMITS, BackupError, DEFAULT_KDF, assembleBackupContents, deriveBackupKey, describeOmissions, newKdfParams,
  openBackup, readBackupHeader, sealBackup, summarizeBackup, validateBackupContents, type BackupContents, type BackupErrorCode, type PhotoRead,
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
  assert.throws(() => readBackupHeader(JSON.stringify({ ...archive, version: 99 })), (error: unknown) => error instanceof BackupError && error.code === "unsupported_version");
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

const ok = (text: string): PhotoRead => ({ status: "ok", bytes: new Uint8Array(Buffer.from(text)) });

/** The populated device plus a text insight that also carries a photo. */
async function deviceWithPhotos() {
  const h = await populatedDevice();
  await h.store.insertInsight("insight-captioned", "Caption", null, "file:///device-a/insight-captioned.enc");
  return h;
}

test("a backup fails closed when any photo cannot be read, with an itemized count", async () => {
  const h = await deviceWithPhotos();
  try {
    const rows = await h.store.exportRows();
    for (const failure of ["missing", "unreadable"] as const) {
      const reads = new Map<string, PhotoRead>([["insight-photo", { status: failure }], ["insight-captioned", { status: failure }]]);
      assert.throws(() => assembleBackupContents(rows, reads, h.clock().toISOString()), (error: unknown) => {
        assert.ok(error instanceof BackupError && error.code === "incomplete");
        assert.deepEqual(error.omissions, { missingPhotos: 2, insightsWithoutPhoto: 1, insightsLeftOut: 1 });
        assert.match(error.message, /2 photos can't be read.*1 photo-only insight would be left out.*1 insight would be saved without its photo/);
        return true;
      });
    }
  } finally { h.close(); }
});

test("an explicitly incomplete backup records what it left out and still restores", async () => {
  const source = await deviceWithPhotos();
  const target = harness(local(2026, 10, 5, 12));
  try {
    const rows = await source.store.exportRows();
    const reads = new Map<string, PhotoRead>([["insight-photo", { status: "missing" }], ["insight-captioned", { status: "unreadable" }]]);
    const contents = assembleBackupContents(rows, reads, source.clock().toISOString(), { allowIncomplete: true });
    assert.deepEqual(contents.omissions, { missingPhotos: 2, insightsWithoutPhoto: 1, insightsLeftOut: 1 });
    assert.ok(!contents.insights.some((insight) => insight.id === "insight-photo"), "the photo-only insight is left out");
    assert.ok(!contents.events.some((event) => event.insightId === "insight-photo"), "with its history");
    assert.ok(!contents.reflections.some((reflection) => reflection.insightId === "insight-photo"));
    assert.equal(contents.insights.find((insight) => insight.id === "insight-captioned")!.imagePath, null);

    const opened = await open(await seal(contents));
    assert.deepEqual(opened.omissions, contents.omissions, "the archive itself says it is incomplete");
    await target.store.replaceAllRows(opened, {});
    assert.deepEqual((await target.store.exportRows()).insights.map((insight) => insight.id).sort(), ["insight-captioned", "insight-paused", "insight-text"]);
    assert.match(describeOmissions(opened.omissions!, "then"), /2 photos couldn't be read when it was made; 1 photo-only insight was left out.*1 insight was saved without its photo/);
  } finally { source.close(); target.close(); }
});

test("a complete backup carries no omissions", async () => {
  const h = await deviceWithPhotos();
  try {
    const reads = new Map<string, PhotoRead>([["insight-photo", ok("a")], ["insight-captioned", ok("b")]]);
    const contents = assembleBackupContents(await h.store.exportRows(), reads, h.clock().toISOString());
    assert.equal(contents.omissions, undefined);
    assert.equal(Object.keys(contents.photos).length, 2);
    assert.equal((await open(await seal(contents))).omissions, undefined);
  } finally { h.close(); }
});

test("import limits: key cost stays within 64 MiB and oversized archives are refused before decryption", async () => {
  const { N, r, p } = BACKUP_LIMITS.maxKdf;
  assert.ok(128 * N * r * p <= 64 * 1024 * 1024, "scrypt memory ceiling");
  assert.ok(128 * DEFAULT_KDF.N * DEFAULT_KDF.r <= 128 * N * r, "today's archives stay within the ceiling");

  const archive = JSON.parse(await seal({}));
  for (const kdf of [{ N: 2 ** 17 }, { r: 16 }, { p: 2 }]) {
    assert.throws(() => readBackupHeader(JSON.stringify({ ...archive, kdf: { ...archive.kdf, ...kdf } })),
      (error: unknown) => error instanceof BackupError && error.code === "not_a_backup", JSON.stringify(kdf));
  }
  const small = { ...BACKUP_LIMITS, maxArchiveChars: 1000 };
  assert.throws(() => readBackupHeader("x".repeat(1001), small), (error: unknown) => error instanceof BackupError && error.code === "too_large");
});

test("export refuses to make a backup too large to restore", async () => {
  const h = await populatedDevice();
  try {
    const contents = await exportFrom(h);
    const key = await deriveBackupKey(PASSWORD, newKdfParams(random, FAST_KDF));
    assert.throws(() => sealBackup(contents, key, random, { ...BACKUP_LIMITS, maxArchiveChars: 500 }),
      (error: unknown) => error instanceof BackupError && error.code === "too_large");
    assert.ok(sealBackup(contents, key, random).length > 500, "the normal limit accepts it");
  } finally { h.close(); }
});

test("archives with more records than the device can restore are refused", async () => {
  const h = await populatedDevice();
  try {
    const contents = await exportFrom(h);
    assert.throws(() => validateBackupContents(contents, { ...BACKUP_LIMITS, maxInsights: 2 }),
      (error: unknown) => error instanceof BackupError && error.code === "too_large");
    assert.throws(() => validateBackupContents({ ...contents, omissions: { missingPhotos: -1, insightsWithoutPhoto: 0, insightsLeftOut: 0 } }),
      (error: unknown) => error instanceof BackupError && error.code === "invalid_contents");
  } finally { h.close(); }
});

test("backup checkup: 'created' and 'verified' are tracked separately and only verification records a summary", async () => {
  const h = await deviceWithPhotos();
  try {
    assert.deepEqual(await h.store.getBackupStatus(), { lastCreatedAt: null, lastCreatedComplete: null, lastVerified: null });

    h.setClock(local(2026, 10, 3, 9));
    await h.store.track("backup_created_incomplete");
    h.setClock(local(2026, 10, 3, 10));
    await h.store.track("backup_created");
    const created = await h.store.getBackupStatus();
    assert.equal(created.lastCreatedAt, local(2026, 10, 3, 10).toISOString());
    assert.equal(created.lastCreatedComplete, true);
    assert.equal(created.lastVerified, null, "creating a backup is not verifying one");

    const reads = new Map<string, PhotoRead>([["insight-photo", ok("a")], ["insight-captioned", { status: "missing" }]]);
    const contents = assembleBackupContents(await h.store.exportRows(), reads, local(2026, 10, 3, 10).toISOString(), { allowIncomplete: true });
    const archive = await seal(contents);
    const before = await h.store.exportRows();

    // Verification as storage.verifyBackup does it: open, summarize, record — never replace.
    await rejects(open(archive, "wrong password!"), "wrong_password_or_damaged");
    assert.equal((await h.store.getBackupStatus()).lastVerified, null, "a failed check records nothing");

    h.setClock(local(2026, 10, 4, 8));
    const summary = summarizeBackup(await open(archive));
    await h.store.recordBackupVerified(summary);
    assert.deepEqual(summary, {
      exportedAt: local(2026, 10, 3, 10).toISOString(), version: 1, insights: 4, photos: 1,
      events: contents.events.length, reflections: contents.reflections.length,
      omissions: { missingPhotos: 1, insightsWithoutPhoto: 1, insightsLeftOut: 0 },
    });
    const status = await h.store.getBackupStatus();
    assert.deepEqual(status.lastVerified, { ...summary, verifiedAt: local(2026, 10, 4, 8).toISOString() });
    assert.deepEqual(await h.store.exportRows(), before, "verification leaves all data untouched");

    const stored = JSON.stringify(h.sqlite.prepare("SELECT * FROM settings").all()) + JSON.stringify(h.sqlite.prepare("SELECT * FROM analytics").all());
    for (const secret of ["Private words", "Caption", "A private reflection", PASSWORD]) assert.ok(!stored.includes(secret), `kept ${secret}`);
  } finally { h.close(); }
});
