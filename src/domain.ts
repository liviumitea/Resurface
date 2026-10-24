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
};

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

export function nextNotificationDate(dueAt: string, clock: Date, time: string): Date {
  const [hour = 9, minute = 0] = time.split(":").map(Number);
  const due = new Date(dueAt);
  const date = new Date(Math.max(due.getTime(), clock.getTime()));
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= clock.getTime() + 30_000 || date.getTime() < due.getTime()) {
    date.setDate(date.getDate() + 1);
  }
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
  settings: Pick<Settings, "notificationTime" | "showInsightText">,
  clock: Date,
  texts: NotificationTexts = ENGLISH_NOTIFICATION_TEXTS,
): NotificationPlan[] {
  const usedDays = new Set<string>();
  const plans: NotificationPlan[] = [];
  for (const event of candidates) {
    if (plans.length >= MAX_PLANNED_NOTIFICATIONS) break;
    const when = nextNotificationDate(event.scheduledAt, clock, settings.notificationTime);
    while (usedDays.has(localDay(when))) when.setDate(when.getDate() + 1);
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

export function shouldAskValueFeedback(shownCount: number): boolean {
  return shownCount === 1 || shownCount % 3 === 0;
}
