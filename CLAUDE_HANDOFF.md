# Resurface — continuation handoff

Updated 23 October 2026. This file is the durable handoff for the next coding assistant. Read this, then `README.md`, `PRODUCT_BACKLOG.md`, the current code, and the linked product spec before changing behavior. Do not infer that an implemented screen or a successful compile is a tested product.

## Mission and sources of truth

Build Resurface into a safe, useful iOS/Android product: a person captures their own insight, sees it resurface later, and reflects on whether it still resonates. This is not an AI advice, habit, or social app. The current target is a device-only beta; a backend and account system are **not** part of this release. Preserve user privacy and durability while completing the core loop.

- Repository: <https://github.com/liviumitea/Resurface>, branch `main`.
- Leading [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2) and [Confluence space](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/overview). Where older MVP/v0.1 pages differ, prefer v0.2 and record any deliberate exception.
- [Jira SCRUM board](https://alexadima.atlassian.net/jira/software/projects/SCRUM/boards/1?filter=&groupBy=none). The detailed issue-by-issue acceptance gates and product traceability are in `PRODUCT_BACKLOG.md`. Jira cloud/site is `alexadima.atlassian.net`; do not accidentally use the unrelated `tieto.atlassian.net` connection.
- Existing architecture decisions: [SCRUM-21](https://alexadima.atlassian.net/browse/SCRUM-21) and [SCRUM-22](https://alexadima.atlassian.net/browse/SCRUM-22). Epics: [core](https://alexadima.atlassian.net/browse/SCRUM-23), [resurfacing](https://alexadima.atlassian.net/browse/SCRUM-24), [data safety](https://alexadima.atlassian.net/browse/SCRUM-25), [optional sync](https://alexadima.atlassian.net/browse/SCRUM-26), [pilot/release](https://alexadima.atlassian.net/browse/SCRUM-27), [capture](https://alexadima.atlassian.net/browse/SCRUM-28). Child issues are SCRUM-29 through SCRUM-50; the reflection-note regression is [SCRUM-51](https://alexadima.atlassian.net/browse/SCRUM-51).

An older, fuller synthesis of the Confluence space is saved as `RESURFACE_BUILD_PLAN.md`. It is historical planning context, not a current acceptance report; some proposed decisions there were settled differently in the implementation. The current decisions are recorded here and in the README/backlog. Revisit Confluence when resolving ambiguity.

## Current code and decisions

The app is Expo SDK 57 / React Native / TypeScript, currently version 0.1.0. `App.tsx` contains navigation and screens. `src/domain.ts` defines models and pure scheduling rules. `src/storage-queries.ts` contains shared production SQL schema/selection queries; `src/store.ts` implements all persistence/lifecycle rules over an injected database, ID generator and clock; `src/storage.ts` opens SQLCipher, owns keys/photos, and binds the store to it; `src/media.ts` encrypts/decrypts photos; `src/notifications.ts` reconciles local reminders; `src/ui.tsx` and `src/theme.ts` contain UI components/styles. `tests/domain.test.ts` and `tests/storage-queries.test.ts` cover pure rules and shared SQL; `tests/lifecycle.test.ts` runs the production store on node:sqlite with a controllable clock in Europe/Bucharest (DST). `scripts/prepare-ios.mjs` works around Expo SDK 57 generated Xcode scripts mishandling checkout paths with spaces, including `Proiect Alexandra`.

Implemented flows: three-step onboarding ending after first save; `+` chooser for Write / Take photo / Choose photo / Cancel; text, camera, library, on-device OCR with editable extracted text and retained original, and photo-only capture; Today queue; Yes / Not right now / Not anymore reflection with optional note; Library search/filter/detail/history/edit; pause/resume, archive/restore, permanent delete; local reminder settings; content-free local usage counters. The reflection note is now stored for all three responses, but the regression still needs interactive device verification (SCRUM-51).

Personal text, events, reflections, settings, and counters are in a SQLCipher-encrypted SQLite database. Photos are JPEGs stored as AES-GCM ciphertext in app-private files. Independent random keys are stored with Expo SecureStore (Keychain/Keystore). OCR runs on device. There is no account, backend, telemetry upload, or cloud sync. SQLCipher requires a native development build: **Expo Go will not work**. Picker/manipulator plaintext cache copies are best-effort removed; review residual OS/cache/backup behavior before external release. Never log insight, photo, context, or reflection content.

Scheduling policy in code/README: gaps of 1, 3, 7, 14, 30, 60, 120 **successive calendar days**; the 120-day gap repeats. A subsequent gap begins when a card is actually shown, not when a notification arrives. At most one pending event per active insight. Today is oldest-overdue-first, stable within a local day, capped at 1/3/5. Skipped items stay due. Pause/archive cancels pending; resume/restore starts at stage zero. Up to 30 future generic-by-default local notifications are planned, at most one per day; opening the app reconciles the queue. Delivery/long-absence behavior still requires real-device validation. These choices resolve several ambiguities in the earlier MVP pages; do not silently change them.

Remaining product decisions requiring explicit evidence/user agreement: beta measurement thresholds and question cadence; exact durability/recovery promises across uninstall and migration; whether users need cross-device sync after export/pilot. The spec labels some reminders “push”, but this architecture uses **local** notifications. The spec's Account / Sign out / Delete account controls are conditional on authentication and intentionally absent from the current device-only beta.

## What has and has not been verified

On 23 October 2026, `npm run typecheck`, `npm test` (8 passing tests), Expo Doctor, and iOS/Android JavaScript exports passed. `npm run ios` built from the exact `/Users/liviumitea/Documents/ChatGPT/Proiect Alexandra` path on Xcode/iOS 27. An iPhone 18 Pro iOS 27 simulator installed the app and opened Today through Metro, displaying an existing encrypted insight. That is a startup/read smoke test, **not** full interactive acceptance. The newest `+` chooser was typechecked/tested/bundled but not manually tapped on device. A simulated Today display may have marked a previously due insight as shown and advanced that simulator's local schedule; use fresh fixture data when testing timing.

Not yet verified: Android native build, physical-device iOS/Android flows, full onboarding/capture/OCR/notification/deep-link/lifecycle regression, all denied-permission and fatal/recoverable error paths, accessibility, signed TestFlight/Play builds, backup/restore, uninstall/migration/key-loss behavior. Lifecycle rules are covered by `tests/lifecycle.test.ts`; native SQLCipher, photo crypto round trips, and OS notification delivery are not. `npm audit` reports Expo/Metro/React Native-tree advisories; do **not** blindly apply `npm audit fix --force`, which proposes framework downgrades. Full acceptance remains open in Jira.

There is **no encrypted export or restore yet**. Uninstall, device loss, or key loss may permanently destroy insights. Do not recommend this beta as the only copy of irreplaceable personal material or invite a wider beta before the data-safety gate. Do not wipe/reset the simulator or user database merely to make a test pass. `ios/`, `android/`, `.expo/`, `node_modules/`, and the local planning document are gitignored; `prebuild --clean` destroys and regenerates the native directory, so inspect for manual native changes first.

## Reproduce and continue

From a clean clone with Node 24, npm, Xcode for iOS, and Android SDK for Android:

```sh
npm ci
npm run typecheck
npm test
npm run doctor
npm run ios       # iOS native development build; not Expo Go
# or: npm run android
```

Start Metro for the development client with `npm start`; if iOS compilation succeeds but `simctl openurl` times out, boot the simulator fully, run `npm start -- --localhost`, then press `i` to open the installed build. Rebuild after changes to native dependencies/config. The previous Metro server was on port 8082, but that process/port is ephemeral and should not be treated as a saved artifact. JS-only bundle checks are documented in README. Run `git status` first and preserve unrelated user changes; do not expose keys or personal simulator content in logs/screenshots.

Suggested immediate sequence, following Jira acceptance gates:

1. [SCRUM-33](https://alexadima.atlassian.net/browse/SCRUM-33): Today loading skeleton, recoverable error/retry, non-destructive fatal-screen retry, and a no-replacement-key guard are implemented (typecheck, tests, iOS export pass). Remaining: interactive device verification of those states, then close in Jira. The local shell defaults to Node 18; use `~/.nvm/versions/node/v24.14.1/bin` for `npm test`.
2. [SCRUM-32](https://alexadima.atlassian.net/browse/SCRUM-32): done — lifecycle tests in `tests/lifecycle.test.ts` (25 tests total, mutation-checked against the SCRUM-51 note bug and a gap-origin bug). Close [SCRUM-51](https://alexadima.atlassian.net/browse/SCRUM-51) only after the reflection-note regression is exercised on device.
3. [SCRUM-30](https://alexadima.atlassian.net/browse/SCRUM-30): validate a clean Android native build and CI, then [SCRUM-31](https://alexadima.atlassian.net/browse/SCRUM-31) full physical-device acceptance on both platforms, including the new `+` chooser.
4. (In progress — archive core and tests are done, see PRODUCT_BACKLOG item 6.) 4. [SCRUM-34](https://alexadima.atlassian.net/browse/SCRUM-34), [SCRUM-36](https://alexadima.atlassian.net/browse/SCRUM-36), and [SCRUM-35](https://alexadima.atlassian.net/browse/SCRUM-35): design/implement password-protected versioned export, safe staged restore, and backup/key-loss policy before wider beta. Include integrity, wrong-password, interruption, duplicate-ID, photo, and history cases; avoid personal plaintext temp/share files.
5. Finish notification, privacy, accessibility, pilot and release gates in `PRODUCT_BACKLOG.md`. Treat sync as conditional P2 discovery, not the next implementation step.

When completing work, update the relevant Jira issue with evidence, commit and push code/docs to this repository, and distinguish automated validation from actual device acceptance. The main branch at the start of this handoff was `b5b7899` (`Add capture choice flow from product spec`); this handoff itself is a subsequent docs-only commit.
