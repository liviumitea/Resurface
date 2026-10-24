/**
 * Kept separate from Expo modules so the same SQL can run in in-memory tests.
 * Schema version 1: the tables of the first released build (0.1.0), written idempotently because
 * that build created them without recording a version. Never edit a released migration; add a new
 * one in `migrations.ts` instead.
 */
export const SCHEMA_V1_SQL = `
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

export const SELECT_TODAY_EXISTING_SQL = `
  SELECT events.* FROM events JOIN insights ON insights.id = events.insightId
  WHERE events.selectedDay = ? AND events.cancelledAt IS NULL AND insights.status = 'active'
  ORDER BY events.selectedAt, events.scheduledAt
`;

export const SELECT_TODAY_DUE_SQL = `
  SELECT events.* FROM events JOIN insights ON insights.id = events.insightId
  WHERE insights.status = 'active' AND events.shownAt IS NULL AND events.cancelledAt IS NULL
    AND events.scheduledAt <= ? AND (events.selectedDay IS NULL OR events.selectedDay <> ?)
  ORDER BY events.scheduledAt ASC, events.id ASC LIMIT ?
`;

export const SELECT_NOTIFICATION_CANDIDATES_SQL = `
  SELECT events.*, insights.content AS content FROM events JOIN insights ON insights.id = events.insightId
  WHERE insights.status = 'active' AND events.shownAt IS NULL AND events.cancelledAt IS NULL
    AND (events.notificationPlannedFor IS NULL OR events.notificationPlannedFor > ?)
  ORDER BY events.scheduledAt ASC, events.id ASC LIMIT 30
`;
