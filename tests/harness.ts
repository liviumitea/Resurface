import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ResurfaceEvent } from "../src/domain";
import { MIGRATIONS, type MigrationDatabase } from "../src/migrations";
import { createStore, type StoreDatabase } from "../src/store";

/** Applies the production migrations synchronously, as `runMigrations` would on a new database. */
export function applyMigrations(sqlite: DatabaseSync): void {
  for (const migration of MIGRATIONS) {
    sqlite.exec(migration.sql);
    sqlite.exec(`PRAGMA user_version = ${migration.version}`);
  }
}

/** node:sqlite adapter for the migration runner. */
export function migrationDatabase(sqlite: DatabaseSync): MigrationDatabase {
  return {
    execAsync: async (source) => { sqlite.exec(source); },
    getFirstAsync: async <T>(source: string) => (sqlite.prepare(source).get() as T | undefined) ?? null,
    withTransactionAsync: async (task) => {
      sqlite.exec("BEGIN");
      try { await task(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

/** Runs the production store over node:sqlite, the same SQLite engine family SQLCipher wraps. */
export function harness(start: Date) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);
  const plain = <T>(row: unknown) => ({ ...(row as object) }) as T;
  const database: StoreDatabase = {
    runAsync: async (source, ...params) => ({ changes: Number(sqlite.prepare(source).run(...(params as SQLInputValue[])).changes) }),
    getFirstAsync: async <T>(source: string, ...params: (string | number | null)[]) => {
      const row = sqlite.prepare(source).get(...(params as SQLInputValue[]));
      return row ? plain<T>(row) : null;
    },
    getAllAsync: async <T>(source: string, ...params: (string | number | null)[]) =>
      sqlite.prepare(source).all(...(params as SQLInputValue[])).map((row) => plain<T>(row)),
    withTransactionAsync: async (task) => {
      sqlite.exec("BEGIN");
      try { await task(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  let current = new Date(start);
  let counter = 0;
  const open = () => createStore({ db: () => database, id: () => `id-${String(++counter).padStart(4, "0")}`, now: () => new Date(current) });
  return {
    sqlite,
    store: open(),
    /** A fresh store over the same database, as after an app restart. */
    restart: open,
    setClock: (next: Date) => { current = new Date(next); },
    clock: () => new Date(current),
    events: (insightId: string) => sqlite.prepare("SELECT * FROM events WHERE insightId = ? ORDER BY scheduledAt").all(insightId).map((row) => plain<ResurfaceEvent>(row)),
    pending: (insightId: string) => sqlite.prepare("SELECT * FROM events WHERE insightId = ? AND shownAt IS NULL AND cancelledAt IS NULL").all(insightId).map((row) => plain<ResurfaceEvent>(row)),
    close: () => sqlite.close(),
  };
}

export const local = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute);
export const calendarDaysAfter = (from: Date, days: number) =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds());
