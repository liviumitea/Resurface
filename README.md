# Resurface

For the current state and verification limits, see [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md). For the prioritized improvements and future features, see [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md).

Resurface is a local-first iOS and Android beta for saving personal insights and bringing them back over time. The app implements the product's v0.2 core loop: capture → resurface → reflect → continue.

## What is built

- Three-step onboarding, ending only after the first successful save.
- A `+` capture selector for writing, taking a photo, or choosing a photo, plus incoming Share Sheet drafts for text, links and one photo. On-device OCR produces editable text while retaining the photo; photo-only insights work too.
- A Today queue ordered by oldest due date, with configurable limits of 1, 3, or 5 insights per day; cards seen earlier today can be revisited and reflected on later without a second exposure.
- Reflection responses (`Yes`, `Not right now`, `Not anymore`), optional notes, and occasional value feedback.
- Searchable Library with an All tab across statuses (each row labelled with its status), status, category and favorite filters, sort options and photo thumbnails; search ignores case and accents, so "invata" finds "Învață"; optional sources and multiple categories per insight; detail/history, editing, pause/resume, archive/restore, and permanent deletion.
- Local notification scheduling with optional preferred time and quiet weekdays, a generic lock-screen message by default, and a setting to opt into showing insight text.
- Content-free usage counters stored only on device.
- English and Romanian UI, including a language preference, local dates, plurals and notification text. A user's own content is never translated.
- Password-protected encrypted export and replace-only restore, plus a backup checkup and read-only verification of a chosen archive (still awaiting full physical-device acceptance).

## Architecture and privacy

This beta has no account, backend, or cloud sync. Insight text, reflection history, settings, and analytics live in a **SQLCipher-encrypted SQLite database**. Photos are downscaled to at most 2048 px, normalized to an upright JPEG without location metadata (on iOS by the local ImageIO module in `modules/resurface-image`, on Android by expo-image-manipulator), and stored as **AES-GCM ciphertext** in app-private files. Random encryption keys are held in Expo SecureStore (iOS Keychain / Android Keystore). OCR runs on device using Apple Vision on iOS and ML Kit on Android. The app refuses to open the database if SQLCipher is unavailable, so **Expo Go is not supported**.

Personal content is not uploaded by this app. The image picker and image manipulator may create short-lived plaintext files in the app cache; the app removes the picker/manipulator copies it can identify after saving or discarding them. OS cache and backup behavior should be reviewed on physical devices before a wider launch.

The draft [privacy notice](docs/PRIVACY.md), [help and recovery guide](docs/SUPPORT.md) and [store privacy answers](docs/STORE_PRIVACY.md) describe this for users and reviewers; the support contact in them is still to be filled in.

Password-protected backup and restore are implemented, but have not completed physical-device acceptance, particularly with photos. A backup password cannot be recovered. Uninstalling the app, losing the device or keys, or having an incomplete backup may permanently lose insights. Do not use this beta as the only copy of irreplaceable material. See the [roadmap](PRODUCT_ROADMAP.md) for the backup safety work required before wider distribution.

## Scheduling decisions

- The intervals `1, 3, 7, 14, 30, 60, 120` are successive calendar-day gaps. The first event is due one day after saving; each later gap is measured from when the previous event was actually shown. The 120-day gap repeats thereafter.
- A notification being delivered does not count as seeing an insight. The pending event remains due until its card is shown. A notification already planned in the past is not repeatedly rescheduled, avoiding reminder spam.
- At most 30 future local notifications are planned, with at most one on a given day. The queue is refreshed when the app launches or relevant data/settings change. Long absences, time-zone changes, and OS permission changes therefore need real-device testing; after 30 planned notifications, the app must be reopened to extend the queue.
- Reminder timing is opt-in beyond the default 09:00: a preferred time (typed or chosen from presets) and optional quiet weekdays. A reminder that would fall on a quiet day moves to the next allowed day at the same time; insights that come due still wait in Today, which works with notifications off. Picking all seven days is refused (turning notifications off does that). The time is re-applied on each day, so a daylight-saving change never shifts later reminders; a time skipped by the spring change (e.g. 03:30 in Romania) fires an hour later that day. Delivery times are approximate and decided by the OS. Quiet days, like the language, are a device preference and are not included in backups.
- Pausing or archiving cancels the pending event. Resuming/restoring starts the sequence again at the one-day gap. Today selections remain stable within a local day, and skipped due items stay due.

## Development

