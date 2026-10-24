import {
  MAX_CATEGORY_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  dueForStage,
  localDay,
  normalizeCategoryName,
  type Category,
  type CategoryWithCount,
  type InsightCategory,
  type LibraryItem,
  type LibrarySort,
  type Insight,
  type InsightDetail,
  type InsightStatus,
  type Reflection,
  type ResurfaceEvent,
  type ResurfaceResponse,
  type Settings,
  type TodayItem,
  normalizeQuietDays,
  matchesSearch,
  type LibraryStatus,
} from "./domain";
import type { BackupContents, BackupSummary } from "./backup";
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

function cleanSource(source: string | null): string | null {
  const trimmed = source?.trim().replace(/\s+/g, " ") ?? "";
  return trimmed ? trimmed.slice(0, MAX_SOURCE_LENGTH) : null;
}

export type CategoryProblem = "empty" | "too_long" | "duplicate" | "missing";
export class CategoryError extends Error {
  constructor(readonly problem: CategoryProblem, message: string) {
    super(message);
    this.name = "CategoryError";
  }
}

export type BetaMetrics = {
  firstSaveAt: string | null;
  coreLoopAt: string | null;
  saved: number;
  shown: number;
  asked: number;
  answered: number;
  valuable: number;
};

/**
 * What this device knows about backups. "Created" only means an archive was made and offered to
 * the share sheet; the app cannot see whether the destination kept it. "Verified" means a chosen
 * file opened with its password; only its content-free summary is kept.
 */
export type BackupStatus = {
  lastCreatedAt: string | null;
  lastCreatedComplete: boolean | null;
  lastVerified: (BackupSummary & { verifiedAt: string }) | null;
};

const LAST_VERIFIED_KEY = "backup.lastVerified";

