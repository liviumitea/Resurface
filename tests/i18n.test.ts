import assert from "node:assert/strict";
import test from "node:test";
import { GENERIC_NOTIFICATION, planNotifications, staleNotificationIds } from "../src/domain";
import {
  MESSAGES_FOR_TESTS, formatDate, formatDateTime, genericNotificationBodies, pluralCategory, t, type MessageKey,
} from "../src/i18n";

const placeholders = (message: unknown): string[] => {
  const text = typeof message === "string" ? message : Object.values(message as Record<string, string>).join(" ");
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
};

test("English and Romanian have the same keys and the same placeholders", () => {
  const { en, ro } = MESSAGES_FOR_TESTS;
  assert.deepEqual(Object.keys(ro).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as MessageKey[]) {
    assert.deepEqual(placeholders(ro[key]), placeholders(en[key]), key);
    assert.equal(typeof ro[key] === "string", typeof en[key] === "string", `${key}: plural shape`);
    const value = ro[key];
    if (typeof value !== "string") assert.ok(value.few, `${key}: Romanian needs a "few" form`);
  }
});

test("plural rules: English one/other; Romanian one/few/other", () => {
  assert.deepEqual([0, 1, 2, 5].map((n) => pluralCategory(n, "en")), ["other", "one", "other", "other"]);
  assert.deepEqual([0, 1, 2, 19, 20, 21, 100, 101, 119, 120].map((n) => pluralCategory(n, "ro")),
    ["few", "one", "few", "few", "other", "other", "other", "few", "few", "other"]);
  assert.equal(t("category.count", { count: 1 }, "ro"), "1 idee");
  assert.equal(t("category.count", { count: 3 }, "ro"), "3 idei");
  assert.equal(t("category.count", { count: 20 }, "ro"), "20 de idei");
  assert.equal(t("category.count", { count: 2 }, "en"), "2 insights");
});

test("parameters are filled and unknown placeholders are left visible", () => {
  assert.equal(t("today.position", { index: 2, total: 3 }, "ro"), "2 din 3");
  assert.equal(t("today.position", { index: 2 }, "en"), "2 of {total}");
});

test("dates follow the language, with a 24-hour clock in Romanian", () => {
  const value = new Date(Date.UTC(2026, 9, 24, 15, 5));
  assert.match(formatDate(value, "ro"), /24 oct\.? 2026/);
  assert.match(formatDate(value, "en"), /24 Oct 2026/);
  assert.match(formatDateTime(value, "ro"), /\d{2}:05/);
  assert.doesNotMatch(formatDateTime(value, "ro"), /PM|AM/);
});

test("notifications use the chosen language and stale checks recognise every generic text", () => {
  const roTexts = { genericTitle: t("notification.genericTitle", {}, "ro"), genericBody: t("notification.genericBody", {}, "ro"), personalTitle: t("notification.personalTitle", {}, "ro") };
  const [plan] = planNotifications([{ id: "e", insightId: "i", scheduledAt: new Date(2026, 9, 1, 6).toISOString(), content: "Private" }],
    { notificationTime: "09:00", showInsightText: false }, new Date(2026, 9, 1, 12), roTexts);
  assert.equal(plan!.body, roTexts.genericBody);
  assert.ok(!plan!.body.includes("Private"));

  const bodies = genericNotificationBodies();
  assert.ok(bodies.has(GENERIC_NOTIFICATION.body) && bodies.has(roTexts.genericBody));
  const presented = [
    { identifier: "generic-ro", eventId: "e", body: roTexts.genericBody },
    { identifier: "generic-en", eventId: "e", body: GENERIC_NOTIFICATION.body },
    { identifier: "personal", eventId: "e", body: "Private" },
  ];
  assert.deepEqual(staleNotificationIds(presented, new Set(["e"]), false, bodies), ["personal"],
    "generic texts in either language are not mistaken for personal ones");
});
