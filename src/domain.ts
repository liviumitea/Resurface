export type InsightStatus = "active" | "paused" | "archived";
export type Insight = {
  id: string;
  content: string | null;
  context: string | null;
  imagePath: string | null;
  imageMime: string | null;
  status: InsightStatus;
  createdAt: string;
  updatedAt: string;
  /** Optional, free-text origin (a book, a person, a link). Schema 3. */
  source: string | null;
  /** 1 when the user starred it. Stored as an SQLite integer. Schema 3. */
  favorite: 0 | 1;
};
export const MAX_SOURCE_LENGTH = 200;

export type ResurfaceResponse = "yes" | "not_now" | "not_anymore" | null;
export type ResurfaceEvent = {
  id: string;
  insightId: string;
  stage: number;
  scheduledAt: string;
  selectedDay: string | null;
  selectedAt: string | null;
  notificationId: string | null;
  notificationPlannedFor: string | null;
  shownAt: string | null;
  completedAt: string | null;
  openedAt: string | null;
  response: ResurfaceResponse;
  valueFeedback: "yes" | "not_really" | null;
  cancelledAt: string | null;
};

export type TodayItem = { insight: Insight; event: ResurfaceEvent };

export type LibrarySort = "newest" | "oldest" | "resurfaced";
/** A Library row: the insight plus how often and when it last resurfaced. */
export type LibraryItem = Insight & { timesShown: number; lastShownAt: string | null };
export type Reflection = {
  id: string;
  insightId: string;
  eventId: string;
  content: string;
  createdAt: string;
};
/** A user-made label for organizing insights; never assigned automatically. */
export type Category = { id: string; name: string; createdAt: string };
export type CategoryWithCount = Category & { insights: number };
export type InsightCategory = { insightId: string; categoryId: string };
export const MAX_CATEGORY_NAME_LENGTH = 40;

export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type InsightDetail = {
  insight: Insight;
  events: ResurfaceEvent[];
  reflections: Reflection[];
  categories: Category[];
};
export type Settings = {
  /** "system" follows the device language (Romanian or English); user content is never translated. */
  language: "system" | "en" | "ro";
  dailyCap: 1 | 3 | 5;
  notificationTime: string;
  /** Weekdays (0 = Sunday … 6 = Saturday) with no reminders. Opt-in; empty by default. */
  quietDays: number[];
  showInsightText: boolean;
  onboardingStep: number;
  onboardingComplete: boolean;
  permissionAsked: boolean;
};

/** Gaps after an actual viewing. Stage 0 is the first viewing after saving. */
export const RESURFACE_GAPS_DAYS = [1, 3, 7, 14, 30, 60, 120] as const;

export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function dueForStage(from: Date, stage: number): string {
  const gap = RESURFACE_GAPS_DAYS[Math.min(stage, RESURFACE_GAPS_DAYS.length - 1)];
  return addCalendarDays(from, gap ?? 120).toISOString();
}

export function isValidInsight(content: string | null, hasImage: boolean): boolean {
  return Boolean(content?.trim()) || hasImage;
}

/**
 * Valid quiet weekdays, sorted and without duplicates. All seven would mean no reminders at all,
 * which is what turning notifications off is for, so that is treated as none.
 */
