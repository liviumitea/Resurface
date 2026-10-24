# Resurface — review and prioritized roadmap

Reviewed 24 October 2026 against repository `main` through `ab08b64`, [Product Spec v0.2](https://alexadima.atlassian.net/wiki/spaces/~5ff74facd364960139d5a2ee/pages/688150/Product+Spec+v0.2), and the [SCRUM Jira board](https://alexadima.atlassian.net/jira/software/projects/SCRUM/boards/1?filter=&groupBy=none). This is a plan and review, not an assertion that the release gates have passed. `CLAUDE_HANDOFF.md` has operating details; `PRODUCT_BACKLOG.md` has the existing issue-by-issue acceptance gates. Re-check both code and Jira before executing the plan because they may change.

## Current position

The device-only beta implements onboarding, text/photo/on-device OCR capture, Today and reflection, Library and lifecycle/history, snooze, local notifications, SQLCipher storage, AES-GCM photos, password-protected export/replace restore, and local content-free metrics. There is no account, backend, or sync. On 24 October, `npm run typecheck` and all 44 tests passed locally. The repository's CI includes iOS/Android JavaScript exports and an Android native debug build. The 23 October iOS 27 simulator Release-build checks exercised several flows, including text capture, backup/restore without photos, snooze, accessibility text sizing, and key-loss recovery; see `CLAUDE_HANDOFF.md` for exact evidence. Do not mistake those checks for physical-device acceptance.

The beta is **not ready for outside distribution**. No physical-device pass is recorded, Android runtime behavior is not accepted, photo-containing restore and notification delivery are unverified, and signing/privacy/store release work remains. Keep personal data on-device and keep sync conditional rather than adding a backend by default.

## Findings and current status before external beta

1. **P0 — Backup completeness: code addressed, device proof pending.** The 24 October change in `src/backup.ts` now fails closed on a missing/unreadable photo by default. Explicitly chosen partial archives record omissions, and restore reports them. Unit tests cover the paths; a full photo-containing backup/restore round trip still needs device acceptance. Related: [SCRUM-34](https://alexadima.atlassian.net/browse/SCRUM-34), [SCRUM-36](https://alexadima.atlassian.net/browse/SCRUM-36).
2. **P0 — Import resource limits: code addressed, device proof pending.** Archive and record limits plus a 64 MiB KDF ceiling replaced the excessive parameters. The archive is still held in memory, so test the 128 MB cap and realistic photo libraries on target phones. Related: SCRUM-36 and [SCRUM-48](https://alexadima.atlassian.net/browse/SCRUM-48).
3. **P0 — Photo capture is too slow in the simulator; hardware impact unknown.** The 23 October library-HEIC measurement was 13–115 seconds in image manipulation. The 24 October switch to SDK 57's [contextual API](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/) still took 88 seconds to decode/resize in the simulator, while encode/encrypt/write were fast. Benchmark real devices before declaring a production performance bug or selecting another representation. Track this specifically in [SCRUM-52](https://alexadima.atlassian.net/browse/SCRUM-52), alongside [SCRUM-31](https://alexadima.atlassian.net/browse/SCRUM-31) and [SCRUM-43](https://alexadima.atlassian.net/browse/SCRUM-43).
4. **P0 — Metrics definition: code addressed, pilot proof pending.** The app now records separate `firstSaveAt` and `coreLoopAt` content-free milestones, matching first-save activation in v0.2. Confirm participant/time-window denominators and thresholds in the pilot before treating local counters as product evidence. Related: [SCRUM-46](https://alexadima.atlassian.net/browse/SCRUM-46), [SCRUM-45](https://alexadima.atlassian.net/browse/SCRUM-45).
5. **P0 — Finish evidence, not just code.** Physical iPhone and Android acceptance must cover first save, text/photo/OCR, all reflections, search/edit/delete, backup with photos, wrong password/corrupt archive, denied permissions, app restart/update, notification delivery/deep links/long absence, VoiceOver/TalkBack, and key/OS-backup behavior. Record device/OS, steps, results, failures, and fixes. No Jira issue should be marked Done only because its UI exists. Related: SCRUM-29, 31, 33, 35, 37, 38, 51.
6. **P0 — Keep docs and Jira truthful.** README previously said no export/backup despite the implemented v1 archive; this review updates that line but the user-facing copy still needs a final release audit. Jira currently shows nearly all new Resurface tasks as In Progress, even when `PRODUCT_BACKLOG.md` says code complete; split implemented/verified/blocked work and transition only after the stated acceptance gate. Also reconcile the old [Flutter task SCRUM-7](https://alexadima.atlassian.net/browse/SCRUM-7) with the actual Expo architecture decision, without deleting history.

## Delivery sequence

### Milestone 1 — Trustworthy core (partly implemented; device gate next)

Backup completeness, import limits, separate first-save/core-loop metrics, and associated automated tests are implemented. Next, measure photo saving on real devices, optimize any confirmed bottleneck, and verify full photo-containing backup/restore on both platforms. Gate: no known path to an apparently successful but unacknowledged incomplete backup, bounded import work on devices, and an agreed photo-save latency target met on a real iPhone and Android phone. This milestone is more important than new feature work.

### Milestone 2 — Device acceptance and release safety

Complete the physical-device matrix above, including real notification behavior and full encrypted photo backup/restore. Review compatible dependency security updates without forcing Expo/React Native downgrades. Add signed TestFlight and Play internal builds, verify install/update keeps encrypted data, and prepare privacy disclosures, terms, support, and rollback guidance. Gate: all P0 failures fixed or explicitly accepted with user-visible limitations; no claim of completed acceptance based solely on simulator or CI results. Related: [SCRUM-47](https://alexadima.atlassian.net/browse/SCRUM-47), SCRUM-48.

### Milestone 3 — Small, instrumented pilot

Recruit reflective users from the target persona; observe first save and the first return, run short interviews about whether resurfacing was useful, and report first-save activation, return/core-loop completion, answer rate, worth rate, and question-answer denominator. Confirm or revise provisional thresholds in `PRODUCT_BACKLOG.md` before using them for a go/no-go decision. Store no personal content in telemetry. Gate: written decision supported by both usage and interviews, without claiming behavior change from self-report alone. Related: SCRUM-45/46.

### Milestone 4 — Evidence-led v1 improvements

If pilot capture friction is high, spike **Share-to-Resurface** for text/links/images, with an editable draft and explicit Save. Expo SDK 57 documents incoming sharing as [experimental, with an iOS caveat](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/), so prototype on devices before committing to it. If retrieval friction is high, add optional source attribution and favorites, then consider categories (a future requirement in v0.2), Library/history polish, and Romanian localization. The separately scoped same-day revisit and backup-checkup stories are also candidates after the P0 gate. Add richer reminder windows only if users request them; preserve the simple app-only Today path. Related: SCRUM-40–44 and SCRUM-54–57.

### Milestone 5 — Conditional cross-device future

Compare device-only plus encrypted export, user-controlled backup, and end-to-end encrypted sync after pilot feedback. Only build accounts/backend/sync if the need, threat model, key recovery, conflict resolution, deletion semantics, and operating cost justify it. A future server must not be able to read insight text, reflections, or photos. Related: [SCRUM-49](https://alexadima.atlassian.net/browse/SCRUM-49), [SCRUM-50](https://alexadima.atlassian.net/browse/SCRUM-50).

## Additional Jira work approved 24 October 2026

These six distinct tickets use the existing epics; no new epic was needed. All six were placed in **To Do** (Jira initially created them as In Progress). P1 product enrichments should follow pilot evidence and the P0 device gate.

| Priority | Ticket | Outcome | Parent |
| --- | --- | --- | --- |
| P0 | [SCRUM-52](https://alexadima.atlassian.net/browse/SCRUM-52) | Diagnose/fix slow HEIC photo saving on devices | SCRUM-23 |
| P0 | [SCRUM-53](https://alexadima.atlassian.net/browse/SCRUM-53) | Versioned, rollback-safe encrypted database migrations | SCRUM-25 |
| P1 | [SCRUM-54](https://alexadima.atlassian.net/browse/SCRUM-54) | Revisit today's seen insights and reflect later | SCRUM-24 |
| P1 | [SCRUM-55](https://alexadima.atlassian.net/browse/SCRUM-55) | Truthful backup checkup and read-only verification | SCRUM-25 |
| P1 | [SCRUM-56](https://alexadima.atlassian.net/browse/SCRUM-56) | Optional multiple categories per insight | SCRUM-28 |
| P1 | [SCRUM-57](https://alexadima.atlassian.net/browse/SCRUM-57) | Full Romanian localization | SCRUM-23 |

SCRUM-53 formally blocks SCRUM-56 in Jira. Existing SCRUM-39, 41, 42, and 44 already cover snooze, Share Sheet capture, source/favorites, and Library polish; refine those rather than creating duplicates. Do not prioritize generated advice, social features, streaks, goals, mood tracking, or adaptive schedules without new evidence; they are outside the current product thesis. The immediate next investigation is real-device photo-save performance and P0 acceptance, with schema migrations before persisted feature additions.
