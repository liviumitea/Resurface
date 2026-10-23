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
import type { BackupContents } from "./backup";
import {
  SELECT_NOTIFICATION_CANDIDATES_SQL, SELECT_TODAY_DUE_SQL, SELECT_TODAY_EXISTING_SQL,
} from "./storage-queries";

type BindValue = string | number | null;

/** The subset of expo-sqlite's async API the lifecycle needs, so tests can supply node:sqlite. */
export type StoreDatabase = {
  runAsync(source: string, ...params: BindValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(source: string, ...params: BindValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: BindValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

export type StoreDependencies = {
  db: () => StoreDatabase;
  id: () => string;
  now: () => Date;
};

export type NotificationCandidate = ResurfaceEvent & { content: string | null };

export const DEFAULT_SETTINGS: Settings = {
  dailyCap: 3,
  notificationTime: "09:00",
  showInsightText: false,
  onboardingStep: 0,
  onboardingComplete: false,
  permissionAsked: false,
};

/**
 * All persistence rules for insights, events, reflections, settings, and counters.
 * Expo-specific concerns (opening SQLCipher, keys, photo files) stay in storage.ts.
 */
export function createStore({ db, id, now }: StoreDependencies) {
  async function track(name: string): Promise<void> {
    await db().runAsync("INSERT INTO analytics (id, name, createdAt) VALUES (?, ?, ?)", id(), name, now().toISOString());
  }

  async function getSettings(): Promise<Settings> {
    const rows = await db().getAllAsync<{ key: string; value: string }>("SELECT key, value FROM settings");
    const result: Settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in result) {
        (result as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      }
    }
    return result;
  }

  async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
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

  /** Inserts the insight and its first event; the caller owns any already-encrypted photo. */
  async function insertInsight(insightId: string, content: string | null, context: string | null, imagePath: string | null): Promise<Insight> {
    const created = now();
    const insight: Insight = {
      id: insightId,
      content: content?.trim() || null,
      context: context?.trim() || null,
      imagePath,
      imageMime: imagePath ? "image/jpeg" : null,
      status: "active",
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
    };
    await db().withTransactionAsync(async () => {
      await db().runAsync(
        "INSERT INTO insights (id, content, context, imagePath, imageMime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        insight.id, insight.content, insight.context, insight.imagePath, insight.imageMime,
        insight.status, insight.createdAt, insight.updatedAt,
      );
      await insertEvent(eventFor(insight.id, 0, created));
      await track("insight_created");
      await track(imagePath ? (insight.content ? "insight_created_ocr" : "insight_created_photo") : "insight_created_text");
    });
    return insight;
  }

  async function countInsights(): Promise<number> {
    return (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM insights"))?.count ?? 0;
  }

  async function listInsights(status: InsightStatus, search = ""): Promise<Insight[]> {
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

  async function getInsight(idValue: string): Promise<Insight | null> {
    return (await db().getFirstAsync<Insight>("SELECT * FROM insights WHERE id = ?", idValue)) ?? null;
  }

  async function getEvent(idValue: string): Promise<ResurfaceEvent | null> {
    return (await db().getFirstAsync<ResurfaceEvent>("SELECT * FROM events WHERE id = ?", idValue)) ?? null;
  }

  async function getDetail(insightId: string): Promise<InsightDetail | null> {
    const insight = await getInsight(insightId);
    if (!insight) return null;
    const events = await db().getAllAsync<ResurfaceEvent>("SELECT * FROM events WHERE insightId = ? ORDER BY scheduledAt DESC", insightId);
    const reflections = await db().getAllAsync<Reflection>("SELECT * FROM reflections WHERE insightId = ? ORDER BY createdAt DESC", insightId);
    return { insight, events, reflections };
  }

  async function selectToday(clock = now()): Promise<TodayItem[]> {
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

  async function markShown(eventId: string, clock = now()): Promise<void> {
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

  async function markOpened(eventId: string): Promise<void> {
    const result = await db().runAsync("UPDATE events SET openedAt = ? WHERE id = ? AND openedAt IS NULL", now().toISOString(), eventId);
    if (result.changes) await track("notification_opened");
  }

  async function markCompleted(eventId: string): Promise<void> {
    await db().runAsync("UPDATE events SET completedAt = ? WHERE id = ? AND shownAt IS NOT NULL AND completedAt IS NULL", now().toISOString(), eventId);
  }

  async function setInsightStatusInTransaction(insightId: string, status: InsightStatus): Promise<void> {
    const previous = await getInsight(insightId);
    if (!previous || previous.status === status) return;
    const changed = now();
    await db().runAsync("UPDATE insights SET status = ?, updatedAt = ? WHERE id = ?", status, changed.toISOString(), insightId);
    if (status === "active") {
      await insertEvent(eventFor(insightId, 0, changed));
      await track(previous.status === "paused" ? "insight_resumed" : "insight_restored");
    } else {
      await db().runAsync("UPDATE events SET cancelledAt = ? WHERE insightId = ? AND shownAt IS NULL AND cancelledAt IS NULL", changed.toISOString(), insightId);
      await track(status === "paused" ? "insight_paused" : "insight_archived");
    }
  }

  async function respondToEvent(eventId: string, response: Exclude<ResurfaceResponse, null>, reflection?: string): Promise<void> {
    await db().withTransactionAsync(async () => {
      const event = await getEvent(eventId);
      if (!event || event.response || !event.shownAt) return;
      await db().runAsync("UPDATE events SET response = ? WHERE id = ?", response, eventId);
      if (reflection?.trim()) {
        await db().runAsync("INSERT INTO reflections (id, insightId, eventId, content, createdAt) VALUES (?, ?, ?, ?, ?)", id(), event.insightId, eventId, reflection.trim(), now().toISOString());
        await track("reflection_added");
      }
      if (response === "yes") {
        await track("still_relevant");
      } else {
        await setInsightStatusInTransaction(event.insightId, response === "not_now" ? "paused" : "archived");
      }
    });
  }

  async function setInsightStatus(insightId: string, status: InsightStatus): Promise<void> {
    await db().withTransactionAsync(async () => {
      await setInsightStatusInTransaction(insightId, status);
    });
  }

  async function editInsight(insightId: string, content: string | null, context: string | null): Promise<void> {
    await db().runAsync("UPDATE insights SET content = ?, context = ?, updatedAt = ? WHERE id = ?", content?.trim() || null, context?.trim() || null, now().toISOString(), insightId);
  }

  /** Deletes the insight with its events and reflections; returns the photo path for the caller to remove. */
  async function deleteInsightRow(insightId: string): Promise<{ imagePath: string | null } | null> {
    const insight = await getInsight(insightId);
    if (!insight) return null;
    await db().runAsync("DELETE FROM insights WHERE id = ?", insightId);
    await track("insight_deleted");
    return { imagePath: insight.imagePath };
  }

  async function markValueFeedbackAsked(): Promise<void> {
    await track("resurface_value_feedback_asked");
  }

  async function saveValueFeedback(eventId: string, value: "yes" | "not_really"): Promise<void> {
    const result = await db().runAsync("UPDATE events SET valueFeedback = ? WHERE id = ? AND valueFeedback IS NULL", value, eventId);
    if (result.changes) await track("resurface_value_feedback");
  }

  async function getShownCount(): Promise<number> {
    return (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM events WHERE shownAt IS NOT NULL"))?.count ?? 0;
  }

  /**
   * Content-free beta signals. Answer rate is answered / shown and worth rate is yes / answered
   * (build plan); `asked` is reported beside them because the question is only occasional.
   * `saved` counts insights currently kept, so deletions lower it.
   */
  async function getBetaMetrics(): Promise<{ saved: number; shown: number; asked: number; answered: number; valuable: number }> {
    const saved = await countInsights();
    const asked = (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM analytics WHERE name = 'resurface_value_feedback_asked'"))?.count ?? 0;
    const row = await db().getFirstAsync<{ shown: number; answered: number; valuable: number | null }>(
      `SELECT count(shownAt) AS shown, count(valueFeedback) AS answered,
        sum(CASE WHEN valueFeedback = 'yes' THEN 1 ELSE 0 END) AS valuable FROM events`,
    );
    return { saved, shown: row?.shown ?? 0, asked, answered: row?.answered ?? 0, valuable: row?.valuable ?? 0 };
  }

  async function notificationCandidates(clock = now()): Promise<NotificationCandidate[]> {
    return db().getAllAsync<NotificationCandidate>(SELECT_NOTIFICATION_CANDIDATES_SQL, clock.toISOString());
  }

  async function clearFutureNotificationPlans(clock = now()): Promise<void> {
    await db().runAsync("UPDATE events SET notificationId = NULL, notificationPlannedFor = NULL WHERE notificationPlannedFor > ?", clock.toISOString());
  }

  async function setNotificationPlan(eventId: string, notificationId: string, plannedFor: string): Promise<void> {
    await db().runAsync("UPDATE events SET notificationId = ?, notificationPlannedFor = ? WHERE id = ?", notificationId, plannedFor, eventId);
    await track("notification_scheduled");
  }

  async function exportRows(): Promise<Omit<BackupContents, "exportedAt" | "photos">> {
    const settings = await getSettings();
    return {
      insights: await db().getAllAsync<Insight>("SELECT * FROM insights ORDER BY createdAt, id"),
      events: await db().getAllAsync<ResurfaceEvent>("SELECT * FROM events ORDER BY scheduledAt, id"),
      reflections: await db().getAllAsync<Reflection>("SELECT * FROM reflections ORDER BY createdAt, id"),
      settings: { dailyCap: settings.dailyCap, notificationTime: settings.notificationTime, showInsightText: settings.showInsightText },
    };
  }

  /**
   * Replaces every insight, event, and reflection in one transaction; any failure leaves the
   * current data untouched. Notification plans are device-specific, so they are dropped and the
   * caller reconciles them. `imagePaths` maps insight IDs to their newly written photo files.
   */
  async function replaceAllRows(contents: Omit<BackupContents, "exportedAt" | "photos">, imagePaths: Record<string, string>): Promise<void> {
    await db().withTransactionAsync(async () => {
      await db().runAsync("DELETE FROM reflections");
      await db().runAsync("DELETE FROM events");
      await db().runAsync("DELETE FROM insights");
      for (const insight of contents.insights) {
        const imagePath = insight.imagePath === null ? null : imagePaths[insight.id];
        if (imagePath === undefined) throw new Error("A restored photo is missing.");
        await db().runAsync(
          "INSERT INTO insights (id, content, context, imagePath, imageMime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          insight.id, insight.content, insight.context, imagePath, insight.imageMime, insight.status, insight.createdAt, insight.updatedAt,
        );
      }
      for (const event of contents.events) {
        await insertEvent({ ...event, notificationId: null, notificationPlannedFor: null });
      }
      for (const reflection of contents.reflections) {
        await db().runAsync("INSERT INTO reflections (id, insightId, eventId, content, createdAt) VALUES (?, ?, ?, ?, ?)",
          reflection.id, reflection.insightId, reflection.eventId, reflection.content, reflection.createdAt);
      }
      await saveSettings({ ...contents.settings, onboardingComplete: true });
      await track("backup_restored");
    });
  }

  return {
    exportRows, replaceAllRows,
    track, getSettings, saveSettings, insertInsight, countInsights, listInsights, getInsight, getEvent,
    getDetail, selectToday, markShown, markOpened, markCompleted, respondToEvent, setInsightStatus,
    editInsight, deleteInsightRow, markValueFeedbackAsked, saveValueFeedback, getShownCount, getBetaMetrics,
    notificationCandidates, clearFutureNotificationPlans, setNotificationPlan,
  };
}
