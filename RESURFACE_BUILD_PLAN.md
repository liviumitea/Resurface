# Resurface: build plan from the Confluence space

Prepared 1 October 2026. This is a synthesis of the 11 content pages in the `resurface` space, with [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) as the leading specification where it differs from earlier pages. It is a plan, not an approval to start implementation.

## Product to build

Resurface helps a reflective person keep their own insights, values, and conclusions accessible over time. The user decides what matters. The app stores an insight, brings it back later, and lets the user decide whether it still resonates. The first release tests whether resurfacing feels useful; it does not claim to change behavior.

The core loop is **capture → time passes → resurface → recognition → reflect → continue**. The home screen is **Today**, not the library. The intended user already saves ideas or reflects on experience and wants access to those ideas at relevant moments, rather than new advice or motivational content.

## Scope for the first beta

| P0 | Expected behavior |
| --- | --- |
| Onboarding | Three short value screens, then first capture; complete only after the first successful save. Preserve interrupted progress. |
| Capture | Text, camera, photo library, and image-to-text. OCR output is editable; keep the original image. Context is optional. No required tags or source. |
| Today | Show due insights within the chosen daily cap. `Reflect` or `Next`; distinguish no insights, nothing due, complete, loading, and error. |
| Resurfacing | Configured schedule `1, 3, 7, 14, 30, 60, 120`; only active insights are eligible. Prefer the most overdue. Do not move a due date merely because daily capacity was reached. |
| Notifications | Ask after the first save. An app-only path must work when permission is denied. One approximate daily notification window, deep link to the relevant insight, privacy setting for lock-screen text. |
| Reflection | `Yes`, `Not right now` (pause until manual resume), `Not anymore` (confirm archive); optional free-text reflection if cheap enough for beta. |
| Library and detail | Active/Paused/Archived filters, newest-first lists, case-insensitive partial search of content and context, original image, history, edit, pause/resume, archive/restore, permanent delete with confirmation. |
| Settings and measurement | Daily cap Light 1 / Standard 3 / More 5; notification time and privacy; content-free usage analytics and occasional `Was this worth resurfacing today?` feedback. |

**P1:** source attribution, favorites, timed pause, export, richer notification controls, and reflection/history polish. **Outside the MVP:** generative AI, automatic insight extraction/tagging, semantic search, social features, streaks, habits, goals, mood, folders/collections, integrations, and adaptive spaced repetition.

The older [MVP](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688130/MVP) and [v0.1 spec](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/557058/MVP+Product+Spec+v0.1) mention `Source` and favorites earlier. Version 0.2 moves them to P1 and specifies Active as the Library's default filter.

## Recommended technical direction

Use **React Native with Expo and TypeScript**, using a development build because the OCR integration may need native code. Keep the MVP's personal data on the device: SQLite for insights, events, reflections, and settings; private app files for images; on-device OCR; and scheduled local notifications. No account or application backend is needed for the device-only beta. If analytics are enabled, transmit only event names and opaque IDs, never insight text, context, reflection text, or images. Keep the domain and storage interfaces separate so encrypted backup/sync can be added later without rewriting the product loop.

