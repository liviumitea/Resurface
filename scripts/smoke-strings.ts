// Prints the UI strings the iOS smoke script looks for, in every app language, from src/i18n.ts.
import { t, type MessageKey } from "../src/i18n";

const keys = [
  "today.settings", "nav.today", "nav.capture", "nav.library", "library.title",
  "library.status.active", "library.status.paused", "library.status.archived", "settings.title",
  "common.back", "choice.title", "common.cancel", "category.manage", "category.screenTitle",
  "settings.restoreBackup", "backup.replaceTitle",
] as const satisfies readonly MessageKey[];

const table = Object.fromEntries((["en", "ro"] as const).map((language) => [language, Object.fromEntries(keys.map((key) => [key, t(key, {}, language)]))]));
process.stdout.write(JSON.stringify(table));
