# Resurface privacy notice

*Draft for the beta, 24 October 2026. Review before publishing it as the store privacy policy. The support
contact below must be filled in first.*

[Română mai jos](#notă-de-confidențialitate-resurface)

## In short

Resurface keeps what you save on your device. There is no account, no server and no cloud sync. The app
does not send your insights, photos, notes or usage to us or to anyone else. You can delete everything by
deleting insights in the app or by removing the app.

## What the app stores, and where

| What | Where | Protection |
|---|---|---|
| Insights, context notes, sources, categories, favorites, reflections and resurfacing history | A database on your device | Encrypted (SQLCipher) with a random key held in the iOS Keychain / Android Keystore |
| Photos you attach | Files in the app's private storage | Each encrypted (AES-GCM) with a random key held in the Keychain / Keystore |
| Settings (frequency, reminder time, quiet days, language, notification text preference) | The same encrypted database | As above |
| An unfinished insight you haven't saved yet (its text, context, source, categories and resurfacing choice, not a photo) | The same encrypted database | As above. It is not included in backups and is deleted when you save the insight or discard the draft |
| Usage counters (for example "insight created", "reminder opened", "backup verified") with their times | The same encrypted database | As above. They never contain your text and are not sent anywhere; Settings shows a summary to you |

While you are saving a photo, the camera, photo picker or share extension can leave a temporary unencrypted
copy in the app's cache. The app deletes its copies after you save or cancel and clears these folders every
time it starts. Copies kept by your photo library, iCloud Photos, Files or the app you shared from are
outside Resurface and are not touched.

Content shared into Resurface from another app passes through a storage area shared with the Resurface
share extension. It is not encrypted there; the app reads and removes it as soon as it opens, and keeps it
only as an unsaved draft until you tap Save.

## What leaves your device

- **Nothing by default.** Resurface has no analytics, advertising or crash-reporting service and makes no
  network requests of its own.
- **Backups, only when you make one.** A backup is a file encrypted with a password you choose (scrypt and
  AES-256-GCM). You decide where to save or send it. We cannot open it or recover the password.
- **Notifications.** Reminders are scheduled locally by your phone. By default they say only that something
  is waiting; if you turn on "Show insight text", part of the insight can appear on the lock screen.
- **Text recognition on Android.** Reading text from a photo uses Google ML Kit through Google Play services.
  The photo is processed on the device, but Google Play services downloads the recognition model and, under
  Google's own terms, may send Google technical usage and performance information. On iOS, Apple's on-device
  Vision framework is used.
- **Operating-system backups.** On Android, the app opts out of system backup. On iOS, an iCloud or encrypted
  computer backup of the iPhone can include the app's encrypted files together with their Keychain keys, so
  restoring a whole iPhone from such a backup may bring your Resurface data with it. That path has not been
  tested; a Resurface backup is the supported way to move your data.

## Permissions

- **Camera and photos:** only when you choose to take or pick a photo.
- **Notifications:** only if you allow reminders. Today works without them.

## Deleting your data

Deleting an insight removes it, its photo and its history from the device. Discarding an unfinished draft
deletes it from the device; it can't be recovered. Removing the app deletes all of
its data and keys. Backup files you saved elsewhere stay where you put them until you delete them.

## Children

Resurface is not directed at children and does not knowingly collect information from anyone.

## Changes and contact

If this notice changes, the new version will be published with the app update that needs it.
Questions: **[support contact to be confirmed before release]**.

---

## Notă de confidențialitate Resurface

*Ciornă pentru versiunea beta, 24 octombrie 2026.*

**Pe scurt.** Resurface păstrează ce salvezi pe dispozitivul tău. Nu există cont, server sau sincronizare în
cloud. Aplicația nu ne trimite nouă sau altcuiva ideile, fotografiile, notițele sau modul în care o folosești.
Poți șterge totul ștergând ideile din aplicație sau dezinstalând aplicația.

**Ce se păstrează și unde.** Ideile, notițele, sursele, categoriile, favoritele, reflecțiile, istoricul,
setările, ciorna unei idei încă nesalvate (text și detalii, fără fotografie; nu intră în backup și se șterge
când salvezi ideea sau renunți la ciornă) și contoarele de utilizare (de exemplu „idee salvată”, fără textul
tău) sunt într-o bază de date criptată pe dispozitiv. Fotografiile sunt fișiere criptate în spațiul privat al aplicației. Cheile sunt
aleatorii și păstrate în iOS Keychain / Android Keystore. Cât timp salvezi o fotografie, camera, selectorul
de fotografii sau extensia de partajare pot lăsa o copie temporară necriptată în memoria cache a aplicației;
aplicația o șterge după salvare sau anulare și golește aceste foldere la fiecare pornire. Conținutul partajat
din altă aplicație trece necriptat printr-o zonă comună cu extensia de partajare și este citit și șters imediat
ce se deschide aplicația.

**Ce iese de pe dispozitiv.** Implicit, nimic: nu există analiză, reclame sau raportare de erori și aplicația
nu face cereri de rețea proprii. Un backup se creează doar când îl ceri, este criptat cu parola ta și îl
salvezi unde vrei; nu îl putem deschide și nu putem recupera parola. Notificările sunt programate local; textul
ideii apare pe ecranul de blocare doar dacă activezi această opțiune. Pe Android, citirea textului din
fotografii folosește Google ML Kit prin Google Play Services: fotografia este procesată pe dispozitiv, dar
Google Play Services descarcă modelul și, conform condițiilor Google, poate trimite Google informații tehnice
de utilizare și performanță. Pe iOS se folosește Apple Vision, pe dispozitiv. Pe Android aplicația nu intră în
backupul sistemului. Pe iOS, un backup iCloud sau un backup criptat pe computer al iPhone-ului poate conține
fișierele criptate împreună cu cheile lor din Keychain, așa că restaurarea întregului iPhone poate aduce și
datele Resurface; acest lucru nu a fost testat, iar metoda recomandată pentru mutarea datelor este un backup
Resurface.

**Permisiuni.** Camera și fotografiile, doar când alegi să faci sau să selectezi o fotografie. Notificările,
doar dacă permiți mementourile; Azi funcționează și fără ele.

**Ștergere.** Ștergerea unei idei elimină ideea, fotografia și istoricul ei. Dezinstalarea aplicației șterge
toate datele și cheile. Fișierele de backup salvate în altă parte rămân acolo până le ștergi.

**Contact:** **[contact de suport de confirmat înainte de lansare]**.
