import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import {
  dueForStage,
  localDay,
  type Insight,
  type InsightDetail,
  type InsightStatus,
  type Reflection,
  type ResurfaceEvent,
  type ResurfaceResponse,
  type Settings,
  type TodayItem,
} from "./domain";
import { deleteEncryptedImage, encryptImageFromUri } from "./media";
import {
  CREATE_SCHEMA_SQL, SELECT_NOTIFICATION_CANDIDATES_SQL,
  SELECT_TODAY_DUE_SQL, SELECT_TODAY_EXISTING_SQL,
} from "./storage-queries";

const DATABASE_KEY_NAME = "resurface.database-key.v1";
const DATABASE_NAME = "resurface.db";
const DEFAULT_SETTINGS: Settings = {
  dailyCap: 3,
  notificationTime: "09:00",
  showInsightText: false,
  onboardingStep: 0,
  onboardingComplete: false,
  permissionAsked: false,
};

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

export async function track(name: string): Promise<void> {
  await db().runAsync("INSERT INTO analytics (id, name, createdAt) VALUES (?, ?, ?)", id(), name, new Date().toISOString());
}

export async function getSettings(): Promise<Settings> {
  const rows = await db().getAllAsync<{ key: string; value: string }>("SELECT key, value FROM settings");
  const result: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in result) {
      (result as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    }
  }
  return result;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  for (const [key, value] of Object.entries(patch)) {
    await db().runAsync("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }
  return getSettings();
}

function eventFor(insightId: string, stage: number, from: Date): ResurfaceEvent {
  return {
    id: id(), insightId, stage, scheduledAt: dueForStage(from, stage),
    selectedDay: null, selectedAt: null, notificationId: null, notificationPlannedFor: null,
    shownAt: null, completedAt: null, openedAt: null, response: null, valueFeedback: null, cancelledAt: null,
  };
}

async function insertEvent(event: ResurfaceEvent): Promise<void> {
  await db().runAsync(
    `INSERT INTO events (id, insightId, stage, scheduledAt, selectedDay, selectedAt, notificationId, notificationPlannedFor, shownAt, completedAt, openedAt, response, valueFeedback, cancelledAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.id, event.insightId, event.stage, event.scheduledAt, event.selectedDay,
    event.selectedAt, event.notificationId, event.notificationPlannedFor, event.shownAt,
    event.completedAt, event.openedAt, event.response, event.valueFeedback, event.cancelledAt,
  );
}

export async function createInsight(content: string | null, context: string | null, imageUri: string | null): Promise<Insight> {
  const now = new Date();
  const insightId = id();
  const imagePath = imageUri ? await encryptImageFromUri(imageUri, insightId) : null;
  const insight: Insight = {
    id: insightId,
    content: content?.trim() || null,
    context: context?.trim() || null,
    imagePath,
    imageMime: imagePath ? "image/jpeg" : null,
    status: "active",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  try {
    await db().withTransactionAsync(async () => {
      await db().runAsync(
        "INSERT INTO insights (id, content, context, imagePath, imageMime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        insight.id, insight.content, insight.context, insight.imagePath, insight.imageMime,
        insight.status, insight.createdAt, insight.updatedAt,
      );
      await insertEvent(eventFor(insight.id, 0, now));
      await track("insight_created");
      await track(imagePath ? (insight.content ? "insight_created_ocr" : "insight_created_photo") : "insight_created_text");
    });
  } catch (error) {
    deleteEncryptedImage(imagePath);
    throw error;
  }
  return insight;
}

export async function countInsights(): Promise<number> {
  return (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM insights"))?.count ?? 0;
}

export async function listInsights(status: InsightStatus, search = ""): Promise<Insight[]> {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return db().getAllAsync<Insight>("SELECT * FROM insights WHERE status = ? ORDER BY createdAt DESC", status);
  }
  const escaped = normalized.replace(/[\\%_]/g, "\\$&");
  return db().getAllAsync<Insight>(
    "SELECT * FROM insights WHERE status = ? AND (lower(content) LIKE ? ESCAPE '\\' OR lower(context) LIKE ? ESCAPE '\\') ORDER BY createdAt DESC",
    status, `%${escaped}%`, `%${escaped}%`,
  );
}

export async function getInsight(idValue: string): Promise<Insight | null> {
  return (await db().getFirstAsync<Insight>("SELECT * FROM insights WHERE id = ?", idValue)) ?? null;
}

export async function getEvent(idValue: string): Promise<ResurfaceEvent | null> {
  return (await db().getFirstAsync<ResurfaceEvent>("SELECT * FROM events WHERE id = ?", idValue)) ?? null;
}

export async function getDetail(insightId: string): Promise<InsightDetail | null> {
  const insight = await getInsight(insightId);
  if (!insight) return null;
  const events = await db().getAllAsync<ResurfaceEvent>("SELECT * FROM events WHERE insightId = ? ORDER BY scheduledAt DESC", insightId);
  const reflections = await db().getAllAsync<Reflection>("SELECT * FROM reflections WHERE insightId = ? ORDER BY createdAt DESC", insightId);
  return { insight, events, reflections };
}

export async function selectToday(clock = new Date()): Promise<TodayItem[]> {
  const settings = await getSettings();
  const day = localDay(clock);
  const existing = await db().getAllAsync<ResurfaceEvent>(SELECT_TODAY_EXISTING_SQL, day);
  const slots = Math.max(0, settings.dailyCap - existing.length);
  if (slots > 0) {
    const due = await db().getAllAsync<ResurfaceEvent>(SELECT_TODAY_DUE_SQL, clock.toISOString(), day, slots);
    for (const event of due) {
      await db().runAsync("UPDATE events SET selectedDay = ?, selectedAt = ? WHERE id = ?", day, clock.toISOString(), event.id);
      await track("resurface_selected");
      existing.push({ ...event, selectedDay: day, selectedAt: clock.toISOString() });
    }
  }
  const items: TodayItem[] = [];
  for (const event of existing) {
    const insight = await getInsight(event.insightId);
    if (insight) items.push({ insight, event });
  }
  return items;
}

export async function markShown(eventId: string, clock = new Date()): Promise<void> {
  await db().withTransactionAsync(async () => {
    const event = await getEvent(eventId);
    if (!event || event.shownAt || event.cancelledAt) return;
    const insight = await getInsight(event.insightId);
    if (!insight || insight.status !== "active") return;
    const result = await db().runAsync("UPDATE events SET shownAt = ? WHERE id = ? AND shownAt IS NULL", clock.toISOString(), eventId);
    if (result.changes === 0) return;
    await insertEvent(eventFor(event.insightId, Math.min(event.stage + 1, 6), clock));
    await track("resurface_shown");
  });
}

export async function markOpened(eventId: string): Promise<void> {
  const result = await db().runAsync("UPDATE events SET openedAt = ? WHERE id = ? AND openedAt IS NULL", new Date().toISOString(), eventId);
  if (result.changes) await track("notification_opened");
}

export async function markCompleted(eventId: string): Promise<void> {
  await db().runAsync("UPDATE events SET completedAt = ? WHERE id = ? AND shownAt IS NOT NULL AND completedAt IS NULL", new Date().toISOString(), eventId);
}

export async function respondToEvent(eventId: string, response: Exclude<ResurfaceResponse, null>, reflection?: string): Promise<void> {
  await db().withTransactionAsync(async () => {
    const event = await getEvent(eventId);
    if (!event || event.response || !event.shownAt) return;
    await db().runAsync("UPDATE events SET response = ? WHERE id = ?", response, eventId);
    if (reflection?.trim()) {
      await db().runAsync("INSERT INTO reflections (id, insightId, eventId, content, createdAt) VALUES (?, ?, ?, ?, ?)", id(), event.insightId, eventId, reflection.trim(), new Date().toISOString());
      await track("reflection_added");
    }
    if (response === "yes") {
      await track("still_relevant");
    } else {
      await setInsightStatusInTransaction(event.insightId, response === "not_now" ? "paused" : "archived");
    }
  });
}

async function setInsightStatusInTransaction(insightId: string, status: InsightStatus): Promise<void> {
  const previous = await getInsight(insightId);
  if (!previous || previous.status === status) return;
  const now = new Date();
  await db().runAsync("UPDATE insights SET status = ?, updatedAt = ? WHERE id = ?", status, now.toISOString(), insightId);
  if (status === "active") {
    await insertEvent(eventFor(insightId, 0, now));
    await track(previous.status === "paused" ? "insight_resumed" : "insight_restored");
  } else {
    await db().runAsync("UPDATE events SET cancelledAt = ? WHERE insightId = ? AND shownAt IS NULL AND cancelledAt IS NULL", now.toISOString(), insightId);
    await track(status === "paused" ? "insight_paused" : "insight_archived");
  }
}

export async function setInsightStatus(insightId: string, status: InsightStatus): Promise<void> {
  await db().withTransactionAsync(async () => {
    await setInsightStatusInTransaction(insightId, status);
  });
}

export async function editInsight(insightId: string, content: string | null, context: string | null): Promise<void> {
  await db().runAsync("UPDATE insights SET content = ?, context = ?, updatedAt = ? WHERE id = ?", content?.trim() || null, context?.trim() || null, new Date().toISOString(), insightId);
}

export async function deleteInsight(insightId: string): Promise<void> {
  const insight = await getInsight(insightId);
  if (!insight) return;
  await db().runAsync("DELETE FROM insights WHERE id = ?", insightId);
  deleteEncryptedImage(insight.imagePath);
  await track("insight_deleted");
}

export async function saveValueFeedback(eventId: string, value: "yes" | "not_really"): Promise<void> {
  const result = await db().runAsync("UPDATE events SET valueFeedback = ? WHERE id = ? AND valueFeedback IS NULL", value, eventId);
  if (result.changes) await track("resurface_value_feedback");
}

export async function getShownCount(): Promise<number> {
  return (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM events WHERE shownAt IS NOT NULL"))?.count ?? 0;
}

export async function getBetaMetrics(): Promise<{ saved: number; shown: number; answered: number; valuable: number }> {
  const saved = await countInsights();
  const row = await db().getFirstAsync<{ shown: number; answered: number; valuable: number }>(
    `SELECT count(shownAt) AS shown, count(valueFeedback) AS answered,
      sum(CASE WHEN valueFeedback = 'yes' THEN 1 ELSE 0 END) AS valuable FROM events`,
  );
  return { saved, shown: row?.shown ?? 0, answered: row?.answered ?? 0, valuable: row?.valuable ?? 0 };
}

export type NotificationCandidate = ResurfaceEvent & { content: string | null };

export async function notificationCandidates(clock = new Date()): Promise<NotificationCandidate[]> {
  return db().getAllAsync<NotificationCandidate>(SELECT_NOTIFICATION_CANDIDATES_SQL, clock.toISOString());
}

export async function clearFutureNotificationPlans(clock = new Date()): Promise<void> {
  await db().runAsync("UPDATE events SET notificationId = NULL, notificationPlannedFor = NULL WHERE notificationPlannedFor > ?", clock.toISOString());
}

export async function setNotificationPlan(eventId: string, notificationId: string, plannedFor: string): Promise<void> {
  await db().runAsync("UPDATE events SET notificationId = ?, notificationPlannedFor = ? WHERE id = ?", notificationId, plannedFor, eventId);
  await track("notification_scheduled");
}