export const DEFAULT_SETTINGS: Settings = {
  language: "system",
  dailyCap: 3,
  notificationTime: "09:00",
  quietDays: [],
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
    result.quietDays = normalizeQuietDays(result.quietDays);
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

  /** Inserts the insight, its first event and any categories; the caller owns any already-encrypted photo. */
  async function insertInsight(insightId: string, content: string | null, context: string | null, imagePath: string | null, categoryIds: string[] = [], source: string | null = null): Promise<Insight> {
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
      source: cleanSource(source),
      favorite: 0,
    };
    await db().withTransactionAsync(async () => {
      await db().runAsync(
        "INSERT INTO insights (id, content, context, imagePath, imageMime, status, createdAt, updatedAt, source, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        insight.id, insight.content, insight.context, insight.imagePath, insight.imageMime,
        insight.status, insight.createdAt, insight.updatedAt, insight.source, insight.favorite,
      );
      await insertEvent(eventFor(insight.id, 0, created));
      await linkCategories(insight.id, categoryIds);
      await track("insight_created");
      await track(imagePath ? (insight.content ? "insight_created_ocr" : "insight_created_photo") : "insight_created_text");
    });
    return insight;
  }

  async function countInsights(): Promise<number> {
    return (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM insights"))?.count ?? 0;
  }

  /**
   * Library rows. Search runs in JavaScript rather than SQL: SQLite's lower() folds only ASCII, so
   * "învață" never matched "Învață". Matching ignores case and accents across text, context and source.
   */
  async function listInsights(status: LibraryStatus, search = "", categoryId: string | null = null, favoritesOnly = false, sort: LibrarySort = "newest"): Promise<LibraryItem[]> {
    const where = ["1 = 1"];
    const params: (string | number | null)[] = [];
    if (status !== "all") {
      where.push("status = ?");
      params.push(status);
    }
    if (categoryId) {
      where.push("id IN (SELECT insightId FROM insight_categories WHERE categoryId = ?)");
      params.push(categoryId);
    }
    if (favoritesOnly) where.push("favorite = 1");
    const order = sort === "oldest" ? "createdAt ASC, id ASC"
      : sort === "resurfaced" ? "lastShownAt IS NULL, lastShownAt DESC, createdAt DESC, id ASC"
      : "createdAt DESC, id ASC";
    const rows = await db().getAllAsync<LibraryItem>(
      `SELECT insights.*,
        (SELECT count(*) FROM events WHERE events.insightId = insights.id AND events.shownAt IS NOT NULL) AS timesShown,
        (SELECT max(shownAt) FROM events WHERE events.insightId = insights.id) AS lastShownAt
       FROM insights WHERE ${where.join(" AND ")} ORDER BY ${order}`,
      ...params,
    );
    return search.trim() ? rows.filter((row) => matchesSearch([row.content, row.context, row.source], search)) : rows;
  }

  async function listCategories(): Promise<CategoryWithCount[]> {
    return db().getAllAsync<CategoryWithCount>(
      `SELECT categories.*, count(insight_categories.insightId) AS insights FROM categories
       LEFT JOIN insight_categories ON insight_categories.categoryId = categories.id
       GROUP BY categories.id ORDER BY categories.name COLLATE NOCASE`,
    );
  }

  async function checkedCategoryName(name: string, exceptId: string | null): Promise<string> {
    const normalized = normalizeCategoryName(name);
    if (!normalized) throw new CategoryError("empty", "Give the category a name.");
    if (normalized.length > MAX_CATEGORY_NAME_LENGTH) throw new CategoryError("too_long", `Use at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);
    const clash = await db().getFirstAsync<{ id: string }>("SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id IS NOT ?", normalized, exceptId);
    if (clash) throw new CategoryError("duplicate", "A category with that name already exists.");
    return normalized;
  }

  async function createCategory(name: string): Promise<Category> {
    const category: Category = { id: id(), name: await checkedCategoryName(name, null), createdAt: now().toISOString() };
    await db().runAsync("INSERT INTO categories (id, name, createdAt) VALUES (?, ?, ?)", category.id, category.name, category.createdAt);
    await track("category_created");
    return category;
  }

  async function renameCategory(categoryId: string, name: string): Promise<void> {
    const normalized = await checkedCategoryName(name, categoryId);
    const result = await db().runAsync("UPDATE categories SET name = ? WHERE id = ?", normalized, categoryId);
    if (!result.changes) throw new CategoryError("missing", "That category no longer exists.");
  }

  /** Removes the category and its links; the insights themselves are untouched. Returns how many were linked. */
  async function deleteCategory(categoryId: string): Promise<number> {
    const linked = (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM insight_categories WHERE categoryId = ?", categoryId))?.count ?? 0;
    await db().runAsync("DELETE FROM categories WHERE id = ?", categoryId);
    await track("category_deleted");
    return linked;
  }

  async function linkCategories(insightId: string, categoryIds: string[]): Promise<void> {
    for (const categoryId of new Set(categoryIds)) {
      await db().runAsync(
        "INSERT OR IGNORE INTO insight_categories (insightId, categoryId) SELECT ?, id FROM categories WHERE id = ?",
        insightId, categoryId,
      );
    }
  }

  /** Replaces an insight's categories; unknown category IDs are ignored. */
  async function setInsightCategories(insightId: string, categoryIds: string[]): Promise<void> {
    await db().withTransactionAsync(async () => {
      await db().runAsync("DELETE FROM insight_categories WHERE insightId = ?", insightId);
      await linkCategories(insightId, categoryIds);
    });
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
    const categories = await db().getAllAsync<Category>(
      `SELECT categories.* FROM categories JOIN insight_categories ON insight_categories.categoryId = categories.id
       WHERE insight_categories.insightId = ? ORDER BY categories.name COLLATE NOCASE`, insightId,
    );
    return { insight, events, reflections, categories };
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

  /**
   * Defers an active insight until `until` without recording a response. The pending event is
   * cancelled (it stays in history) and replaced by one at the same stage, so exactly one remains.
   * Returns false when there is nothing to snooze.
   */
  async function snoozeInsight(insightId: string, until: Date): Promise<boolean> {
    let snoozed = false;
    await db().withTransactionAsync(async () => {
      const insight = await getInsight(insightId);
      if (!insight || insight.status !== "active" || until.getTime() <= now().getTime()) return;
      const pending = await db().getFirstAsync<ResurfaceEvent>(
        "SELECT * FROM events WHERE insightId = ? AND shownAt IS NULL AND cancelledAt IS NULL ORDER BY scheduledAt LIMIT 1", insightId,
      );
      if (!pending) return;
      await db().runAsync("UPDATE events SET cancelledAt = ? WHERE id = ?", now().toISOString(), pending.id);
      await insertEvent({ ...eventFor(insightId, pending.stage, now()), scheduledAt: until.toISOString() });
      await track("insight_snoozed");
      snoozed = true;
    });
    return snoozed;
  }

  async function setInsightStatus(insightId: string, status: InsightStatus): Promise<void> {
    await db().withTransactionAsync(async () => {
      await setInsightStatusInTransaction(insightId, status);
    });
  }

  async function editInsight(insightId: string, content: string | null, context: string | null, source: string | null = null): Promise<void> {
    await db().runAsync("UPDATE insights SET content = ?, context = ?, source = ?, updatedAt = ? WHERE id = ?", content?.trim() || null, context?.trim() || null, cleanSource(source), now().toISOString(), insightId);
  }

  /** Stars or unstars an insight; this is not a response and does not affect resurfacing. */
  async function setFavorite(insightId: string, favorite: boolean): Promise<void> {
    await db().runAsync("UPDATE insights SET favorite = ? WHERE id = ?", favorite ? 1 : 0, insightId);
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
   * `saved` counts insights currently kept, so deletions lower it. Two milestones come from counters
   * that survive deletion: `firstSaveAt` (first-save activation, as Product Spec v0.2 defines
   * activation) and `coreLoopAt` (the first resurfacing seen after that save). Their timestamps let a
   * pilot apply its own participant and time-window denominators.
   */
  async function getBetaMetrics(): Promise<BetaMetrics> {
    const saved = await countInsights();
    const asked = (await db().getFirstAsync<{ count: number }>("SELECT count(*) AS count FROM analytics WHERE name = 'resurface_value_feedback_asked'"))?.count ?? 0;
    const firstSaveAt = (await db().getFirstAsync<{ at: string | null }>(
      "SELECT min(createdAt) AS at FROM analytics WHERE name = 'insight_created'",
    ))?.at ?? null;
    const coreLoopAt = firstSaveAt ? (await db().getFirstAsync<{ at: string | null }>(
      "SELECT min(createdAt) AS at FROM analytics WHERE name = 'resurface_shown' AND createdAt >= ?", firstSaveAt,
    ))?.at ?? null : null;
    const row = await db().getFirstAsync<{ shown: number; answered: number; valuable: number | null }>(
      `SELECT count(shownAt) AS shown, count(valueFeedback) AS answered,
        sum(CASE WHEN valueFeedback = 'yes' THEN 1 ELSE 0 END) AS valuable FROM events`,
    );
    return { firstSaveAt, coreLoopAt, saved, shown: row?.shown ?? 0, asked, answered: row?.answered ?? 0, valuable: row?.valuable ?? 0 };
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
      categories: await db().getAllAsync<Category>("SELECT * FROM categories ORDER BY createdAt, id"),
      insightCategories: await db().getAllAsync<InsightCategory>("SELECT * FROM insight_categories ORDER BY insightId, categoryId"),
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
      await db().runAsync("DELETE FROM insight_categories");
      await db().runAsync("DELETE FROM categories");
      await db().runAsync("DELETE FROM events");
      await db().runAsync("DELETE FROM insights");
      for (const insight of contents.insights) {
        const imagePath = insight.imagePath === null ? null : imagePaths[insight.id];
        if (imagePath === undefined) throw new Error("A restored photo is missing.");
        await db().runAsync(
          "INSERT INTO insights (id, content, context, imagePath, imageMime, status, createdAt, updatedAt, source, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          insight.id, insight.content, insight.context, imagePath, insight.imageMime, insight.status, insight.createdAt, insight.updatedAt,
          insight.source ?? null, insight.favorite ?? 0,
        );
      }
      for (const event of contents.events) {
        await insertEvent({ ...event, notificationId: null, notificationPlannedFor: null });
      }
      for (const category of contents.categories ?? []) {
        await db().runAsync("INSERT INTO categories (id, name, createdAt) VALUES (?, ?, ?)", category.id, category.name, category.createdAt);
      }
      for (const link of contents.insightCategories ?? []) {
        await db().runAsync("INSERT INTO insight_categories (insightId, categoryId) VALUES (?, ?)", link.insightId, link.categoryId);
      }
      for (const reflection of contents.reflections) {
        await db().runAsync("INSERT INTO reflections (id, insightId, eventId, content, createdAt) VALUES (?, ?, ?, ?, ?)",
          reflection.id, reflection.insightId, reflection.eventId, reflection.content, reflection.createdAt);
      }
      await saveSettings({ ...contents.settings, onboardingComplete: true });
      await track("backup_restored");
    });
  }

  async function recordBackupVerified(summary: BackupSummary): Promise<void> {
    const value = JSON.stringify({ ...summary, verifiedAt: now().toISOString() });
    await db().runAsync("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", LAST_VERIFIED_KEY, value);
    await track("backup_verified");
  }

  async function getBackupStatus(): Promise<BackupStatus> {
    const created = await db().getFirstAsync<{ name: string; createdAt: string }>(
      "SELECT name, createdAt FROM analytics WHERE name IN ('backup_created', 'backup_created_incomplete') ORDER BY createdAt DESC LIMIT 1",
    );
    const verified = await db().getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", LAST_VERIFIED_KEY);
    let lastVerified: BackupStatus["lastVerified"] = null;
    try { lastVerified = verified ? JSON.parse(verified.value) : null; } catch { lastVerified = null; }
    return {
      lastCreatedAt: created?.createdAt ?? null,
      lastCreatedComplete: created ? created.name === "backup_created" : null,
      lastVerified,
    };
  }

  return {
    exportRows, replaceAllRows, recordBackupVerified, getBackupStatus,
    listCategories, createCategory, renameCategory, deleteCategory, setInsightCategories, setFavorite,
    track, getSettings, saveSettings, insertInsight, countInsights, listInsights, getInsight, getEvent,
    getDetail, selectToday, markShown, markOpened, markCompleted, respondToEvent, setInsightStatus, snoozeInsight,
    editInsight, deleteInsightRow, markValueFeedbackAsked, saveValueFeedback, getShownCount, getBetaMetrics,
    notificationCandidates, clearFutureNotificationPlans, setNotificationPlan,
  };
}
