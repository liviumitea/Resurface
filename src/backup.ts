import { gcm } from "@noble/ciphers/aes.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { fromByteArray, toByteArray } from "base64-js";
import { isValidInsight, type Insight, type Reflection, type ResurfaceEvent, type Settings } from "./domain";

/**
 * Versioned, password-protected backup archive. Pure JavaScript, so the exact code that runs on
 * the device is what the tests exercise. Photos travel inside the encrypted payload, re-encrypted
 * under the backup password rather than the device key, so a backup restores on a new device.
 */

export const BACKUP_FORMAT = "resurface-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = "resurfacebackup";
/** Declared in app.json so iOS treats backups as ordinary data (for example, offering Save to Files). */
export const BACKUP_UTI = "app.resurface.mobile.backup";
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

export type BackupSettings = Pick<Settings, "dailyCap" | "notificationTime" | "showInsightText">;
export type BackupContents = {
  exportedAt: string;
  insights: Insight[];
  events: ResurfaceEvent[];
  reflections: Reflection[];
  settings: BackupSettings;
  /** Plain JPEG bytes as base64, keyed by insight ID; present exactly for insights with an image. */
  photos: Record<string, string>;
  /** Present only when the user explicitly chose to back up without photos that could not be read. */
  omissions?: BackupOmissions;
};

/** What a backup left out: photos that could not be read, and how that affected insights. */
export type BackupOmissions = { missingPhotos: number; insightsWithoutPhoto: number; insightsLeftOut: number };
export type PhotoRead = { status: "ok"; bytes: Uint8Array } | { status: "missing" | "unreadable" };

export type KdfParams = { name: "scrypt"; N: number; r: number; p: number; salt: string };
type Envelope = { format: string; version: number; kdf: KdfParams; cipher: "AES-256-GCM"; nonce: string; ciphertext: string };

/** About 32 MiB of memory; parameters are stored in each archive so they can be raised later. */
export const DEFAULT_KDF = { N: 2 ** 15, r: 8, p: 1 } as const;

/**
 * Work an archive may demand, checked before any parsing or key derivation. The whole archive is
 * held in memory (several copies while decoding), so the size cap is also enforced on export: the
 * app never produces a backup it could not restore. The KDF ceiling is 64 MiB (128·N·r bytes).
 */
export const BACKUP_LIMITS = {
  maxArchiveChars: 128 * 1024 * 1024,
  maxKdf: { N: 2 ** 16, r: 8, p: 1 },
  maxInsights: 100_000,
  maxEvents: 1_000_000,
  maxReflections: 200_000,
};
export type BackupLimits = typeof BACKUP_LIMITS;

