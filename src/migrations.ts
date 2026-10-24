import { SCHEMA_V1_SQL, SCHEMA_V2_SQL, SCHEMA_V3_SQL } from "./storage-queries";

/**
 * Ordered, append-only schema migrations for the encrypted database. The applied version lives in
 * SQLite's `PRAGMA user_version`. Version 0 is either a new, empty database or one created by the
 * 0.1.0 build, which did not record a version; migration 1 is idempotent so both upgrade cleanly.
 */
export type Migration = { version: number; sql: string };

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: SCHEMA_V1_SQL },
  { version: 2, sql: SCHEMA_V2_SQL },
  { version: 3, sql: SCHEMA_V3_SQL },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** The subset of the database API migrations need; expo-sqlite and node:sqlite adapters both provide it. */
export type MigrationDatabase = {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

export type MigrationFailure = "schema_too_new" | "migration_failed";
export class MigrationError extends Error {
  constructor(readonly reason: MigrationFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
  }
}

export async function schemaVersion(db: MigrationDatabase): Promise<number> {
  return (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
}

/**
 * Brings the database to the newest known version. Each migration and its version bump commit in
 * one transaction, so a failure leaves the previous, still-readable version in place and reports a
 * non-destructive error. A database from a newer app is refused rather than touched.
 */
export async function runMigrations(db: MigrationDatabase, migrations: readonly Migration[] = MIGRATIONS): Promise<number> {
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  let current = await schemaVersion(db);
  if (current > latest) {
    throw new MigrationError("schema_too_new", "This data was saved by a newer version of Resurface. Update the app to open it. Nothing was changed.");
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (migration.version !== current + 1) throw new Error(`Migrations must be consecutive; ${migration.version} follows ${current}.`);
    try {
      await db.withTransactionAsync(async () => {
        await db.execAsync(migration.sql);
        // Integer from our own list, so it cannot inject into the PRAGMA.
        await db.execAsync(`PRAGMA user_version = ${migration.version}`);
      });
    } catch (error) {
      throw new MigrationError("migration_failed", "Resurface couldn't update its local data. Your data has not been changed; try again or update the app.", { cause: error });
    }
    current = migration.version;
  }
  return current;
}
