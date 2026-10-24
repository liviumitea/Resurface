# Resurface

For the current state and verification limits, see [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md). For the prioritized improvements and future features, see [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md).

Resurface is a local-first iOS and Android beta for saving personal insights and bringing them back over time. The app implements the product's v0.2 core loop: capture → resurface → reflect → continue.

## What is built

- Three-step onboarding, ending only after the first successful save.
- A `+` capture selector for writing, taking a photo, or choosing a photo. On-device OCR produces editable text while retaining the photo; photo-only insights work too.
- A Today queue ordered by oldest due date, with configurable limits of 1, 3, or 5 insights per day.
- Reflection responses (`Yes`, `Not right now`, `Not anymore`), optional notes, and occasional value feedback.
- Searchable Library, detail/history, editing, pause/resume, archive/restore, and permanent deletion.
- Local notification scheduling, a generic lock-screen message by default, and a setting to opt into showing insight text.
- Content-free usage counters stored only on device.
- Password-protected encrypted export and replace-only restore (still awaiting full physical-device acceptance).

## Architecture and privacy

This beta has no account, backend, or cloud sync. Insight text, reflection history, settings, and analytics live in a **SQLCipher-encrypted SQLite database**. Photos are normalized to JPEG and stored as **AES-GCM ciphertext** in app-private files. Random encryption keys are held in Expo SecureStore (iOS Keychain / Android Keystore). OCR runs on device using Apple Vision on iOS and ML Kit on Android. The app refuses to open the database if SQLCipher is unavailable, so **Expo Go is not supported**.

Personal content is not uploaded by this app. The image picker and image manipulator may create short-lived plaintext files in the app cache; the app removes the picker/manipulator copies it can identify after saving or discarding them. OS cache and backup behavior should be reviewed on physical devices before a wider launch.

Password-protected backup and restore are implemented, but have not completed physical-device acceptance, particularly with photos. A backup password cannot be recovered. Uninstalling the app, losing the device or keys, or having an incomplete backup may permanently lose insights. Do not use this beta as the only copy of irreplaceable material. See the [roadmap](PRODUCT_ROADMAP.md) for the backup safety work required before wider distribution.

## Scheduling decisions

- The intervals `1, 3, 7, 14, 30, 60, 120` are successive calendar-day gaps. The first event is due one day after saving; each later gap is measured from when the previous event was actually shown. The 120-day gap repeats thereafter.
- A notification being delivered does not count as seeing an insight. The pending event remains due until its card is shown. A notification already planned in the past is not repeatedly rescheduled, avoiding reminder spam.
- At most 30 future local notifications are planned, with at most one on a given day. The queue is refreshed when the app launches or relevant data/settings change. Long absences, time-zone changes, and OS permission changes therefore need real-device testing; after 30 planned notifications, the app must be reopened to extend the queue.
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

## Privacy and deletion review (23 October 2026, code review only)

- **Personal content at rest:** text, reflections, history, settings and counters are in the SQLCipher database (deleted rows and the WAL stay encrypted); photos are AES-GCM ciphertext files. Both keys are in Keychain/Keystore via SecureStore.
- **Plaintext copies:** the image picker, image manipulator and document picker write plaintext copies to `cache/ImagePicker`, `cache/ImageManipulator` and `cache/DocumentPicker`. The app deletes its copy after each save or cancel and clears those folders, plus any leftover backup file, on every launch. Copies the OS makes (photo library, iCloud Photos, Files) are outside the app and are not touched.
- **OCR:** runs on device and writes no files.
- **Logs and counters:** the app logs nothing to the console. Counters are a fixed name plus a time, never content (enforced by `tests/metrics.test.ts`), and never leave the device.
- **Notifications:** generic text by default. Each reconcile removes delivered notifications for insights that were already seen, paused, archived or deleted, and any that show insight text after that option is turned off.
- **Permanent delete:** removes the insight row, its events and reflections (cascade) and its photo file. A backup file the user already saved elsewhere is not affected.
- **Backups:** only ciphertext is written to the cache, and it is deleted after the share sheet closes. A forgotten backup password cannot be recovered.
- **OS backups:** Android `allowBackup` is off, because Keystore keys do not move to a new device and an auto-restored database could never be opened. Use the encrypted backup instead. On iOS, Documents and non-device-only Keychain items are in encrypted device backups, so a full iPhone restore should keep both. This must be verified on device (backlog item 8).
- **App switcher:** whenever the app is not active, a plain cover replaces the screen, so the iOS app-switcher snapshot shows only the wordmark (verified from the snapshot file iOS saves). Android would need FLAG_SECURE for the same effect.
- **Key loss:** if a key is missing or the database cannot be opened, the app offers "Start fresh and restore a backup". It moves the database, photos and any remaining keys into `Documents/unreadable-<date>/` (nothing is deleted), starts empty, and onboarding offers "Restore from a backup". It refuses while the keychain is merely locked. Verified on the iOS simulator by resetting its keychain.
- **Known limits:** screenshots can show open insights. Photo paths are stored as absolute URIs, which iOS may change on app update (verify on device).

## Validation still needed

The TypeScript checks, domain/database-query tests, Expo Doctor, and both platform JavaScript exports pass. `tests/lifecycle.test.ts` runs the production store (`src/store.ts`) and schema against in-memory SQLite with a controllable clock in a daylight-saving time zone, covering every scheduling rule above, including the cap, overdue order, local-day boundary, restart, pause/archive/resume, each reflection response, and notification planning limits. SQLCipher itself, native photo crypto, and OS notification delivery are not exercised by these tests. On 23 October 2026, `npm run ios` built successfully from the `Proiect Alexandra` path, and the iOS 27 simulator launched through Metro to the Today screen with an existing encrypted insight. This is a startup smoke test, **not** full device acceptance. Distribution signing and physical-device acceptance tests have **not** been completed. Before distributing the beta, verify SQLCipher read/write and key loss behavior, AES-GCM photo round trips, OCR quality, app restarts, notification delivery/deep links while backgrounded or terminated, accessibility, and the complete first-save flow on both platforms. Confirm bundle identifiers and signing credentials before store submission.

`npm audit` currently reports advisories in the Expo/Metro/React Native dependency tree. Its proposed `--force` fix would downgrade core framework packages and is not applied. Review patched compatible releases before production distribution.
