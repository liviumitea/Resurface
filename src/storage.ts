import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { fromByteArray, toByteArray } from "base64-js";
import {
  BACKUP_EXTENSION, BackupError, assembleBackupContents, deriveBackupKey, newKdfParams, openBackup, readBackupHeader,
  sealBackup, summarizeBackup, type BackupOmissions, type BackupSummary, type PhotoRead,
} from "./backup";
import type { Insight } from "./domain";
import {
  IMAGE_DIRECTORY_NAME, IMAGE_KEY_NAME, deleteEncryptedImage, deleteUnreferencedImages, encryptImageFromUri,
  readImageBytes, writeEncryptedImage, type PhotoSaveStage,
} from "./media";
import { MigrationError, runMigrations } from "./migrations";
import { createStore } from "./store";

export { CategoryError } from "./store";
export type { BackupStatus, BetaMetrics, NotificationCandidate } from "./store";

const DATABASE_KEY_NAME = "resurface.database-key.v1";
const DATABASE_NAME = "resurface.db";

let database: SQLite.SQLiteDatabase | null = null;

/**
 * Why local data could not be opened. Only `key_unavailable` and `cannot_open` may offer starting
 * fresh; a locked keychain or a build without SQLCipher must never lead to moving data aside.
 */
export type StorageFailure = "keychain_locked" | "key_unavailable" | "cannot_open" | "no_sqlcipher" | "schema_too_new" | "migration_failed";
export class StorageError extends Error {
  constructor(readonly reason: StorageFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

function db(): SQLite.SQLiteDatabase {
  if (!database) throw new Error("The local database has not been opened.");
  return database;
}

function id(): string {
  return Crypto.randomUUID();
}

async function readKey(name: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync(name); }
  catch (error) { throw new StorageError("keychain_locked", "The device keychain is not available yet. Unlock your device, then try again.", { cause: error }); }
}

async function databaseKey(): Promise<string> {
  const existing = await readKey(DATABASE_KEY_NAME);
  if (existing) return existing;
  // A missing key next to an existing database means the key is unavailable or lost.
  // Generating a replacement would overwrite any key that reappears, so stop instead.
  // expo-sqlite keeps databases in <documents>/SQLite on both iOS and Android.
  if (new File(Paths.document, "SQLite", DATABASE_NAME).exists) {
    throw new StorageError("key_unavailable", "The database key is unavailable on this device. Your data has not been reset.");
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(DATABASE_KEY_NAME, key);
  return key;
}

export async function openStorage(): Promise<void> {
  if (database) return;
  const key = await databaseKey();
  const connection = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    // The key is generated as hex, so it cannot escape the PRAGMA string literal.
    await connection.execAsync(`PRAGMA key = '${key}';`);
    const cipher = await connection.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) throw new StorageError("no_sqlcipher", "SQLCipher is unavailable in this build. Use a native development build, not Expo Go.");
    await connection.getFirstAsync("SELECT count(*) AS count FROM sqlite_master");
    await connection.execAsync("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    await runMigrations(connection);
    database = connection;
  } catch (error) {
    await connection.closeAsync();
    if (error instanceof StorageError) throw error;
    if (error instanceof MigrationError) throw new StorageError(error.reason, error.message, { cause: error });
    throw new StorageError("cannot_open", "The encrypted local database could not be opened. Your data has not been reset.", { cause: error });
  }
}

const store = createStore({ db, id, now: () => new Date() });

export const {
  track, getSettings, saveSettings, getBackupStatus, listCategories, createCategory, renameCategory, deleteCategory, setInsightCategories, setFavorite, countInsights, listInsights, getInsight, getEvent, getDetail,
  selectToday, listUpcoming, markShown, markOpened, markCompleted, respondToEvent, setReflectionNote, setInsightStatus, snoozeInsight, editInsight,
  markValueFeedbackAsked, saveValueFeedback, getShownCount, getBetaMetrics, notificationCandidates,
  clearFutureNotificationPlans, setNotificationPlan,
} = store;

export async function createInsight(
  content: string | null, context: string | null, imageUri: string | null, categoryIds: string[] = [], source: string | null = null,
  onPhotoStage?: (stage: PhotoSaveStage) => void,
): Promise<Insight> {
  const insightId = id();
  const imagePath = imageUri ? await encryptImageFromUri(imageUri, insightId, onPhotoStage) : null;
  try {
    return await store.insertInsight(insightId, content, context, imagePath, categoryIds, source);
  } catch (error) {
    deleteEncryptedImage(imagePath);
    throw error;
  }
}

export async function deleteInsight(insightId: string): Promise<void> {
  const deleted = await store.deleteInsightRow(insightId);
  if (deleted) deleteEncryptedImage(deleted.imagePath);
}

/**
 * Writes a password-protected backup to the app cache and verifies it opens before returning.
 * Fails closed with `incomplete` if any photo cannot be read, unless the user has explicitly
 * chosen to back up without them, in which case the archive records what was left out.
 */
export async function createBackupFile(password: string, { allowIncomplete = false } = {}): Promise<{ uri: string; insights: number; omissions?: BackupOmissions }> {
  const rows = await store.exportRows();
  const photoReads = new Map<string, PhotoRead>();
  for (const insight of rows.insights) {
    if (!insight.imagePath) continue;
    try {
      const bytes = await readImageBytes(insight.imagePath);
      photoReads.set(insight.id, bytes ? { status: "ok", bytes } : { status: "missing" });
    } catch {
      photoReads.set(insight.id, { status: "unreadable" });
    }
  }
  const contents = assembleBackupContents(rows, photoReads, new Date().toISOString(), { allowIncomplete });
  const key = await deriveBackupKey(password, newKdfParams(Crypto.getRandomBytes));
  const text = sealBackup(contents, key, Crypto.getRandomBytes);
  const check = openBackup(text, key);
  if (check.insights.length !== contents.insights.length || check.events.length !== contents.events.length
    || check.reflections.length !== contents.reflections.length || Object.keys(check.photos).length !== Object.keys(contents.photos).length) {
    throw new BackupError("invalid_contents", "The backup could not be verified. Nothing was shared.");
  }
  const file = new File(Paths.cache, `resurface-backup-${contents.exportedAt.slice(0, 10)}.${BACKUP_EXTENSION}`);
  file.create({ overwrite: true });
  file.write(text);
  await store.track(contents.omissions ? "backup_created_incomplete" : "backup_created");
  return { uri: file.uri, insights: contents.insights.length, ...(contents.omissions ? { omissions: contents.omissions } : {}) };
}

/** Deletes a backup or picked file from the app cache once it has been shared or read. */
export function deleteCachedFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
  } catch {
    // Best effort; the file only ever contains ciphertext.
  }
}

