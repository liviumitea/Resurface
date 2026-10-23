import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Insight } from "./domain";
import { deleteEncryptedImage, encryptImageFromUri } from "./media";
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
  saveValueFeedback, getShownCount, getBetaMetrics, notificationCandidates,
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
