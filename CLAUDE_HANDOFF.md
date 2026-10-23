# Resurface — continuation handoff

Updated 23 October 2026 (evening). This file is the durable handoff for the next coding assistant. Read this, then `README.md`, `PRODUCT_BACKLOG.md`, the current code, and the linked product spec before changing behavior. Do not infer that an implemented screen or a successful compile is a tested product.

## Mission and sources of truth

Build Resurface into a safe, useful iOS/Android product: a person captures their own insight, sees it resurface later, and reflects on whether it still resonates. This is not an AI advice, habit, or social app. The current target is a device-only beta; a backend and account system are **not** part of this release. Preserve user privacy and durability while completing the core loop.

- Repository: <https://github.com/liviumitea/Resurface>, branch `main`. CI (`.github/workflows/ci.yml`) runs typecheck, tests, iOS/Android JS exports, and a clean native Android debug build on every push.
- Leading [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) and [Confluence space](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/overview). Where older MVP/v0.1 pages differ, prefer v0.2 and record any deliberate exception.
- [Jira SCRUM board](https://alexadima.atlassian.net/jira/software/projects/SCRUM/boards/1?filter=&groupBy=none). Issue-by-issue acceptance gates and their current status are in `PRODUCT_BACKLOG.md`. The Jira site is `alexadima.atlassian.net`; never use the unrelated `tieto.atlassian.net` connection. Claude Code's Atlassian connector only reaches tieto, so Jira updates in Claude sessions go through Codex (`--model gpt-5.6-sol`; the configured default `gpt-6-sol` is rejected for this ChatGPT account).
- Architecture decisions: [SCRUM-21](https://alexadima.atlassian.net/browse/SCRUM-21), [SCRUM-22](https://alexadima.atlassian.net/browse/SCRUM-22). Epics SCRUM-23..28; child issues SCRUM-29..50; reflection-note regression [SCRUM-51](https://alexadima.atlassian.net/browse/SCRUM-51).

`RESURFACE_BUILD_PLAN.md` is historical planning context, not an acceptance report.

## Code map

Expo SDK 57 / React Native 0.86 / TypeScript, version 0.1.0.

- `App.tsx` — navigation and screens, backup/restore panel (an in-screen overlay, not a native Modal), app-switcher `PrivacyCover`.
- `src/domain.ts` — models and pure rules: scheduling, notification planning, stale-notification dismissal.
- `src/store.ts` — every persistence/lifecycle rule over an injected database, ID generator and clock (Expo-free, so tests run it directly).
- `src/storage.ts` — opens SQLCipher, owns keys, binds the store; backup file creation/restore; `StorageError` reasons; key-loss `setAsideUnreadableData()`.
- `src/backup.ts` — v1 archive: scrypt (N=2^15, r=8, p=1) + AES-256-GCM via pinned `@noble/*` 2.4.0, header authenticated, strict validation.
- `src/media.ts` — photo encryption, photo paths resolved by file name, launch-time cache sweep.
- `src/notifications.ts` — local reminder reconciliation. `src/ui.tsx`, `src/theme.ts` — components and palette.
- `tests/` — `domain`, `storage-queries`, `lifecycle` (production store on node:sqlite, Europe/Bucharest DST clock), `backup`, `metrics`; shared `harness.ts`. 37 tests.
- `scripts/prepare-ios.mjs` — works around Expo SDK 57 Xcode scripts mishandling the space in `Proiect Alexandra`.

## Decisions in force (do not silently change)

- Scheduling: gaps 1, 3, 7, 14, 30, 60, 120 successive calendar days, 120 repeats; each gap starts when a card is actually shown; one pending event per active insight; Today oldest-overdue-first, stable per local day, cap 1/3/5; skipped items stay due; pause/archive cancel, resume/restore restart at stage 0. Snooze (1 week / 1 month / 3 months) replaces the pending event at the same stage and is not a response.
- Notifications are local, generic by default, ≤30 planned, ≤1 per day; delivered ones are dismissed when their insight is seen/paused/archived/deleted or insight text is turned off.
- Backup: password-protected, replace-only restore with an explicit warning; a forgotten backup password cannot be recovered. The password step is kept strong (~10 s under Hermes) and the UI says so.
- Key loss: never reset silently. If the key is missing or the DB won't open, offer "Start fresh and restore a backup", which moves data and keys aside under a dated name (nothing deleted). Refused while the keychain is only locked. Onboarding offers "Restore from a backup".
- Privacy: Android `allowBackup` off; picker/manipulator/document-picker caches and stray backup files cleared at launch; app-switcher cover on iOS (Android would need FLAG_SECURE). Counters are content-free.
- Activation = an insight saved and a resurfacing seen (counters survive deletion). Provisional pilot thresholds are in the backlog, to confirm with the pilot.

## What has and has not been verified

Automated: typecheck, 37 tests, iOS/Android JS exports, CI native Android build — all passing at the latest commit.

iOS 27 simulator (iPhone 18 Pro), Release build, 23 Oct 2026: Today/Library/Settings at normal and largest accessibility text; `+` chooser and text capture; create backup → share sheet with Save to Files → saved file decrypts on the Mac; wrong password refused; replace restore removed a newer insight and kept history; snooze moved the next date; app-switcher snapshot shows only the wordmark; after a simulator keychain reset the app refused to reset data, Start fresh moved everything aside, and restore from onboarding brought the insight back.

Not verified: any physical device; Android beyond CI build (no Android device available to the owner); restore of a backup containing photos; VoiceOver/TalkBack walk-through; notification delivery, deep links and long absences; OCR quality; signed TestFlight/Play builds; real iOS device backup/migration. `npm audit` advisories are in the Expo/RN tree — do **not** run `npm audit fix --force` (it downgrades the framework).

## Working notes

- The shell's default Node is 18; use `~/.nvm/versions/node/v24.14.1/bin` for `npm test` and Expo commands.
- In **development** builds, the Expo dev menu's floating Tools window can become key and tear down the iOS share sheet, and it swallows AXe taps. Test sharing and drive UI automation in **Release** builds: `npm run ios -- --configuration Release --device <udid> --no-bundler` (the trailing "openurl … code 60" error is harmless). The simulator currently has a Release build installed; rebuild with `npm run ios` for day-to-day development.
- UI automation: AXe (`brew install cameroncooke/axe/axe`) can tap app UI with `--tap-style physical` but cannot reach system UI (share sheet, file/photo pickers). App-switcher snapshots can be inspected under the app container's `Library/SplashBoard/Snapshots/sceneID:*` and converted with `sips`.
- React Native 0.77+ no longer streams `console.log` to Metro.
- iOS may move the app's data container on reinstall; photo paths are resolved by file name for that reason.
- `ios/`, `android/`, `.expo/`, `node_modules/` are gitignored; `prebuild --clean` regenerates native folders, so inspect for manual native changes first. Do not wipe user data to make a test pass.

## Suggested next steps

0. **Photo save is very slow (start here).** Measured on the iOS simulator, 23 Oct 2026: `ImageManipulator.manipulateAsync` took 13–115 s on a photo-library pick (HEIC), while size lookup, reading bytes, AES encryption and writing took under 50 ms combined. Photos are now downscaled to a 2048 px long edge (4 MB → ~0.7 MB encrypted), which helps storage and backups but not the speed. Try the newer `ImageManipulator.manipulate(uri).resize(...).renderAsync()` API, or have the picker return compressed JPEG (`quality < 1`), and check a real device before deciding. Backup/restore with photos is still untested; the simulator now holds two photo insights for that test.
1. Physical iPhone acceptance (SCRUM-31): full core loop, notifications/deep links, VoiceOver, backup/restore with photos, app update keeping data. Then close SCRUM-33/51 with evidence.
2. Signed beta distribution (backlog item 19) once an Apple developer account and bundle signing are available.
3. Android device or emulator acceptance when available; add FLAG_SECURE if the app-switcher cover is required there.
4. P1 capture and retrieval (share-sheet capture, source/favorites) only after pilot feedback; sync stays conditional P2 discovery.

When completing work, update the relevant Jira issue with evidence, commit and push, and distinguish automated validation from device acceptance.