export type BackupErrorCode = "not_a_backup" | "unsupported_version" | "wrong_password_or_damaged" | "invalid_contents" | "too_large" | "incomplete";
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string, readonly omissions?: BackupOmissions) {
    super(message);
    this.name = "BackupError";
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Content-free description of an archive, safe to show and to keep after verification. */
export type BackupSummary = {
  exportedAt: string;
  version: number;
  insights: number;
  photos: number;
  events: number;
  reflections: number;
  omissions: BackupOmissions | null;
};

export function summarizeBackup(contents: BackupContents): BackupSummary {
  return {
    exportedAt: contents.exportedAt,
    version: BACKUP_VERSION,
    insights: contents.insights.length,
    photos: Object.keys(contents.photos).length,
    events: contents.events.length,
    reflections: contents.reflections.length,
    omissions: contents.omissions ?? null,
  };
}

/** Itemizes omissions, either before exporting ("now") or when describing a restored backup ("then"). */
export function describeOmissions({ missingPhotos, insightsWithoutPhoto, insightsLeftOut }: BackupOmissions, when: "now" | "then" = "now"): string {
  const now = when === "now";
  const parts = [`${plural(missingPhotos, "photo", "photos")} ${now ? "can't be read on this device" : "couldn't be read when it was made"}`];
  const verb = (count: number) => (now ? "would be" : count === 1 ? "was" : "were");
  if (insightsLeftOut) parts.push(`${plural(insightsLeftOut, "photo-only insight", "photo-only insights")} ${verb(insightsLeftOut)} left out with its history`);
  if (insightsWithoutPhoto) parts.push(`${plural(insightsWithoutPhoto, "insight", "insights")} ${verb(insightsWithoutPhoto)} saved without its photo`);
  return `${parts.join("; ")}.`;
}

/**
 * Builds backup contents from the database rows and the result of reading each photo. Fails closed:
 * if any photo could not be read, it throws `incomplete` with an itemized count unless the caller
 * passes `allowIncomplete`, in which case the archive records what was left out.
 */
export function assembleBackupContents(
  rows: Omit<BackupContents, "exportedAt" | "photos" | "omissions">,
  photoReads: ReadonlyMap<string, PhotoRead>,
  exportedAt: string,
  { allowIncomplete = false } = {},
): BackupContents {
  const photos: Record<string, string> = {};
  const leftOut = new Set<string>();
  const insights: Insight[] = [];
  const omissions: BackupOmissions = { missingPhotos: 0, insightsWithoutPhoto: 0, insightsLeftOut: 0 };
  for (const insight of rows.insights) {
    if (!insight.imagePath) { insights.push(insight); continue; }
    const read = photoReads.get(insight.id);
    if (read?.status === "ok") { photos[insight.id] = fromByteArray(read.bytes); insights.push(insight); continue; }
    omissions.missingPhotos += 1;
    if (insight.content?.trim()) { omissions.insightsWithoutPhoto += 1; insights.push({ ...insight, imagePath: null, imageMime: null }); }
    else { omissions.insightsLeftOut += 1; leftOut.add(insight.id); }
  }
  if (omissions.missingPhotos && !allowIncomplete) {
    throw new BackupError("incomplete", `This backup would be incomplete: ${describeOmissions(omissions)}`, omissions);
  }
  return validateBackupContents({
    exportedAt,
    insights,
    events: rows.events.filter((event) => !leftOut.has(event.insightId)),
    reflections: rows.reflections.filter((reflection) => !leftOut.has(reflection.insightId)),
    settings: rows.settings,
    photos,
    ...(omissions.missingPhotos ? { omissions } : {}),
  });
}

export type BackupKey = { kdf: KdfParams; key: Uint8Array };

export async function deriveBackupKey(password: string, kdf: KdfParams): Promise<BackupKey> {
  const key = await scryptAsync(password.normalize("NFKC"), toByteArray(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 });
  return { kdf, key };
}

export function newKdfParams(random: (length: number) => Uint8Array, params: { N: number; r: number; p: number } = DEFAULT_KDF): KdfParams {
  return { name: "scrypt", ...params, salt: fromByteArray(random(16)) };
}

/** Every header field is authenticated, so a downgraded version or KDF fails decryption. */
function associatedData(envelope: Omit<Envelope, "ciphertext">): Uint8Array {
  const { format, version, kdf, cipher, nonce } = envelope;
  return new TextEncoder().encode(JSON.stringify([format, version, kdf.name, kdf.N, kdf.r, kdf.p, kdf.salt, cipher, nonce]));
}

export function sealBackup(contents: BackupContents, { kdf, key }: BackupKey, random: (length: number) => Uint8Array, limits: BackupLimits = BACKUP_LIMITS): string {
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, kdf, cipher: "AES-256-GCM" as const, nonce: fromByteArray(random(12)) };
  const plaintext = new TextEncoder().encode(JSON.stringify(contents));
  const ciphertext = gcm(key, toByteArray(header.nonce), associatedData(header)).encrypt(plaintext);
  const text = JSON.stringify({ ...header, ciphertext: fromByteArray(ciphertext) } satisfies Envelope);
  if (text.length > limits.maxArchiveChars) {
    throw new BackupError("too_large", "This backup would be too large to restore on a phone. Nothing was shared.");
  }
  return text;
}

