# Resurface — private-build product roadmap

Reviewed 24 October 2026 against repository `main` through `0b56eb5`, the [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2), and the current [handoff](CLAUDE_HANDOFF.md). The owner does **not** want to publish yet. This plan is for making the app more complete and useful in private builds; it is not a store-submission checklist. The [backlog](PRODUCT_BACKLOG.md) retains existing Jira acceptance gates.

## What exists now

The device-only app covers the spec's capture → resurface → reflect loop: first-save onboarding; text, photo, OCR and incoming Share Sheet capture; Today, same-day revisit and reflection; a searchable Library with categories, source, favorites, sorting and photo thumbnails; insight lifecycle/history and snooze; local reminders with a preferred time and quiet weekdays; English/Romanian UI; SQLCipher data, AES-GCM photos, versioned encrypted backups, restore and a backup checkup. Screen components and flow hooks have been extracted from `App.tsx`. Draft privacy, help/recovery and store-privacy documents exist.

TypeScript and **82 automated tests passed locally on 24 October**. The tests cover scheduling, migrations, archive compatibility, categories, source/favorites, sharing payloads, localization, reminder rules and All-insights search. Individual flows were checked on an iOS 27 simulator Release build. This is implementation evidence, not proof of physical-device behavior. No backend or account is needed for the present product direction.

The previous feature-first roadmap's steps 1–6 have code implementations. Do not rebuild Library polish, incoming sharing, photo/OCR feedback, reminder controls, screen extraction or draft help/privacy documentation as if they were still missing. The All-insights Library feature and its accent-insensitive search are now implemented. The iOS smoke script's restore-warning step passed in three complete runs, and a native simulator backup/restore with photos passed on 25 October. Android runtime, OS notification delivery, screen-reader use and real-device performance are also unverified.

## Next feature pack — recommended order