/**
 * Replaces everything on this device with a backup. The archive is fully decrypted and validated,
 * and its photos written to new files, before the single database transaction that swaps the data.
 * Any failure removes the new photos and leaves current data untouched.
 */
export async function restoreBackup(text: string, password: string): Promise<{ insights: number; omissions?: BackupOmissions }> {
  const contents = openBackup(text, await deriveBackupKey(password, readBackupHeader(text)));
  const restoreId = id();
  const imagePaths: Record<string, string> = {};
  try {
    for (const [insightId, photo] of Object.entries(contents.photos)) {
      imagePaths[insightId] = await writeEncryptedImage(toByteArray(photo), `${insightId}-${restoreId}`);
    }
    await store.replaceAllRows(contents, imagePaths);
  } catch (error) {
    for (const path of Object.values(imagePaths)) deleteEncryptedImage(path);
    throw error;
  }
  deleteUnreferencedImages(Object.values(imagePaths));
  return { insights: contents.insights.length, ...(contents.omissions ? { omissions: contents.omissions } : {}) };
}

/**
 * Last resort when local data cannot be opened: moves the database, photos and any remaining keys
 * aside under a dated name, deleting nothing, so the app can start empty and a backup can be
 * restored. If the key ever becomes available again, the set-aside data can still be recovered.
 * Refuses while the keychain is locked, since waiting and retrying is the right fix then.
 */
export async function setAsideUnreadableData(): Promise<string> {
  if (database) throw new Error("The database is open, so there is nothing to set aside.");
  const keys: [string, string | null][] = [];
  for (const name of [DATABASE_KEY_NAME, IMAGE_KEY_NAME]) keys.push([name, await readKey(name)]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const aside = new Directory(Paths.document, `unreadable-${stamp}`);
  aside.create({ intermediates: true });
  const sqlite = new Directory(Paths.document, "SQLite");
  for (const name of [DATABASE_NAME, `${DATABASE_NAME}-wal`, `${DATABASE_NAME}-shm`]) {
    const file = new File(sqlite, name);
    if (file.exists) file.move(aside);
  }
  const images = new Directory(Paths.document, IMAGE_DIRECTORY_NAME);
  if (images.exists) images.move(aside);
  for (const [name, value] of keys) {
    if (!value) continue;
    await SecureStore.setItemAsync(`${name}.set-aside-${stamp}`, value);
    await SecureStore.deleteItemAsync(name);
  }
  return aside.name;
}

/**
 * Checks a chosen backup file without changing anything on the device: the password, integrity,
 * version, structure and counts must all pass. Only a content-free summary is kept.
 */
export async function verifyBackup(text: string, password: string): Promise<BackupSummary> {
  const contents = openBackup(text, await deriveBackupKey(password, readBackupHeader(text)));
  const summary = summarizeBackup(contents);
  await store.recordBackupVerified(summary);
  return summary;
}
