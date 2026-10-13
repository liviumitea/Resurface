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
export type InsightDetail = {
  insight: Insight;
  events: ResurfaceEvent[];
  reflections: Reflection[];
};
export type Settings = {
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

export function shouldAskValueFeedback(shownCount: number): boolean {
  return shownCount === 1 || shownCount % 3 === 0;
}