/** Reads only the unencrypted header, so the caller can derive the key before opening. */
export function readBackupHeader(text: string, limits: BackupLimits = BACKUP_LIMITS): KdfParams {
  if (text.length > limits.maxArchiveChars) {
    throw new BackupError("too_large", "This backup is too large to restore on this device. Nothing was changed.");
  }
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { throw new BackupError("not_a_backup", "This file isn't a Resurface backup."); }
  if (!isRecord(envelope) || envelope.format !== BACKUP_FORMAT) throw new BackupError("not_a_backup", "This file isn't a Resurface backup.");
  if (envelope.version !== BACKUP_VERSION) throw new BackupError("unsupported_version", "This backup was made by a newer version of Resurface. Update the app, then try again.");
  const kdf = envelope.kdf;
  const valid = isRecord(kdf) && kdf.name === "scrypt" && envelope.cipher === "AES-256-GCM"
    && isPowerOfTwo(kdf.N) && kdf.N >= 2 ** 10 && kdf.N <= limits.maxKdf.N
    && isInteger(kdf.r) && kdf.r >= 1 && kdf.r <= limits.maxKdf.r && isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= limits.maxKdf.p
    && isBase64(kdf.salt) && isBase64(envelope.nonce) && isBase64(envelope.ciphertext);
  if (!valid) throw new BackupError("not_a_backup", "This backup file is damaged or incomplete.");
  return { name: "scrypt", N: kdf.N as number, r: kdf.r as number, p: kdf.p as number, salt: kdf.salt as string };
}

export function openBackup(text: string, { kdf, key }: BackupKey, limits: BackupLimits = BACKUP_LIMITS): BackupContents {
  const header = readBackupHeader(text, limits);
  if (header.salt !== kdf.salt || header.N !== kdf.N || header.r !== kdf.r || header.p !== kdf.p) {
    throw new BackupError("wrong_password_or_damaged", "The key was derived for a different backup.");
  }
  const envelope = JSON.parse(text) as Envelope;
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, toByteArray(envelope.nonce), associatedData(envelope)).decrypt(toByteArray(envelope.ciphertext));
  } catch {
    throw new BackupError("wrong_password_or_damaged", "The password is wrong, or the backup file is damaged.");
  }
  let contents: unknown;
  try { contents = JSON.parse(new TextDecoder().decode(plaintext)); } catch { throw invalid("unreadable contents"); }
  return validateBackupContents(contents, limits);
}

