import * as Notifications from "expo-notifications";
import { planNotifications, staleNotificationIds, type Settings } from "./domain";
import { genericNotificationBodies, t } from "./i18n";
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
  const candidates = await notificationCandidates(clock);
  await dismissStaleNotifications(new Set(candidates.map((candidate) => candidate.id)), settings);
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;

  const texts = { genericTitle: t("notification.genericTitle"), genericBody: t("notification.genericBody"), personalTitle: t("notification.personalTitle") };
  for (const plan of planNotifications(candidates, settings, clock, texts)) {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, data: { eventId: plan.eventId, insightId: plan.insightId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.when },
    });
    await setNotificationPlan(plan.eventId, notificationId, plan.when.toISOString());
  }
}

/**
 * Removes delivered notifications from the lock screen and Notification Center once they point at
 * something already seen, paused, archived, or deleted, or carry insight text the user turned off.
 */
async function dismissStaleNotifications(pendingEventIds: Set<string>, settings: Settings): Promise<void> {
  const presented = (await Notifications.getPresentedNotificationsAsync()).map(({ request }) => ({
    identifier: request.identifier,
    eventId: typeof request.content.data?.eventId === "string" ? request.content.data.eventId : null,
    body: request.content.body,
  }));
  for (const identifier of staleNotificationIds(presented, pendingEventIds, settings.showInsightText, genericNotificationBodies())) {
    await Notifications.dismissNotificationAsync(identifier);
  }
}

export function notificationEventId(response: Notifications.NotificationResponse): string | null {
  const value = response.notification.request.content.data?.eventId;
  return typeof value === "string" ? value : null;
}
