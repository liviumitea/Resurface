# Resurface — private-build product roadmap

Reviewed 24 October 2026 against repository `main` through `23714fd`, the [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2), and the current [handoff](CLAUDE_HANDOFF.md). The owner does **not** want to publish yet. This plan is for making the app more complete and useful in private builds; it is not a store-submission checklist. The [backlog](PRODUCT_BACKLOG.md) retains existing Jira acceptance gates.

## What exists now

The device-only app covers the spec's capture → resurface → reflect loop: first-save onboarding; text, photo, OCR and incoming Share Sheet capture; Today, same-day revisit and reflection; a searchable Library with categories, source, favorites, sorting and photo thumbnails; insight lifecycle/history and snooze; local reminders with a preferred time and quiet weekdays; English/Romanian UI; SQLCipher data, AES-GCM photos, versioned encrypted backups, restore and a backup checkup. Screen components and flow hooks have been extracted from `App.tsx`. Draft privacy, help/recovery and store-privacy documents exist.

TypeScript and **79 automated tests passed locally on 24 October**. The tests cover scheduling, migrations, archive compatibility, categories, source/favorites, sharing payloads, localization and reminder rules. Individual flows were checked on an iOS 27 simulator Release build. This is implementation evidence, not proof of physical-device behavior. No backend or account is needed for the present product direction.

The previous feature-first roadmap's steps 1–6 have code implementations. Do not rebuild Library polish, incoming sharing, photo/OCR feedback, reminder controls, screen extraction or draft help/privacy documentation as if they were still missing. Some acceptance remains open: the iOS smoke script has an unproven restore-warning step, native photo-containing restore is not accepted, and Android runtime, OS notification delivery, screen-reader use and real-device performance are unverified.

## Next feature pack — recommended order