Requirements: Node.js 24, npm, and a native iOS or Android toolchain. iOS builds require macOS/Xcode; Android builds require the Android SDK. Because SQLCipher and OCR are native modules, use the included `expo-dev-client` native development build rather than Expo Go.

For Xcode 27 / iOS 27, the project opts into Expo SDK 57's UIKit scene lifecycle through `expo-build-properties`. After pulling a change to native dependencies or config, regenerate the ignored `ios/` project before rebuilding. Preserve any manual native changes first; `npx expo prebuild --clean --platform ios` removes and recreates that directory. `npm run ios` applies a narrow workaround for an Expo SDK 57 Xcode script that otherwise mishandles checkout paths containing spaces (including `Proiect Alexandra`).

```sh
npm ci
npm run typecheck
npm test
npx expo-doctor
npm run ios       # or: npm run android
npm start
```

`npm start` starts Metro for the development client. `npm run ios` / `npm run android` generates and builds the native project locally. To check JavaScript bundling without a native toolchain:

In development builds, the Expo dev menu's floating **Tools** button lives in its own window. On iOS 27 a tap can leave that window key, and the backup share sheet is then torn down as soon as it appears. Test sharing in a Release build (`npm run ios -- --configuration Release`), which has no dev menu; the full backup and restore flow passed there on 23 October 2026.

If an iOS build succeeds but `simctl openurl` times out, let the simulator finish booting in Xcode's Device Hub, then start Metro with `npm start -- --localhost` and press `i` to open the installed development build. Rebuild with `npm run ios` after adding or changing a native dependency. A successful compile alone does not confirm the app opened.

```sh
npx expo export --platform ios --output-dir /tmp/resurface-ios-export
npx expo export --platform android --output-dir /tmp/resurface-android-export
```

**Code layout.** `App.tsx` holds app state, navigation and the actions that change data. Each screen is a component in `src/screens/` that receives its data and callbacks as props (`TodayScreens`, `CaptureScreens`, `LibraryScreens`, `DetailScreen`, `SettingsScreen`, `OnboardingScreen`); self-contained flows are hooks there too (`useBackup` with the password sheet, `useSharedContent` for the share extension, `useLibrary` for Library filters). Persistence rules live in `src/store.ts`, scheduling and pure rules in `src/domain.ts`.

**Simulator smoke test.** With a Release build installed on a booted iOS simulator whose onboarding is complete, `scripts/smoke-ios.sh [udid]` walks Today, each Library tab, Settings and the capture choice using the app's own translated labels, in whichever language it is set to. It is read-only: it never saves, deletes or changes settings. Status 24 October: after a simulator restart, three consecutive runs passed all 16 steps, including the restore warning and the All tab. If `axe describe-ui` stops returning, restart the simulator (its data is kept). It needs [AXe](https://github.com/cameroncooke/AXe). System sheets (share, file picker) still need a person.

## Data compatibility (schema and backups)

- **Database schema** is versioned with SQLite `PRAGMA user_version` and upgraded by the ordered migrations in `src/migrations.ts` when the database opens. Version 1 is the 0.1.0 schema (that build stored version 0; migration 1 is idempotent so it upgrades in place). Each migration and its version bump commit in one transaction: a failure leaves the previous version readable and shows a non-destructive error; a database written by a newer app is refused, never modified. Never edit a released migration — append a new one, and add a fixture test that upgrades every released version (`tests/migrations.test.ts`).
- **Prefer additive changes** (new tables, nullable columns or columns with defaults). A destructive change (dropping or rewriting data) needs a backup-and-verify plan and its own review.
- **Backup format** is versioned separately from the schema (`BACKUP_VERSION` in `src/backup.ts`) because archives carry logical records, not database files. The app reads archive v1–v3: v2 carries categories and v3 carries sources/favorites; it writes the lowest version that can represent the content. Older apps refuse an archive version they cannot safely read instead of silently dropping fields. Restoring produces current-schema rows, and future versions must continue reading every archive format this app has produced.

## Privacy and deletion review (23 October 2026, code review only)

