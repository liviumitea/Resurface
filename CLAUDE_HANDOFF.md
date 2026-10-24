# Resurface — continuation handoff

Updated 24 October 2026. This file is the durable handoff for the next coding assistant. Read this, then `README.md`, `PRODUCT_ROADMAP.md` (latest review and priorities), `PRODUCT_BACKLOG.md`, the current code, and the linked product spec before changing behavior. Do not infer that an implemented screen or a successful compile is a tested product.

## Mission and sources of truth

Build Resurface into a safe, useful iOS/Android product: a person captures their own insight, sees it resurface later, and reflects on whether it still resonates. This is not an AI advice, habit, or social app. The current target is a device-only beta; a backend and account system are **not** part of this release. Preserve user privacy and durability while completing the core loop.

- Repository: <https://github.com/liviumitea/Resurface>, branch `main`. CI (`.github/workflows/ci.yml`) runs typecheck, tests, iOS/Android JS exports, and a clean native Android debug build on every push.
- Leading [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) and [Confluence space](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/overview). Where older MVP/v0.1 pages differ, prefer v0.2 and record any deliberate exception.
- [Jira SCRUM board](https://alexadima.atlassian.net/jira/software/projects/SCRUM/boards/1?filter=&groupBy=none). Issue-by-issue acceptance gates and their current status are in `PRODUCT_BACKLOG.md`. The Jira site is `alexadima.atlassian.net`; never use the unrelated `tieto.atlassian.net` connection. Claude Code's Atlassian connector only reaches tieto, so Jira updates in Claude sessions go through Codex (`--model gpt-5.6-sol`; the configured default `gpt-6-sol` is rejected for this ChatGPT account).
- Architecture decisions: [SCRUM-21](https://alexadima.atlassian.net/browse/SCRUM-21), [SCRUM-22](https://alexadima.atlassian.net/browse/SCRUM-22). Epics SCRUM-23..28; child issues SCRUM-29..50; reflection-note regression [SCRUM-51](https://alexadima.atlassian.net/browse/SCRUM-51). The newly planned private-build feature pack is [SCRUM-58](https://alexadima.atlassian.net/browse/SCRUM-58), with children SCRUM-59..66.

`RESURFACE_BUILD_PLAN.md` is historical planning context, not an acceptance report.

## Code map

Expo SDK 57 / React Native 0.86 / TypeScript, version 0.1.0.

- `App.tsx` — app state, navigation and the actions that change data (618 lines after the 24 October split).
- `src/screens/` — screen components taking data and callbacks as props (`TodayScreens`, `CaptureScreens`, `LibraryScreens`, `DetailScreen`, `SettingsScreen`, `OnboardingScreen`), shared pieces and `PrivacyCover` (`components.tsx`), styles, and flow hooks: `useBackup` with the backup sheet (an in-screen overlay, not a native Modal), `useSharedContent` (share extension intake), `useLibrary` (filters that survive leaving Library).
- `modules/resurface-image/` — local iOS-only Expo module: ImageIO photo preparation (2048 px, upright, no metadata). Android uses expo-image-manipulator.
- `src/domain.ts` — models and pure rules: scheduling, notification planning, stale-notification dismissal.
- `src/store.ts` — every persistence/lifecycle rule over an injected database, ID generator and clock (Expo-free, so tests run it directly).
- `src/migrations.ts` — append-only schema migrations on `PRAGMA user_version` (SCRUM-53); `src/storage.ts` runs them on open. Schema 2 adds categories (SCRUM-56), and schema 3 adds source/favorite fields (SCRUM-42).
- `src/storage.ts` — opens SQLCipher, owns keys, binds the store; backup file creation/restore; `StorageError` reasons; key-loss `setAsideUnreadableData()`.
- `src/backup.ts` — versioned v1–v3 archives: scrypt (N=2^15, r=8, p=1) + AES-256-GCM via pinned `@noble/*` 2.4.0, header authenticated, strict validation. Newer archives carry categories and source/favorite fields while older archives remain readable.
- `src/media.ts` — photo preparation and encryption, text recognition wrapper, photo paths resolved by file name, launch-time cache sweep, shared-photo intake from the app-group container (never deletes hidden files there).
- `src/i18n.ts` — English/Romanian UI strings, plural rules, locale dates; every user-visible string goes through `t()` (tests enforce matching keys/placeholders). Native permission strings live in `locales/*.json`.
- `src/notifications.ts` — local reminder reconciliation. `src/ui.tsx`, `src/theme.ts` — components and palette.
- `tests/` — `domain`, `storage-queries`, `lifecycle` (production store on node:sqlite, Europe/Bucharest DST clock), `backup`, `metrics`; shared `harness.ts`. 79 tests as of 24 October (also `migrations`, `categories`, `sources`, `i18n`, `reminders`). `tests/fixtures/ocr/` holds the EN/RO OCR fixture photos and results.
- `scripts/prepare-ios.mjs` — works around Expo SDK 57 Xcode scripts mishandling the space in `Proiect Alexandra`.
- `scripts/smoke-ios.sh` — read-only simulator smoke pass (needs AXe); `scripts/make-ocr-fixtures.swift` / `check-ocr-fixtures.swift` — OCR fixtures and their macOS Vision check.
- `docs/PRIVACY.md`, `docs/SUPPORT.md`, `docs/STORE_PRIVACY.md` — draft privacy notice, help/recovery guide and store privacy answers (EN/RO); the support contact is still a placeholder.

## Decisions in force (do not silently change)

- Scheduling: gaps 1, 3, 7, 14, 30, 60, 120 successive calendar days, 120 repeats; each gap starts when a card is actually shown; one pending event per active insight; Today oldest-overdue-first, stable per local day, cap 1/3/5; skipped items stay due; pause/archive cancel, resume/restore restart at stage 0. Snooze (1 week / 1 month / 3 months) replaces the pending event at the same stage and is not a response.
- Notifications are local, generic by default, ≤30 planned, ≤1 per day, skipping opt-in quiet weekdays (a device preference, not in backups); delivered ones are dismissed when their insight is seen/paused/archived/deleted or insight text is turned off.
- Backup: password-protected, replace-only restore with an explicit warning; a forgotten backup password cannot be recovered. The password step is kept strong (~10 s under Hermes) and the UI says so.
- Key loss: never reset silently. If the key is missing or the DB won't open, offer "Start fresh and restore a backup", which moves data and keys aside under a dated name (nothing deleted). Refused while the keychain is only locked. Onboarding offers "Restore from a backup".
- Privacy: Android `allowBackup` off; picker/manipulator/document-picker caches and stray backup files cleared at launch; app-switcher cover on iOS (Android would need FLAG_SECURE). Counters are content-free.
- First-save activation and first-resurfacing/core-loop completion are separate content-free milestones (both survive deletion). Provisional pilot thresholds are in the backlog, to confirm with the pilot.

## What has and has not been verified

Automated: typecheck and 79 tests passed locally on 24 October (end of day); iOS/Android JS exports and CI native Android build passed in earlier checks but were not rerun for this handoff update.

iOS 27 simulator (iPhone 18 Pro), Release build, 23 Oct 2026: Today/Library/Settings at normal and largest accessibility text; `+` chooser and text capture; create backup → share sheet with Save to Files → saved file decrypts on the Mac; wrong password refused; replace restore removed a newer insight and kept history; snooze moved the next date; app-switcher snapshot shows only the wordmark; after a simulator keychain reset the app refused to reset data, Start fresh moved everything aside, and restore from onboarding brought the insight back.

Not verified: any physical device; Android beyond CI build (no Android device available to the owner); restore of a backup containing photos; VoiceOver/TalkBack walk-through; notification delivery, deep links and long absences; OCR quality; signed TestFlight/Play builds; real iOS device backup/migration. `npm audit` advisories are in the Expo/RN tree — do **not** run `npm audit fix --force` (it downgrades the framework).

## Working notes

- The shell's default Node is 18; use `~/.nvm/versions/node/v24.14.1/bin` for `npm test` and Expo commands.
- In **development** builds, the Expo dev menu's floating Tools window can become key and tear down the iOS share sheet, and it swallows AXe taps. Test sharing and drive UI automation in **Release** builds: `npm run ios -- --configuration Release --device <udid> --no-bundler` (the trailing "openurl … code 60" error is harmless). The simulator currently has a Release build installed; rebuild with `npm run ios` for day-to-day development.
- UI automation: AXe (`brew install cameroncooke/axe/axe`) can tap app UI with `--tap-style physical` but cannot reach system UI (share sheet, file/photo pickers). App-switcher snapshots can be inspected under the app container's `Library/SplashBoard/Snapshots/sceneID:*` and converted with `sips`.
- React Native 0.77+ no longer streams `console.log` to Metro.
- iOS may move the app's data container on reinstall; photo paths are resolved by file name for that reason.
- `ios/`, `android/`, `.expo/`, `node_modules/` are gitignored; `prebuild --clean` regenerates native folders, so inspect for manual native changes first. Do not wipe user data to make a test pass.

## Implemented on 24 October (device-free roadmap work)

Backup fail-closed + restore limits; separate first-save and core-loop metrics; SCRUM-53 versioned migrations (schema now 3); SCRUM-54 "Seen today" revisit; SCRUM-55 backup checkup/verify; SCRUM-56 categories (archive v2); SCRUM-57 English/Romanian localization with a language setting; SCRUM-42 sources and favorites (archive v3); SCRUM-48 dependency review (SDK 57 patches applied; build-tool-only advisories documented). Each was checked on the iOS 27 simulator in a Release build; none has physical-device acceptance. Jira has a comment with evidence on every ticket; no statuses were transitioned.

The owner has chosen a feature-first phase and deferred physical-device testing for now. The original Library/history (SCRUM-44), Share Sheet (SCRUM-41), photo/OCR feedback (SCRUM-43), reminder timing (SCRUM-40), screen extraction and release-documentation steps now have code implementations; see the next section and `PRODUCT_ROADMAP.md`. Device checks (SCRUM-31/35/38/52), signing/account access (SCRUM-47) and pilot evidence (SCRUM-45/46) remain later gates, not completed work. Share-into is experimental in SDK 57, so a simulator prototype is not a shipping decision.

## Implemented later on 24 October (Codex's feature-first roadmap)

- SCRUM-41 share capture: text/links, then one photo (copied out of the app-group container, encrypted only on Save). Simulator-verified from Safari, Photos and Files. A bug that deleted the container's hidden iOS metadata file was found and fixed.
- SCRUM-43/52 photo/OCR feedback: OCR appends instead of replacing typed text; stop/retry/keep-as-image; staged save progress; recoverable save failure. iOS photo preparation moved to the ImageIO module; a synthetic 12 MP HEIC saved in ~2 s on the simulator. That is not a device measurement and does not close SCRUM-52.
- SCRUM-40 reminder timing: time presets and opt-in quiet days; DST and time-zone tests.
- Roadmap step 5: `App.tsx` split into `src/screens/`, smoke script, tab accessibility labels fixed (Jira comment on SCRUM-47).
- Roadmap step 6: privacy notice, support/recovery guide, store privacy answers, in-app Help & recovery section in Settings.

Open owner decisions for a future distribution: the support contact; export-compliance answer; whether iOS keys should stay "this device only" (today they use the default Keychain accessibility, so an encrypted iPhone backup may carry them). See `docs/STORE_PRIVACY.md`. The owner does not want to publish yet, so do not make these the immediate next task.

## Suggested next steps

The previous device-free roadmap steps 1–6 are implemented. The refreshed `PRODUCT_ROADMAP.md` lists the **planned, unimplemented** private-build feature pack under SCRUM-58 in the order agreed with the owner: native photo backup/restore proof and the smoke restore step ([SCRUM-65](https://alexadima.atlassian.net/browse/SCRUM-65)), All-insights Library search with a diacritic-insensitive fix ([SCRUM-61](https://alexadima.atlassian.net/browse/SCRUM-61)), Upcoming ([SCRUM-64](https://alexadima.atlassian.net/browse/SCRUM-64)), reflection notes ([SCRUM-62](https://alexadima.atlassian.net/browse/SCRUM-62), schema 4 + archive version), saved-photo editing ([SCRUM-63](https://alexadima.atlassian.net/browse/SCRUM-63)), then text-first draft recovery ([SCRUM-59](https://alexadima.atlassian.net/browse/SCRUM-59)) and draft photos/share conflicts ([SCRUM-60](https://alexadima.atlassian.net/browse/SCRUM-60)). [SCRUM-66](https://alexadima.atlassian.net/browse/SCRUM-66) covers English/Romanian documentation. These extend Product Spec v0.2. Do not start store publication work; the owner explicitly wants to keep building privately. Do not treat Jira's In Progress status as the code state; the comments carry the evidence. Keep automated, simulator, native-device and pilot evidence distinct in every update.

Photo-performance context for the deferred SCRUM-52 gate: on the simulator, legacy `manipulateAsync` took 13–115 seconds for library HEIC and SDK 57's contextual image-manipulator render still took 88 seconds, while JPEG save and encrypt/write were fast. The simulator may overstate hardware latency. No physical-device measurement exists, and photo-containing restore in the native app remains unverified. Do not claim either is solved because the unit-test archive round trip passes.

When completing work, update the relevant Jira issue with evidence, commit and push, and distinguish automated validation from device acceptance.
