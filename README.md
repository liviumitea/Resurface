# Resurface

Resurface is a local-first iOS and Android beta for saving personal insights and bringing them back over time. The app implements the product's v0.2 core loop: capture → resurface → reflect → continue.

## What is built

- Three-step onboarding, ending only after the first successful save.
- Text, camera, and photo-library capture. On-device OCR produces editable text while retaining the photo; photo-only insights work too.
- A Today queue ordered by oldest due date, with configurable limits of 1, 3, or 5 insights per day.
- Reflection responses (`Yes`, `Not right now`, `Not anymore`), optional notes, and occasional value feedback.
- Searchable Library, detail/history, editing, pause/resume, archive/restore, and permanent deletion.
- Local notification scheduling, a generic lock-screen message by default, and a setting to opt into showing insight text.
- Content-free usage counters stored only on device.

## Architecture and privacy

This beta has no account, backend, or cloud sync. Insight text, reflection history, settings, and analytics live in a **SQLCipher-encrypted SQLite database**. Photos are normalized to JPEG and stored as **AES-GCM ciphertext** in app-private files. Random encryption keys are held in Expo SecureStore (iOS Keychain / Android Keystore). OCR runs on device using Apple Vision on iOS and ML Kit on Android. The app refuses to open the database if SQLCipher is unavailable, so **Expo Go is not supported**.

Personal content is not uploaded by this app. The image picker and image manipulator may create short-lived plaintext files in the app cache; the app removes the picker/manipulator copies it can identify after saving or discarding them. OS cache and backup behavior should be reviewed on physical devices before a wider launch.

**There is no export or backup yet.** Uninstalling the app, losing the device, or losing its encryption keys may permanently lose the insights. Do not use this beta as the only copy of irreplaceable material.

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

If an iOS build succeeds but `simctl openurl` times out, let the simulator finish booting in Xcode's Device Hub, then start Metro with `npm start -- --localhost` and press `i` to open the installed development build. Rebuild with `npm run ios` after adding or changing a native dependency. A successful compile alone does not confirm the app opened.

```sh
npx expo export --platform ios --output-dir /tmp/resurface-ios-export
npx expo export --platform android --output-dir /tmp/resurface-android-export
```

## Validation still needed

The TypeScript checks, domain/database-query tests, Expo Doctor, and both platform JavaScript exports pass. On 23 October 2026, `npm run ios` built successfully from the `Proiect Alexandra` path, and the iOS 27 simulator launched through Metro to the Today screen with an existing encrypted insight. This is a startup smoke test, **not** full device acceptance. Distribution signing and physical-device acceptance tests have **not** been completed. Before distributing the beta, verify SQLCipher read/write and key loss behavior, AES-GCM photo round trips, OCR quality, app restarts, notification delivery/deep links while backgrounded or terminated, accessibility, and the complete first-save flow on both platforms. Confirm bundle identifiers and signing credentials before store submission.

`npm audit` currently reports advisories in the Expo/Metro/React Native dependency tree. Its proposed `--force` fix would downgrade core framework packages and is not applied. Review patched compatible releases before production distribution.