- **Personal content at rest:** text, reflections, history, settings and counters are in the SQLCipher database (deleted rows and the WAL stay encrypted); photos are AES-GCM ciphertext files. Both keys are in Keychain/Keystore via SecureStore.
- **Plaintext copies:** the image picker, image manipulator (Android), the iOS photo preparation module and the document picker write plaintext copies to `cache/ImagePicker`, `cache/ImageManipulator`, `cache/PreparedPhoto` and `cache/DocumentPicker`; a shared photo waits in `cache/SharedPhoto`. The app deletes its copy after each save or cancel and clears those folders, plus any leftover backup file, on every launch. Copies the OS makes (photo library, iCloud Photos, Files) are outside the app and are not touched.
- **OCR:** runs on device and writes no files.
- **Logs and counters:** the app logs nothing to the console. Counters are a fixed name plus a time, never content (enforced by `tests/metrics.test.ts`), and never leave the device.
- **Notifications:** generic text by default. Each reconcile removes delivered notifications for insights that were already seen, paused, archived or deleted, and any that show insight text after that option is turned off.
- **Permanent delete:** removes the insight row, its events and reflections (cascade) and its photo file. A backup file the user already saved elsewhere is not affected.
- **Sharing into Resurface:** the share extension (text, links and one photo) passes content through the app-group store `group.app.resurface.mobile`, which is not encrypted; the app reads and clears it as soon as it opens and keeps the result only as an unsaved draft. A shared photo is a plaintext file in the app-group container: the app copies it into its own cache (deleted on save or cancel, and swept at launch), encrypts it only on Save, and deletes the visible files the extension left in the container. Hidden files there belong to iOS and are never touched; deleting the container's metadata file detaches it from the app. Content shared while the app never opens stays there until the next launch.
- **Backups:** only ciphertext is written to the cache, and it is deleted after the share sheet closes. A forgotten backup password cannot be recovered. A backup is complete or it is not made: if any photo can't be read, nothing is shared until the user explicitly chooses an archive that records what it leaves out, and restoring it says so. Archives are capped at 128 MB (checked on export and before restoring), with a 64 MiB key-derivation ceiling and record-count limits, because the whole archive is held in memory.
- **OS backups:** Android `allowBackup` is off, because Keystore keys do not move to a new device and an auto-restored database could never be opened. Use the encrypted backup instead. On iOS, Documents and non-device-only Keychain items are in encrypted device backups, so a full iPhone restore should keep both. This must be verified on device (backlog item 8).
- **App switcher:** whenever the app is not active, a plain cover replaces the screen, so the iOS app-switcher snapshot shows only the wordmark (verified from the snapshot file iOS saves). Android would need FLAG_SECURE for the same effect.
- **Key loss:** if a key is missing or the database cannot be opened, the app offers "Start fresh and restore a backup". It moves the database, photos and any remaining keys into `Documents/unreadable-<date>/` (nothing is deleted), starts empty, and onboarding offers "Restore from a backup". It refuses while the keychain is merely locked. Verified on the iOS simulator by resetting its keychain.
- **Known limits:** screenshots can show open insights. Photo paths are stored as absolute URIs, which iOS may change on app update (verify on device).

## Validation still needed

On 24 October 2026, TypeScript and all **82 automated tests** passed locally. Earlier Expo Doctor and both-platform JavaScript exports passed, but were not rerun for this review. `tests/lifecycle.test.ts` runs the production store (`src/store.ts`) and schema against in-memory SQLite with a controllable clock in a daylight-saving time zone; other tests cover migrations, categories, sources/favorites, sharing payloads, localization, reminder rules, All-insights search, backup compatibility and validation. SQLCipher itself, native photo crypto, and OS notification delivery are not exercised by these tests. On 23 October 2026, `npm run ios` built successfully from the `Proiect Alexandra` path, and the iOS 27 simulator launched through Metro to the Today screen with an existing encrypted insight. Later simulator Release checks exercised individual new flows; see `CLAUDE_HANDOFF.md`. These are **not** full device acceptance. The owner is continuing private feature development and is not publishing yet. Distribution signing and physical-device acceptance tests have **not** been completed. Before distributing later, verify SQLCipher read/write and key loss behavior, AES-GCM photo round trips, OCR quality, app restarts, notification delivery/deep links while backgrounded or terminated, accessibility, and the complete first-save flow on both platforms. Confirm bundle identifiers and signing credentials before store submission.

**Dependency review (24 October 2026, SCRUM-48).** `npx expo install --check` reports all packages aligned with Expo SDK 57 after updating `expo` to 57.0.31 and `expo-notifications` to 57.0.24. `npm audit` reports 5 high advisories, all inside `@expo/cli` (the development/build tool): `node-forge` ≤1.4.0 (GHSA-86w9-cpqp-85rv; no patched release exists) and `zod` <4.6.6 (GHSA-mrhx-c7xc-m3w5; fixed only in a new major that `@expo/cli` doesn't support). npm's `--force` fix would downgrade to Expo 44 and is not applied. Source maps of the iOS and Android exports show neither package in the shipped app. They affect only local builds and code-signing tooling; re-check when Expo publishes a CLI update.
