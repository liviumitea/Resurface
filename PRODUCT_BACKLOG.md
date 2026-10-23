# Resurface product backlog

Jira-ready draft, 23 October 2026. [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) defines the initial scope. The existing app implements the P0 UI and local-first model; this backlog distinguishes completed code from unverified behavior. Do not mark an item done solely because a screen exists.

Priority: **P0** before external beta, **P1** for a durable and useful v1, **P2** after beta evidence. Create one Jira epic per section and one child story/task per numbered item. Each item below includes its acceptance gate.

Jira epics: [core loop](https://alexadima.atlassian.net/browse/SCRUM-23), [data safety](https://alexadima.atlassian.net/browse/SCRUM-25), [resurfacing](https://alexadima.atlassian.net/browse/SCRUM-24), [capture](https://alexadima.atlassian.net/browse/SCRUM-28), [pilot/release](https://alexadima.atlassian.net/browse/SCRUM-27), and [optional sync](https://alexadima.atlassian.net/browse/SCRUM-26). Their 22 planned child tasks are SCRUM-29 through SCRUM-50; [SCRUM-51](https://alexadima.atlassian.net/browse/SCRUM-51) tracks a reflection-note bug found during implementation. Existing architecture decisions remain in SCRUM-21 and SCRUM-22; they were not duplicated.

## Epic 1 — Reliable core loop (P0)

1. **Make local iOS and Android builds reproducible.** Fix the Expo-generated iOS script failure when the checkout path contains spaces; document and automate clean native regeneration. Gate: `npm run ios` works from `Proiect Alexandra`, Android builds from a clean checkout, and CI checks TypeScript, tests, and JS exports.
2. **Automate the lifecycle rules.** Use a controllable clock and database-level tests for save → due → Today selection → shown → response → next due, including daily cap, overdue order, local-day boundaries, daylight-saving changes, pause/archive/resume, and app restart. Gate: every rule in README has a passing automated test against the same queries/schema used by the app.
3. **Complete device acceptance on iOS and Android.** Run first-save onboarding, text/photo/OCR capture, search/edit/delete, all three reflection responses, app restart, and denied permissions on physical devices. Gate: recorded pass/fail results with OS/device versions; no P0 failures remain.
4. **Harden error and loading states.** Recover from permissions, OCR, storage, and notification errors without silent data loss or a stuck screen. Gate: each recoverable failure has a clear retry/fallback; fatal key/database failure never silently resets data.
5. **Accessibility and localization readiness.** Check VoiceOver/TalkBack order, labels, dynamic text, touch targets, contrast, keyboard use, and date/time formatting. Gate: the complete core loop is usable with screen readers and larger text.

## Epic 2 — Data durability and privacy (P0)

6. **Encrypted export.** Export insights, reflections, events, settings, and encrypted photos in a versioned, password-protected archive. Gate: no personal plaintext is left in shared or temporary files; export content and version are verified before presenting the share sheet.
7. **Safe restore.** Import an archive into a staging area, authenticate and validate it, then commit atomically; show merge/replace consequences before changing existing data. Gate: wrong password, corrupt archive, duplicate IDs, and interrupted restore leave current data intact; a fresh installation restores images and history.
8. **Platform backup/key-loss review.** Verify iOS/Android uninstall, OS backup/restore, keychain/keystore behavior, device migration, and file protection. Gate: tested recovery expectations match onboarding/settings copy; no ciphertext is backed up without a recoverable key strategy.
9. **Privacy and deletion audit.** Inspect picker/OCR/cache copies, logs, notifications, analytics, and permanent deletion. Gate: no personal content leaves the device without explicit export; residual local copies and OS limitations are documented.

## Epic 3 — Resurfacing and notifications (P0/P1)

10. **Notification reliability (P0).** Test scheduling, deep links, permission changes, foreground/background/terminated launches, time-zone and daylight-saving changes, edit/pause/archive/delete, and long absences. Gate: the app-only Today path always works; notifications do not duplicate, leak private text by default, or target removed insights.
11. **Timed pause and snooze (P1).** Let a user defer an insight until a chosen date without treating the deferral as a positive response. Gate: one pending event remains, history is preserved, and the reminder queue reconciles correctly.
12. **Richer reminder controls (P1).** Add day/time window and quiet-period controls only after observing beta needs. Gate: settings remain understandable and do not promise exact OS delivery times.

## Epic 4 — Easier capture and retrieval (P1)

13. **Share Sheet capture.** Accept text, links, and images from other apps on both platforms. Gate: shared content opens an editable draft, explicit Save is required, and cancellation leaves no persisted insight.
14. **Source attribution and favorites.** Add optional source metadata and a favorite flag with search/filter support. Gate: existing records migrate safely; neither field is required for capture.
15. **OCR quality and fallback.** Test English/Romanian images, rotated/cropped images, poor light, and image-only fallback. Gate: editable OCR never replaces the original image and failures do not discard the draft.
16. **Library/history polish.** Improve empty states, search performance, image display, chronology, and reflection editing if pilot feedback supports it. Gate: migrated data and all lifecycle history remain accurate.

## Epic 5 — Pilot, measurement, and release (P0/P1)

17. **Privacy-safe beta measurement (P0).** Define activation, shown, answer rate, and worth rate from content-free events; keep the denominator visible and document limitations. Gate: no insight/photo/reflection content is logged or transmitted; metrics match fixture data.
18. **Pilot feedback and decision gate (P0).** Test with reflective users from the target persona; collect qualitative examples of usefulness and failure. Gate: a written go/no-go decision cites usage plus interviews, without claiming behavioral change from taps alone.
19. **Signed beta distribution (P0).** Configure bundle IDs, signing, store metadata, privacy disclosures, crash reporting without personal content, and TestFlight/Play internal testing. Gate: install/update on physical devices, verify encrypted data survives update, and document rollback.
20. **Dependency/security maintenance (P1).** Review compatible Expo/native updates and advisories, then upgrade with native regression tests. Gate: no forced framework downgrade, and build/test results are recorded.

## Epic 6 — Optional cross-device future (P2, discovery first)

21. **Sync architecture decision.** Validate whether users need multi-device access after export/restore and pilot feedback. Compare device-only, user-controlled backup, and end-to-end encrypted sync. Gate: threat model, recovery design, cost, privacy obligations, and user value are agreed before backend work.
22. **End-to-end encrypted sync (conditional).** Only if item 21 is approved: build accounts, device enrollment, encrypted records/blobs, conflict resolution, key recovery, and deletion semantics. Gate: the server cannot read personal content; cross-device and lost-device recovery are tested. No backend is needed for the current device-only beta.

Out of scope until evidence changes the decision: generated advice, automatic insight extraction/tagging, social features, streaks, goals, mood tracking, and adaptive schedules.

## Product Spec v0.2 traceability notes

- The P0 `+` capture-type selector (Write / Take photo / Choose photo / Cancel) was added after auditing the spec on 23 October 2026. The full capture flow still needs device acceptance in SCRUM-31.
- Today loading skeleton and recoverable retry state are still open under SCRUM-33; the current app has an initial loading screen and a fatal storage-protection screen, not the complete specified state set.
- The spec's Account/Sign out/Delete account items are conditional on authentication. The current device-only beta has no account or backend; SCRUM-22 should record that architecture decision before account work is planned.
- The spec calls reminders “push”; the current implementation uses local notifications. SCRUM-38 covers delivery, privacy, and deep-link acceptance on real devices.
