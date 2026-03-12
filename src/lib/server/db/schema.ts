// Re-export the SQLite schema for use by drizzle-kit and the app.
// DB type detection is handled in index.ts based on DATABASE_URL.
export * from './schema-sqlite';
