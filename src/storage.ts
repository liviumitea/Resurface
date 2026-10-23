import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { fromByteArray, toByteArray } from "base64-js";
import {
  BACKUP_EXTENSION, BackupError, deriveBackupKey, newKdfParams, openBackup, readBackupHeader, sealBackup,
  validateBackupContents, type BackupContents,
} from "./backup";
import type { Insight } from "./domain";
import { deleteEncryptedImage, deleteUnreferencedImages, encryptImageFromUri, readImageBytes, writeEncryptedImage } from "./media";
import { CREATE_SCHEMA_SQL } from "./storage-queries";
import { createStore } from "./store";

export type { NotificationCandidate } from "./store";

const DATABASE_KEY_NAME = "resurface.database-key.v1";
const DATABASE_NAME = "resurface.db";

let database: SQLite.SQLiteDatabase | null = null;

function db(): SQLite.SQLiteDatabase {
  if (!database) throw new Error("The local database has not been opened.");
  return database;
}

function id(): string {
  return Crypto.randomUUID();
}

async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_NAME);
  if (existing) return existing;
  // A missing key next to an existing database means the key is unavailable or lost.
  // Generating a replacement would overwrite any key that reappears, so stop instead.
  // expo-sqlite keeps databases in <documents>/SQLite on both iOS and Android.
  if (new File(Paths.document, "SQLite", DATABASE_NAME).exists) {
    throw new Error("The database key is unavailable on this device. Your data has not been reset.");
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
    if (!cipher?.cipher_version) throw new Error("SQLCipher is unavailable in this build. Use a native development build, not Expo Go.");
    await connection.getFirstAsync("SELECT count(*) AS count FROM sqlite_master");
    await connection.execAsync("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    await connection.execAsync(CREATE_SCHEMA_SQL);
    database = connection;
  } catch (error) {
    await connection.closeAsync();
    throw new Error("The encrypted local database could not be opened. Your data has not been reset.", { cause: error });
  }
}

const store = createStore({ db, id, now: () => new Date() });

export const {
  track, getSettings, saveSettings, countInsights, listInsights, getInsight, getEvent, getDetail,
  selectToday, markShown, markOpened, markCompleted, respondToEvent, setInsightStatus, editInsight,
  markValueFeedbackAsked, saveValueFeedback, getShownCount, getBetaMetrics, notificationCandidates,
  clearFutureNotificationPlans, setNotificationPlan,
} = store;

export async function createInsight(content: string | null, context: string | null, imageUri: string | null): Promise<Insight> {
  const insightId = id();
  const imagePath = imageUri ? await encryptImageFromUri(imageUri, insightId) : null;
  try {
    return await store.insertInsight(insightId, content, context, imagePath);
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
 * Photos whose encrypted file is missing are left out; the count is returned so the UI can say so.
 */
export async function createBackupFile(password: string): Promise<{ uri: string; insights: number; missingPhotos: number }> {
  const rows = await store.exportRows();
  const photos: Record<string, string> = {};
  const dropped = new Set<string>();
  let missingPhotos = 0;
  const insights = [];
  for (const insight of rows.insights) {
    const bytes = insight.imagePath ? await readImageBytes(insight.imagePath) : null;
    if (bytes) photos[insight.id] = fromByteArray(bytes);
    if (insight.imagePath && !bytes) {
      missingPhotos += 1;
      if (!insight.content) { dropped.add(insight.id); continue; }
      insights.push({ ...insight, imagePath: null, imageMime: null });
    } else insights.push(insight);
  }
  const contents: BackupContents = validateBackupContents({
    exportedAt: new Date().toISOString(),
    insights,
    events: rows.events.filter((event) => !dropped.has(event.insightId)),
    reflections: rows.reflections.filter((reflection) => !dropped.has(reflection.insightId)),
    settings: rows.settings,
    photos,
  });
  const key = await deriveBackupKey(password, newKdfParams(Crypto.getRandomBytes));
  const text = sealBackup(contents, key, Crypto.getRandomBytes);
  const check = openBackup(text, key);
  if (check.insights.length !== contents.insights.length || check.events.length !== contents.events.length
    || check.reflections.length !== contents.reflections.length || Object.keys(check.photos).length !== Object.keys(photos).length) {
    throw new BackupError("invalid_contents", "The backup could not be verified. Nothing was shared.");
  }
  const file = new File(Paths.cache, `resurface-backup-${contents.exportedAt.slice(0, 10)}.${BACKUP_EXTENSION}`);
  file.create({ overwrite: true });
  file.write(text);
  await store.track("backup_created");
  return { uri: file.uri, insights: contents.insights.length, missingPhotos };
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
export async function restoreBackup(text: string, password: string): Promise<{ insights: number }> {
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
  return { insights: contents.insights.length };
}
