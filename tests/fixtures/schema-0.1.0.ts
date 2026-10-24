/** Frozen copy of the schema the 0.1.0 build created (no user_version). Do not edit. */
export const SCHEMA_0_1_0_SQL = `
  CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT,
    context TEXT,
    imagePath TEXT,
    imageMime TEXT,
    status TEXT NOT NULL CHECK(status IN ('active','paused','archived')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY NOT NULL,
    insightId TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    stage INTEGER NOT NULL,
    scheduledAt TEXT NOT NULL,
    selectedDay TEXT,
    selectedAt TEXT,
    notificationId TEXT,
    notificationPlannedFor TEXT,
    shownAt TEXT,
    completedAt TEXT,
    openedAt TEXT,
    response TEXT,
    valueFeedback TEXT,
    cancelledAt TEXT
  );
  CREATE INDEX IF NOT EXISTS events_due ON events(scheduledAt, shownAt, cancelledAt);
  CREATE INDEX IF NOT EXISTS events_insight ON events(insightId, scheduledAt);
  CREATE TABLE IF NOT EXISTS reflections (
    id TEXT PRIMARY KEY NOT NULL,
    insightId TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    eventId TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS analytics (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`;
