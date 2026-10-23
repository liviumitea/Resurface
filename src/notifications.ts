import * as Notifications from "expo-notifications";
import { planNotifications, type Settings } from "./domain";
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

  for (const plan of planNotifications(await notificationCandidates(clock), settings, clock)) {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, data: { eventId: plan.eventId, insightId: plan.insightId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.when },
    });
    await setNotificationPlan(plan.eventId, notificationId, plan.when.toISOString());
  }
}

export function notificationEventId(response: Notifications.NotificationResponse): string | null {
  const value = response.notification.request.content.data?.eventId;
  return typeof value === "string" ? value : null;
}