This is a recommendation to validate in the first technical spike, not a settled ADR. [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) persists a database across app restarts; [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/) handles camera and library input; [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/) supports scheduling and handling local notifications. Expo [development builds](https://docs.expo.dev/workflow/customizing/) allow native modules. [ML Kit Text Recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2) supports on-device OCR on iOS and Android; the exact Expo bridge and Romanian/English quality need a device proof of concept.

The v0.2 spec calls this a “push” flow. Under device-only storage, it would be **local notifications**, not server push. This distinction matters: the app must schedule and reconcile future notifications on device, and the team must test delivery after restarts, time-zone changes, permission changes, edits, pause/archive/delete, and days without opening the app. A generic private reminder is a possible fallback if reliable insight-specific delivery cannot be achieved in the first beta.

Device-only storage creates a real user-facing trade-off: uninstalling the app or losing the phone may lose personal insights unless a backup or export path is provided. Resolve this before inviting a wider beta. Privacy-sensitive notification text should default to hidden until the user opts in; v0.2 specifies the switch but does not settle its default.

## Core model and engine rules

| Entity | Minimum fields |
| --- | --- |
| `Insight` | ID, content nullable for image-only capture, optional context, original image path, status `active/paused/archived`, created/updated times, schedule position and next due time. |
| `ResurfaceEvent` | ID, insight ID, scheduled time, selected/notified/shown/opened times as distinct facts, response, cancellation state. Keep history when editing, pausing, or archiving. |
| `Reflection` | ID, insight ID, event ID, text, created time. |
| `Settings` | Daily cap, local notification time, notification privacy, permission/onboarding state. |

Maintain one pending resurfacing event per active insight, as proposed in the [Resurface event](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/753666/Resurface+event) page. Selection for a local day should be stable and idempotent: query active insights due at or before now, order by oldest due date, then select up to the user's cap. Unselected items remain due. A card becoming visible in Today marks `shown_at`; sending a notification records `notified_at` separately. The next due time follows the agreed schedule rule and actual exposure rule. Pausing, archiving, restoring, and deleting must reconcile any pending local notification.

Analytics should use separate measures for (a) selected, (b) notification scheduled/delivered if observable, (c) card shown, (d) opened, (e) feedback answered, and (f) feedback positive. The spec's **Worth Resurfacing Rate = Yes / answered** should always be reported beside the **answer rate = answered / shown** to expose response bias. The “Resurface Moment” is qualitative evidence to collect from beta interviews, not an event inferred from a tap.

## Implementation order and completion gates

| Stage | Build | Gate before proceeding |
| --- | --- | --- |
| 0. Decisions and spikes | Record ADRs for mobile stack and device-only architecture. Prove SQLite persistence, image file handling, on-device OCR on iOS/Android, and local notification scheduling/deep linking on real devices. Decide the schedule and non-opened notification behavior below. | A demo on both platforms and written decisions. |
| 1. Product loop | Onboarding, text capture, local persistence, configurable deterministic engine, Today, `Next`, lifecycle responses, and basic value feedback. Add a clock-injection harness to simulate days passing. | A tester can save an insight, advance time, see it in Today, respond, and see an accurate event history. |
| 2. Personal library | Detail, chronological history, edit, filters, search, pause/resume, archive/restore, delete, and appropriate empty/error states. | State transitions preserve history and never surface a paused, archived, or deleted insight. |
| 3. Rich capture | Camera/library input, private image storage, image-only capture, OCR edit and retry/fallback. | The original survives OCR failure and appears in detail; no personal content leaves the device. |
| 4. Notifications and settings | Permission after first save, local notification queue/reconciliation, privacy mode, deep links, daily caps and time. | Test on iOS and Android with app backgrounded/terminated, permission denied, changed time zone, and insight deletion. Today still works without notification permission. |
| 5. Beta measurement | Content-free event instrumentation, occasional value question, privacy review, accessibility, crash/error monitoring without personal content, pilot feedback. | Every v0.2 P0 acceptance flow is exercised; report activation, resurfacing exposure, answer rate, worth rate, and qualitative feedback. |

For beta validation, recruit people matching the [target persona](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/360467/Target+user+persona). First check that they voluntarily save meaningful insights and return to them. Then ask whether resurfacing felt useful and whether the insight came to mind later. Avoid claiming behavioral change from the first beta's self-report data.

## Decisions to make before scheduling code is finalized

1. **Meaning of `1, 3, 7...`:** Are these cumulative days from save (day 1, 3, 7) or successive gaps (+1, +3, +7 from actual exposure)? The [MVP](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688130/MVP) reads like cumulative days; [v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) calls them intervals computed from `shown_at`; the [event example](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/753666/Resurface+event) goes from Sep 13 to Sep 15. The implementation needs one definition and example dates.
2. **Unopened notifications:** V0.2 defines `shown` as a Today card becoming visible and starts the next interval from `shown_at`. V0.1 says the schedule continues if the user does not open an insight, without bombarding them. Choose whether notification delivery itself counts as exposure, whether the event remains due, and how many reminders are permitted.
3. **Device-only data durability:** Decide whether export/backup must move from P1 to P0 for the beta, and state the data-loss trade-off plainly in onboarding/settings.
4. **Notification privacy default and delivery:** Choose hidden text by default or explicit opt-in to display personal content. Decide how a local notification targets a specific insight while respecting the daily cap and long periods without opening the app.
5. **Schedule tail and lifecycle restart:** Decide what follows day 120, and which schedule position is used after pause/resume or archive/restore.
6. **Beta measurement:** Set the cadence of the worth question, the success threshold, and the method for measuring later recall. Decide whether optional free-text reflections are P0.

## Source map

| Page | Contribution |
| --- | --- |
| [Overview](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/overview) | Space home and recent pages; mostly template text. |
| [Flow definition of the product](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/98551/Flow+definition+of+the+product) | Narrative sequence: problem, importance, promise, mechanism, science. |
| [Target user persona](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/360467/Target+user+persona) | Intentional, reflective user and current habits. |
| [Why Does It Matter?](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/196610/Why+Does+It+Matter) | Why inaccessible insights have limited influence. |
| [Value preposition](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/229523/Value+preposition) | User-chosen insights, no advice or new information. |
| [Mechanism / How It Works](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/65821/Mechanism+How+It+Works) | Repeated retrieval, reflection, and careful behavioral claim. |
| [Problem statement](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/65841/Problem+statement) | Detailed problem and psychological framing. |
| [Fundamnetul stiintific](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/393217/Fundamnetul+stiintific) | Scientific rationale; hypotheses, not proof of this app's effect. |
| [MVP](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688130/MVP) | Loop, exclusions, early schedule and validation hypotheses. |
| [MVP Product Spec v0.1](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/557058/MVP+Product+Spec+v0.1) | First detailed screens, entities, frequency settings. |
| [Resurface event](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/753666/Resurface+event) | One insight, many exposure events; one pending event. |
| [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) | Leading P0/P1 scope, acceptance criteria, privacy proposal, open decisions. |

The visible space tree contained one `Resurface` folder, eight top-level pages, and three pages under `MVP`; the overview showed no blog posts. No external links or general comments appeared in v0.2. This document summarizes the content rather than copying it verbatim.
