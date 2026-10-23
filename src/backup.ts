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
};

export type KdfParams = { name: "scrypt"; N: number; r: number; p: number; salt: string };
type Envelope = { format: string; version: number; kdf: KdfParams; cipher: "AES-256-GCM"; nonce: string; ciphertext: string };

/** About 32 MiB of memory; parameters are stored in each archive so they can be raised later. */
export const DEFAULT_KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
// Bounds on what an archive may ask for, so a crafted file cannot exhaust memory or time.
const MAX_KDF = { N: 2 ** 20, r: 16, p: 4 } as const;

export type BackupErrorCode = "not_a_backup" | "unsupported_version" | "wrong_password_or_damaged" | "invalid_contents";
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
  }
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

export function sealBackup(contents: BackupContents, { kdf, key }: BackupKey, random: (length: number) => Uint8Array): string {
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, kdf, cipher: "AES-256-GCM" as const, nonce: fromByteArray(random(12)) };
  const plaintext = new TextEncoder().encode(JSON.stringify(contents));
  const ciphertext = gcm(key, toByteArray(header.nonce), associatedData(header)).encrypt(plaintext);
  return JSON.stringify({ ...header, ciphertext: fromByteArray(ciphertext) } satisfies Envelope);
}

/** Reads only the unencrypted header, so the caller can derive the key before opening. */
export function readBackupHeader(text: string): KdfParams {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { throw new BackupError("not_a_backup", "This file isn't a Resurface backup."); }
  if (!isRecord(envelope) || envelope.format !== BACKUP_FORMAT) throw new BackupError("not_a_backup", "This file isn't a Resurface backup.");
  if (envelope.version !== BACKUP_VERSION) throw new BackupError("unsupported_version", "This backup was made by a newer version of Resurface. Update the app, then try again.");
  const kdf = envelope.kdf;
  const valid = isRecord(kdf) && kdf.name === "scrypt" && envelope.cipher === "AES-256-GCM"
    && isPowerOfTwo(kdf.N) && kdf.N >= 2 ** 10 && kdf.N <= MAX_KDF.N
    && isInteger(kdf.r) && kdf.r >= 1 && kdf.r <= MAX_KDF.r && isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= MAX_KDF.p
    && isBase64(kdf.salt) && isBase64(envelope.nonce) && isBase64(envelope.ciphertext);
  if (!valid) throw new BackupError("not_a_backup", "This backup file is damaged or incomplete.");
  return { name: "scrypt", N: kdf.N as number, r: kdf.r as number, p: kdf.p as number, salt: kdf.salt as string };
}

export function openBackup(text: string, { kdf, key }: BackupKey): BackupContents {
  const header = readBackupHeader(text);
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
  return validateBackupContents(contents);
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
export function validateBackupContents(value: unknown): BackupContents {
  if (!isRecord(value)) throw invalid("not an object");
  const { exportedAt, insights, events, reflections, settings, photos } = value;
  if (!isTimestamp(exportedAt)) throw invalid("export date");
  if (!Array.isArray(insights) || !Array.isArray(events) || !Array.isArray(reflections) || !isRecord(settings) || !isRecord(photos)) throw invalid("missing sections");

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
  };
}