These enhancements beyond v0.2 are tracked under [SCRUM-58](https://alexadima.atlassian.net/browse/SCRUM-58). SCRUM-61, SCRUM-64 and SCRUM-62 are implemented and SCRUM-65's simulator gates are verified; the other features remain planned. Keep the simple core path usable after every slice. Each feature should include English/Romanian copy, accessibility labels, store/domain tests and backup/migration coverage where data changes.

### 1. Prove backup and restore with photos in the native app — done on the simulator

Jira: [SCRUM-65](https://alexadima.atlassian.net/browse/SCRUM-65).

Done on 25 October 2026 on the iOS 27 simulator (Release build): a backup with 8 insights, 6 photos, categories, a source and a favorite was created, saved to Files, picked and restored. Photos, history and the newer fields matched, and a second backup taken after the restore contained byte-identical photos. The smoke script's restore warning passed three consecutive runs. Physical-device restore is still unverified.

### 2. Find anything in Library — implemented

Jira: [SCRUM-61](https://alexadima.atlassian.net/browse/SCRUM-61).

Commit `0b56eb5` adds an **All insights** tab, status labels, and search across content, context and source that ignores case and accents, including Romanian comma/cedilla forms. Category, favorite and sort controls still compose; filter state survives detail navigation. Three new tests cover mixed statuses, lifecycle edits and a 5,000-insight query (25 ms on this run's node:sqlite). The iOS simulator flow and three complete smoke runs were recorded with the commit. Device SQLCipher latency and physical-device acceptance remain unmeasured; revisit indexing or pagination only if a measured native library is slow. Do not rebuild this feature as a new task.

### 3. Make the next return understandable — implemented

Jira: [SCRUM-64](https://alexadima.atlassian.net/browse/SCRUM-64).

Implemented on 25 October 2026. Today has a "See what's coming up" link to an **Upcoming** screen: the next 20 active insights not already on Today, soonest first. Each row says "Due now · waiting for room in Today", "Later today", "Tomorrow" or "From {date}" by local calendar day, and the total is counted. A footer explains the daily cap and that reminders are approximate (time, quiet days, or off). Rows open Detail (with snooze), and Back returns to Upcoming. It is a separate screen, so Today never shows upcoming text unasked, and it is read-only: looking is not a resurfacing. Nothing is added to notifications. Four store/domain tests cover pause, resume, archive, snooze, a real showing, the daily cap, an empty queue, the limit, a time-zone change and the DST night. A Release build on the iOS 27 simulator was checked: the rows matched the stored schedule, snoozing from Detail moved the row on return, and the largest text size wrapped cleanly. The smoke script now opens Upcoming (18 steps, three consecutive passes). Physical-device acceptance is not done.

### 4. Make reflections maintainable — implemented

Jira: [SCRUM-62](https://alexadima.atlassian.net/browse/SCRUM-62).

Implemented on 26 October 2026. Each exposure in Insight Detail's history has **Add a note** / **Edit note**, with an inline editor and a confirmed **Remove note**. A note shows "Edited {date}", or "Added {date}" when written on a later day than the exposure. Only exposures the user actually saw take a note; responses, events and next due dates never change (changing a past answer remains out of scope). If a note was added from history before the user answered in Reflect, the answer's note is appended so the exposure keeps one note. Schema migration 4 adds `reflections.updatedAt`; archive version 4 is written only when some note was edited, so other backups stay readable by older builds, and v1–v3 archives restore as never edited. Counters `reflection_edited` and `reflection_removed` are content-free. Four store/backup tests cover add/edit/remove, restart, no extra exposure or answer, the unchanged due date, unseen events, the Reflect overlap and the v4/legacy archive round trip; the 0.1.0 migration test now expects the new column. On the iOS 27 simulator (Release build) the database migrated with all 8 insights intact; adding and editing a note showed the right labels with the due date and history unchanged; and the app's own backup was a v4 archive containing the edited note and its edit time. A native **restore** of that archive was not completed: after restarts the simulator's system daemons crash-looped (see the handoff), so the share sheet and document picker stopped responding. The restore path is covered by the automated test on the production store and was verified natively for v3 on 25 October.

### 5. Let saved photos be managed safely

Jira: [SCRUM-63](https://alexadima.atlassian.net/browse/SCRUM-63).

Insight editing can change text/context/source/categories but not the attached image. Add a full-screen accessible photo viewer and the ability to attach, replace, or remove one photo on an existing insight. Offer OCR again as an explicit action, never silently overwrite edited text. Stage and encrypt a replacement before switching the database reference; delete the old encrypted file only after the update succeeds. Do not allow removal when it would leave a photo-only insight empty. Gate: no orphaned files or broken backup references after failure, cancellation, replacement or deletion.

### 6. Recover interrupted capture drafts

Jira: [SCRUM-59](https://alexadima.atlassian.net/browse/SCRUM-59) text/metadata recovery, then [SCRUM-60](https://alexadima.atlassian.net/browse/SCRUM-60) encrypted draft photos and share conflicts.

Today, the capture form and incoming share draft live in memory; leaving the flow or an app interruption can lose work. Add an encrypted draft that survives app restart without becoming a saved insight or scheduling a resurface. Start with text/context/source/categories only and ship that; then, if still wanted, handle a draft photo as encrypted app-private data and clear its plaintext picker/share copies. Show **Resume draft / Discard draft** and avoid silently replacing one draft with incoming shared content. Gate: restart, interruption, cancel, Save and share-over-existing-draft cases neither lose an accepted draft nor leave orphaned plaintext/photo files; draft data is excluded from insight metrics and reminders.

## Consolidation after each slice

Jira: [SCRUM-65](https://alexadima.atlassian.net/browse/SCRUM-65) regression and simulator evidence; [SCRUM-66](https://alexadima.atlassian.net/browse/SCRUM-66) English/Romanian product, privacy, recovery, backup and handoff documentation. Start their checks and copy work alongside each feature, then close them after the full pack is verified.

- Repeat typecheck, unit/store/backup tests and iOS/Android JavaScript exports. Run the available iOS simulator smoke path; its restore-warning step now passes, but system share and file-picker sheets still need manual checks. Add an Android emulator smoke path if a runtime is available; a CI native build alone does not exercise the UI.
- Repeat the native **simulator** backup/restore round trip with photos after each slice that changes what a backup holds (reflection notes, saved-photo editing). It passed on 25 October before those changes.
- Review privacy and deletion whenever a feature adds persistent drafts, notes, photos or share-container data. No personal content should be sent to telemetry or a server.

## Not in this phase

No store publication, signing project, release date or public-beta claim is requested. Physical-device acceptance, signed distribution and pilot evidence remain later gates if the owner decides to distribute. Account/cloud sync, AI-generated advice, social features, streaks and adaptive resurfacing are not needed to make this private device-only app comprehensive. Possible later experiments—multiple photos, widgets, bulk Library actions or end-to-end encrypted sync—should follow use of the remaining core work above.
