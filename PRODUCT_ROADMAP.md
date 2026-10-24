# Resurface — current review and feature-first roadmap

Reviewed 24 October 2026 against repository `main` through `af5b31c`, [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2), and the [SCRUM board](https://alexadima.atlassian.net/jira/software/projects/SCRUM/boards/1?filter=&groupBy=none). This is the working plan; [PRODUCT_BACKLOG.md](PRODUCT_BACKLOG.md) has issue-level acceptance gates and [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) has implementation notes.

## Current position

Resurface is a local-first Expo/React Native beta with no account, backend, or cloud sync. The core loop is implemented: first-save onboarding; text, photo and on-device OCR capture; Today and reflections; Library, insight detail/history and lifecycle controls; snooze and local reminders. Data is held in SQLCipher and encrypted photo files. Password-protected export, replace-only restore, a truthful backup checkup, and read-only backup verification are implemented.

The 24 October feature wave added append-only database migrations (schema 3), same-day revisit/reflection, optional multiple categories, English/Romanian localization, optional sources and favorites, and compatible Expo SDK 57 dependency patches. Category data uses backup archive v2; source/favorite data uses v3; older v1/v2 archives still restore. TypeScript and **70 automated tests passed locally on 24 October**. The iOS 27 simulator Release build has been used for targeted checks of the new features. CI runs iOS/Android JavaScript exports and an Android native debug build, but that is not Android runtime acceptance.

This is **not yet a public-release claim**. No physical-device pass is recorded. Android runtime, photo-containing restore in the native app, notification delivery/deep links, OCR quality, screen-reader use, signed distribution, and pilot value remain unverified. Jira still shows many implemented stories as To Do or In Progress; comments and code provide more precise implementation evidence than status alone.

## Decision for this work phase

For now, prioritize feature depth and usability without making physical-device testing the immediate next task. Simulator, automated and build checks can support development; they cannot replace the deferred release gate. Do not mark a Jira issue Done if its acceptance criteria still require device or pilot evidence. Keep the product focused on a person's own insights returning over time: no generated advice, social feed, streaks, mood tracking, or backend by default.

## Next implementation steps

### 1. Make Library and history genuinely useful — next task

Extend [SCRUM-44](https://alexadima.atlassian.net/browse/SCRUM-44) rather than creating another retrieval ticket. The current Library already has status, category and favorite filters plus text/source search, but rows are text-led with only an image icon and a created date. Add useful sort choices (newest saved, oldest saved, recently resurfaced), encrypted-photo previews or a safe fallback, clearer filter/result counts and empty states, and a history view that makes each exposure, response and note easy to scan. Keep filters composable, preserve the current lifecycle semantics, and test ordering, large collections and missing-image behavior. Gate: the user can find an old insight and understand its history quickly in both languages; no plaintext thumbnail is persisted.

### 2. Reduce capture friction

Prototype [SCRUM-41](https://alexadima.atlassian.net/browse/SCRUM-41) in two slices: shared text/links first, then images. Incoming content must open an editable draft, require an explicit Save, and leave no insight or stray plaintext file on cancel. Test cold/warm launch, duplicate intents and permission/failure paths in available simulators/emulators; retain a native-device acceptance item because SDK 57's [incoming sharing is experimental on iOS](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/). If that API proves too brittle, keep manual capture as the reliable path and document the decision.

### 3. Improve photo/OCR feedback without guessing at hardware performance

Use [SCRUM-43](https://alexadima.atlassian.net/browse/SCRUM-43) and [SCRUM-52](https://alexadima.atlassian.net/browse/SCRUM-52). Create a small English/Romanian OCR fixture set (rotated, low-light, text-heavy, no readable text) and exercise editable result, retry, keep-as-image and cancellation. Make decode/OCR/save progress and recoverable failures clear in the UI. Record simulator timings separately; do not declare the HEIC bottleneck fixed or set a device latency target until hardware is measured. Gate for this phase: every fixture has a usable outcome and no failure discards the draft or original photo.

### 4. Add simple, user-controlled reminder timing

Refine [SCRUM-40](https://alexadima.atlassian.net/browse/SCRUM-40) as an opt-in extension: a preferred reminder time or quiet window, with the existing simple default intact. Show that Today works when notifications are off. Test local-day, daylight-saving, time-zone and queue reconciliation rules against the production store; avoid promising exact operating-system delivery. Defer adaptive schedules until pilot evidence asks for them.

### 5. Make the growing app easier to change and review

`App.tsx` now owns most navigation, screens and async flows in one large component. Extract focused screen/flow components and state helpers without changing behavior, keeping storage and scheduling rules in their existing tested modules. Add repeatable simulator smoke scenarios for first save, Library/filter/history, category/source edits, backup verification and restore warnings. Keep English/Romanian strings and accessibility labels in step with every UI change. Gate: typecheck, domain/store/backup tests, JS exports and the available native build remain green, and the same simulator scenarios still work.

### 6. Prepare release operations while features are built

Update user-facing copy, recovery guidance, privacy disclosures and support contact; keep roadmap, README, handoff and Jira aligned with what is implemented versus accepted. [SCRUM-47](https://alexadima.atlassian.net/browse/SCRUM-47) covers signing and TestFlight/Play internal builds when account access is available. Continue compatible dependency review under [SCRUM-48](https://alexadima.atlassian.net/browse/SCRUM-48); do not force a framework downgrade to silence build-tool advisories.

## Deferred gates before calling it a complete release

1. [SCRUM-31](https://alexadima.atlassian.net/browse/SCRUM-31), [SCRUM-35](https://alexadima.atlassian.net/browse/SCRUM-35), [SCRUM-38](https://alexadima.atlassian.net/browse/SCRUM-38) and [SCRUM-52](https://alexadima.atlassian.net/browse/SCRUM-52): physical iPhone and Android passes for the full core loop, photo backup/restore, encrypted update and key-loss behavior, notification delivery/deep links, OCR, accessibility and photo-save latency. Record devices, OS versions, steps and outcomes.
2. Signed internal builds and install/update/rollback checks; privacy/store metadata and a tested support/recovery path. A simulator build is not a substitute.
3. [SCRUM-45](https://alexadima.atlassian.net/browse/SCRUM-45) and [SCRUM-46](https://alexadima.atlassian.net/browse/SCRUM-46): a small target-persona pilot with first-save/core-loop measures and interviews, followed by a written go/no-go decision. Do not infer user benefit from taps alone.

Cross-device accounts and end-to-end encrypted sync remain conditional [discovery](https://alexadima.atlassian.net/browse/SCRUM-49) and [implementation](https://alexadima.atlassian.net/browse/SCRUM-50), not prerequisites for this device-only v1.
