import * as Notifications from "expo-notifications";
import { localDay, nextNotificationDate, type Settings } from "./domain";
import { clearFutureNotificationPlans, notificationCandidates, setNotificationPlan } from "./storage";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

/**
 * Keep at most one local notification per day and at most 30 planned notifications.
 * A past plan is not rescheduled, so an unopened insight does not spam the user.
 * The app reconciles the queue whenever it starts or personal data/settings change.
 */
export async function reconcileNotifications(settings: Settings, clock = new Date()): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await clearFutureNotificationPlans(clock);
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;

  const usedDays = new Set<string>();
  let scheduled = 0;
  const candidates = await notificationCandidates(clock);
  for (const event of candidates) {
    if (scheduled >= 30) break;
    let when = nextNotificationDate(event.scheduledAt, clock, settings.notificationTime);
    while (usedDays.has(localDay(when))) when.setDate(when.getDate() + 1);
    const eventId = event.id;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: settings.showInsightText ? "Something you wanted to remember" : "Resurface",
        body: settings.showInsightText && event.content
          ? event.content.slice(0, 140)
          : "Something worth remembering is waiting for you.",
        data: { eventId, insightId: event.insightId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    await setNotificationPlan(eventId, notificationId, when.toISOString());
    usedDays.add(localDay(when));
    scheduled += 1;
  }
}

export function notificationEventId(response: Notifications.NotificationResponse): string | null {
  const value = response.notification.request.content.data?.eventId;
  return typeof value === "string" ? value : null;
}