These are **planned enhancements beyond v0.2**, tracked under [SCRUM-58](https://alexadima.atlassian.net/browse/SCRUM-58). They are not implemented yet. Keep the simple core path usable after every slice. Each feature should include English/Romanian copy, accessibility labels, store/domain tests and backup/migration coverage where data changes.

### 1. Prove backup and restore with photos in the native app — first task

Jira: [SCRUM-65](https://alexadima.atlassian.net/browse/SCRUM-65).

The archive format is unit-tested, but a photo-containing backup has never been created and restored through the app's own file, crypto and UI code. Do it on the iOS simulator before features 4 and 5 change what a backup holds: create a backup with photos and the newer fields (categories, source, favorite), verify it, restore it, and confirm photos open and history is intact. Fix the smoke script's restore-warning step so it is a dependable regression check. Gate: one recorded simulator round trip with photos; the smoke script passes three consecutive runs.

### 2. Find anything in Library

Jira: [SCRUM-61](https://alexadima.atlassian.net/browse/SCRUM-61).

The current search only runs inside the selected Active, Paused or Archived tab. Add an **All insights** view with a visible status badge and filters that continue to compose with category, favorite, source and sort. Filter state already survives opening a detail and returning (since the screen extraction); keep it that way. Test realistic large libraries; add pagination and consider an encrypted SQLite full-text index only if measured search latency warrants it. Expo SDK 57 supports [FTS and SQLCipher configuration](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), but the current `LIKE` query may be sufficient. Also fix a confirmed search bug: SQLite's `lower()` folds only ASCII, so searching "învață" misses "Învață…" and "știința" misses "Știința…". Match case- and diacritic-insensitively (so "invata" also finds "învață", useful on keyboards without Romanian letters), for example with a normalized search column kept in sync by the store. Gate: a user can find a known insight without first guessing its lifecycle status or typing exact diacritics, and search results remain correct after edits, archive, restore and migration.

### 3. Make the next return understandable

Jira: [SCRUM-64](https://alexadima.atlassian.net/browse/SCRUM-64).

Detail shows one next-resurfacing date, but there is no overview. Add a small **Upcoming** section showing the next few active insights and their *in-app due dates*, with a clear distinction from approximate notification delivery and quiet weekdays. Link to the insight's detail and existing snooze controls; do not add streaks or force an extra exposure. Gate: it matches the production schedule through pause/archive/snooze, time-zone changes and an empty queue, without leaking insight text on the lock screen.

### 4. Make reflections maintainable

Jira: [SCRUM-62](https://alexadima.atlassian.net/browse/SCRUM-62).

History displays a response and optional note, but an older note cannot currently be corrected or added later. Let the user add, edit or remove a note attached to an exposure from Insight Detail; show when a note was edited. Keep the original event/response and scheduling history unchanged—changing a past `Yes`/`Not now`/`Not anymore` would have different lifecycle consequences and is out of scope for this slice. Recording an edit time needs a new reflections column: append schema migration 4 and a backup archive version that carries it, with older archives still restoring (the pattern used for categories and sources). Gate: note changes survive restart and encrypted backup/restore, never count as another exposure or answer, and do not alter the next due date.

### 5. Let saved photos be managed safely

Jira: [SCRUM-63](https://alexadima.atlassian.net/browse/SCRUM-63).

Insight editing can change text/context/source/categories but not the attached image. Add a full-screen accessible photo viewer and the ability to attach, replace, or remove one photo on an existing insight. Offer OCR again as an explicit action, never silently overwrite edited text. Stage and encrypt a replacement before switching the database reference; delete the old encrypted file only after the update succeeds. Do not allow removal when it would leave a photo-only insight empty. Gate: no orphaned files or broken backup references after failure, cancellation, replacement or deletion.

### 6. Recover interrupted capture drafts

Jira: [SCRUM-59](https://alexadima.atlassian.net/browse/SCRUM-59) text/metadata recovery, then [SCRUM-60](https://alexadima.atlassian.net/browse/SCRUM-60) encrypted draft photos and share conflicts.

Today, the capture form and incoming share draft live in memory; leaving the flow or an app interruption can lose work. Add an encrypted draft that survives app restart without becoming a saved insight or scheduling a resurface. Start with text/context/source/categories only and ship that; then, if still wanted, handle a draft photo as encrypted app-private data and clear its plaintext picker/share copies. Show **Resume draft / Discard draft** and avoid silently replacing one draft with incoming shared content. Gate: restart, interruption, cancel, Save and share-over-existing-draft cases neither lose an accepted draft nor leave orphaned plaintext/photo files; draft data is excluded from insight metrics and reminders.

## Consolidation after each slice

Jira: [SCRUM-65](https://alexadima.atlassian.net/browse/SCRUM-65) regression and simulator evidence; [SCRUM-66](https://alexadima.atlassian.net/browse/SCRUM-66) English/Romanian product, privacy, recovery, backup and handoff documentation. Start their checks and copy work alongside each feature, then close them after the full pack is verified.

- Repeat typecheck, unit/store/backup tests and iOS/Android JavaScript exports. Run the available iOS simulator smoke path and fix its restore-warning step before treating it as a reliable regression check. Add an Android emulator smoke path if a runtime is available; a CI native build alone does not exercise the UI.
- Complete a native **simulator** backup/restore round trip containing photos and the new fields. The pure archive test already passes; this verifies the app's file, crypto and UI glue without claiming physical-device acceptance.
- Review privacy and deletion whenever a feature adds persistent drafts, notes, photos or share-container data. No personal content should be sent to telemetry or a server.

## Not in this phase

No store publication, signing project, release date or public-beta claim is requested. Physical-device acceptance, signed distribution and pilot evidence remain later gates if the owner decides to distribute. Account/cloud sync, AI-generated advice, social features, streaks and adaptive resurfacing are not needed to make this private device-only app comprehensive. Possible later experiments—multiple photos, widgets, bulk Library actions or end-to-end encrypted sync—should follow use of the completed core, not displace the five items above.