function invalid(detail: string): BackupError {
  // The detail names a structural problem only; it never includes personal content.
  return new BackupError("invalid_contents", `This backup can't be restored safely (${detail}).`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const isPowerOfTwo = (value: unknown): value is number => isInteger(value) && value > 0 && (value & (value - 1)) === 0;
const isBase64 = (value: unknown): value is string => typeof value === "string" && value.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isOptionalText = (value: unknown): value is string | null => value === null || typeof value === "string";
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptionalTimestamp = (value: unknown): value is string | null => value === null || isTimestamp(value);
const isLocalDay = (value: unknown) => value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** Checks the structure and every cross-reference before anything on the device is touched. */
export function validateBackupContents(value: unknown, limits: BackupLimits = BACKUP_LIMITS): BackupContents {
  if (!isRecord(value)) throw invalid("not an object");
  const { exportedAt, insights, events, reflections, settings, photos, omissions } = value;
  if (!isTimestamp(exportedAt)) throw invalid("export date");
  if (!Array.isArray(insights) || !Array.isArray(events) || !Array.isArray(reflections) || !isRecord(settings) || !isRecord(photos)) throw invalid("missing sections");
  if (insights.length > limits.maxInsights || events.length > limits.maxEvents || reflections.length > limits.maxReflections) {
    throw new BackupError("too_large", "This backup has more records than this device can restore. Nothing was changed.");
  }
  const count = (key: string) => isRecord(omissions) && isInteger(omissions[key]) && (omissions[key] as number) >= 0;
  if (omissions !== undefined && !(count("missingPhotos") && count("insightsWithoutPhoto") && count("insightsLeftOut"))) throw invalid("omissions");

  const insightById = new Map<string, Insight>();
  for (const item of insights) {
    if (!isRecord(item) || !isText(item.id) || !isOptionalText(item.content) || !isOptionalText(item.context)
      || !isOptionalText(item.imagePath) || !(item.imageMime === null || item.imageMime === "image/jpeg")
      || !["active", "paused", "archived"].includes(item.status as string) || !isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt)) {
      throw invalid("insight record");
    }
    if (insightById.has(item.id)) throw invalid("duplicate insight");
    const hasPhoto = Object.hasOwn(photos, item.id);
    if ((item.imagePath !== null) !== hasPhoto) throw invalid("photo does not match insight");
    if (hasPhoto && !isBase64(photos[item.id])) throw invalid("photo data");
    if (!isValidInsight(item.content as string | null, hasPhoto)) throw invalid("empty insight");
    insightById.set(item.id, item as Insight);
  }
  for (const key of Object.keys(photos)) if (!insightById.has(key)) throw invalid("photo without insight");

  const eventById = new Map<string, ResurfaceEvent>();
  const pendingByInsight = new Map<string, number>();
  for (const item of events) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.insightId) || !isInteger(item.stage) || item.stage < 0 || item.stage > 6
      || !isTimestamp(item.scheduledAt) || !isLocalDay(item.selectedDay) || !isOptionalTimestamp(item.selectedAt)
      || !isOptionalText(item.notificationId) || !isOptionalTimestamp(item.notificationPlannedFor)
      || !isOptionalTimestamp(item.shownAt) || !isOptionalTimestamp(item.completedAt) || !isOptionalTimestamp(item.openedAt)
      || ![null, "yes", "not_now", "not_anymore"].includes(item.response as string | null)
      || ![null, "yes", "not_really"].includes(item.valueFeedback as string | null) || !isOptionalTimestamp(item.cancelledAt)) {
      throw invalid("event record");
    }
    if (eventById.has(item.id)) throw invalid("duplicate event");
    if (!insightById.has(item.insightId)) throw invalid("event without insight");
    if (item.shownAt === null && item.cancelledAt === null) pendingByInsight.set(item.insightId, (pendingByInsight.get(item.insightId) ?? 0) + 1);
    eventById.set(item.id, item as ResurfaceEvent);
  }
  for (const insight of insightById.values()) {
    const pending = pendingByInsight.get(insight.id) ?? 0;
    if (pending !== (insight.status === "active" ? 1 : 0)) throw invalid("resurfacing schedule");
  }

  const reflectionIds = new Set<string>();
  for (const item of reflections) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.insightId) || !isText(item.eventId) || !isText(item.content) || !isTimestamp(item.createdAt)) {
      throw invalid("reflection record");
    }
    if (reflectionIds.has(item.id)) throw invalid("duplicate reflection");
    if (eventById.get(item.eventId)?.insightId !== item.insightId) throw invalid("reflection without event");
    reflectionIds.add(item.id);
  }

  if (![1, 3, 5].includes(settings.dailyCap as number) || typeof settings.notificationTime !== "string"
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.notificationTime) || typeof settings.showInsightText !== "boolean") {
    throw invalid("settings");
  }

  return {
    exportedAt,
    insights: insights as Insight[],
    events: events as ResurfaceEvent[],
    reflections: reflections as Reflection[],
    settings: { dailyCap: settings.dailyCap as 1 | 3 | 5, notificationTime: settings.notificationTime, showInsightText: settings.showInsightText },
    photos: photos as Record<string, string>,
    ...(omissions === undefined ? {} : { omissions: omissions as BackupOmissions }),
  };
}
