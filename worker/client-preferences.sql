CREATE TABLE IF NOT EXISTS client_preferences (
  client_id TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