export function normalizeQuietDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = [...new Set(value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return days.length >= 7 ? [] : days;
}

export function nextNotificationDate(dueAt: string, clock: Date, time: string, quietDays: readonly number[] = []): Date {
  const due = new Date(dueAt);
  const date = atTime(new Date(Math.max(due.getTime(), clock.getTime())), time);
  if (date.getTime() <= clock.getTime() + 30_000 || date.getTime() < due.getTime()) nextDayAt(date, time);
  return skipQuietDays(date, time, normalizeQuietDays(quietDays));
}

/** Sets the local time of day. A time skipped by a daylight-saving change lands an hour later. */
function atTime(date: Date, time: string): Date {
  const [hour = 9, minute = 0] = time.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** The next calendar day at the chosen time, re-applied so a daylight-saving shift never carries over. */
function nextDayAt(date: Date, time: string): Date {
  date.setDate(date.getDate() + 1);
  return atTime(date, time);
}

function skipQuietDays(date: Date, time: string, quietDays: readonly number[]): Date {
  for (let step = 0; step < 7 && quietDays.includes(date.getDay()); step++) nextDayAt(date, time);
  return date;
}

export const MAX_PLANNED_NOTIFICATIONS = 30;
export const GENERIC_NOTIFICATION = { title: "Resurface", body: "Something worth remembering is waiting for you." } as const;

export type NotificationPlan = { eventId: string; insightId: string; when: Date; title: string; body: string };
export type NotificationTexts = { genericTitle: string; genericBody: string; personalTitle: string };
const ENGLISH_NOTIFICATION_TEXTS: NotificationTexts = {
  genericTitle: GENERIC_NOTIFICATION.title, genericBody: GENERIC_NOTIFICATION.body, personalTitle: "Something you wanted to remember",
};

/**
 * Plans at most one local notification per local day and at most 30 in total, oldest due first.
 * Insight text appears only when the user opted in; otherwise the message is generic.
 */
export function planNotifications(
  candidates: { id: string; insightId: string; scheduledAt: string; content: string | null }[],
  settings: Pick<Settings, "notificationTime" | "showInsightText"> & Partial<Pick<Settings, "quietDays">>,
  clock: Date,
  texts: NotificationTexts = ENGLISH_NOTIFICATION_TEXTS,
): NotificationPlan[] {
  const usedDays = new Set<string>();
  const plans: NotificationPlan[] = [];
  for (const event of candidates) {
    if (plans.length >= MAX_PLANNED_NOTIFICATIONS) break;
    const quietDays = normalizeQuietDays(settings.quietDays);
    const when = nextNotificationDate(event.scheduledAt, clock, settings.notificationTime, quietDays);
    while (usedDays.has(localDay(when))) skipQuietDays(nextDayAt(when, settings.notificationTime), settings.notificationTime, quietDays);
    usedDays.add(localDay(when));
    const personal = settings.showInsightText && event.content;
    plans.push({
      eventId: event.id,
      insightId: event.insightId,
      when,
      title: settings.showInsightText ? texts.personalTitle : texts.genericTitle,
      body: personal ? event.content!.slice(0, 140) : texts.genericBody,
    });
  }
  return plans;
}

export type PresentedNotification = { identifier: string; eventId: string | null; body: string | null };

/**
 * Delivered notifications to remove from the lock screen and Notification Center: those not tied
 * to a still-pending event (already seen, paused, archived, or deleted) and any showing insight
 * text after the user turned that option off.
 */
export function staleNotificationIds(
  presented: PresentedNotification[],
  pendingEventIds: Set<string>,
  showInsightText: boolean,
  genericBodies: ReadonlySet<string> = new Set([GENERIC_NOTIFICATION.body]),
): string[] {
  return presented
    .filter(({ eventId, body }) => !eventId || !pendingEventIds.has(eventId) || (!showInsightText && !genericBodies.has(body ?? "")))
    .map(({ identifier }) => identifier);
}

export type SharedItem = { shareType: string; value: string; mimeType?: string };
export type SharedDraft = { content: string; source: string | null; imageUri: string | null };

const SINGLE_URL = /^https?:\/\/\S+$/i;

const isSharedImage = (item: SharedItem) =>
  item.shareType === "image" || (item.shareType === "file" && (item.mimeType ?? "").toLowerCase().startsWith("image/"));

/**
 * Turns content shared from another app into an editable capture draft. A lone link becomes the
 * source so the user writes the insight in their own words; other text becomes the insight text;
 * the first photo is attached (one per insight). Videos and other files are ignored. Returns null
 * when nothing usable was shared.
 */
export function draftFromShared(items: SharedItem[]): SharedDraft | null {
  const texts: string[] = [];
  let source: string | null = null;
  let imageUri: string | null = null;
  for (const item of items) {
    const value = item.value?.trim() ?? "";
    if (!value) continue;
    if (isSharedImage(item)) { imageUri ??= value; continue; }
    if (item.shareType === "url" || (item.shareType === "text" && SINGLE_URL.test(value))) {
      if (!source) source = value.slice(0, MAX_SOURCE_LENGTH); else texts.push(value);
    } else if (item.shareType === "text") texts.push(value);
  }
  if (!texts.length && !source && !imageUri) return null;
  return { content: texts.join("\n\n"), source, imageUri };
}

export function shouldAskValueFeedback(shownCount: number): boolean {
  return shownCount === 1 || shownCount % 3 === 0;
}
