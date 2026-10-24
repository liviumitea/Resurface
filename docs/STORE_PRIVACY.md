# Store privacy answers and release checklist (draft)

*24 October 2026. Prepared from the code on `main`; confirm each item when the store accounts are available
(SCRUM-47). Nothing here has been submitted.*

## Apple App Store — App Privacy

**Data collection: "Data Not Collected."** Resurface has no server, account, analytics, advertising or
crash-reporting SDK. Everything the app stores stays on the device, and backups go only where the user
saves them. On-device processing that never leaves the device is not "collection" in Apple's definition.

Check before submitting:
- No SDK added since this review sends data (search for network calls and analytics packages).
- Expo's update service is not enabled (`expo-updates` is not a dependency).

**Permission purpose strings** (English in `app.json` and `locales/en.json`; Romanian in `locales/ro.json`):
camera — "Take photos of things you want to remember."; photo library — "Choose photos of things you want to
remember." Notification permission is requested in-app after the first save, with an explanation.

**Export compliance.** The app encrypts the user's own data at rest (SQLCipher, AES-GCM) and backup files
(scrypt + AES-256-GCM) with standard algorithms; it does not encrypt communications. This usually qualifies
for an exemption, but the answer and the `ITSAppUsesNonExemptEncryption` key are the owner's legal decision
and are not set in the project yet.

**Open product decision — iOS keys and device backups.** Keys are stored with expo-secure-store's default
Keychain accessibility (not "this device only"). An iCloud or encrypted computer backup of the iPhone may
therefore carry the keys together with the encrypted files to a restored phone. Decide whether to keep that
(convenient migration) or switch to a this-device-only accessibility with a migration plan for existing keys,
and test the chosen behaviour on a device (SCRUM-35).

## Google Play — Data safety

- **Data collected by the app: none. Data shared: none.**
- **Encrypted in transit:** not applicable (the app transmits no user data).
- **Users can request deletion:** data is deleted in the app or by uninstalling; there is no server copy.
- **Third-party component to declare or confirm:** text recognition uses Google ML Kit through Google Play
  services (`play-services-mlkit-text-recognition`). Images are processed on the device, but Google Play
  services may send Google diagnostic and usage information about ML Kit under Google's terms. Check
  Google's current ML Kit data-disclosure guidance and declare it if required.
- **Permissions:** camera and photos (picker), `POST_NOTIFICATIONS`. `allowBackup` is false.

## Listing copy (draft)

**Short description:** Save the lessons you want to keep; Resurface brings them back to reflect on.

**Privacy line for the description:** "Everything stays on your phone, encrypted. No account, no cloud, no
tracking. Back up with a password-protected file you keep."

Avoid in store copy: exact reminder times ("at 9:00 every day"), "never lose your notes", or "end-to-end
encrypted sync"; none of these is true of the beta.

## Before the first external build

- [ ] Fill in the support contact in `docs/PRIVACY.md` and `docs/SUPPORT.md`, and publish both at a public URL.
- [ ] App group `group.app.resurface.mobile` registered for the share extension (SCRUM-47).
- [ ] Export-compliance answer decided.
- [ ] Keychain accessibility decision made and tested (see above).
- [ ] Device passes recorded for core loop, backup/restore with photos, notifications and OCR (SCRUM-31, 35, 38, 52).
