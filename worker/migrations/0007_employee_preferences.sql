CREATE TABLE IF NOT EXISTS employee_preferences (
  user_id TEXT PRIMARY KEY,
  email_notifications INTEGER NOT NULL DEFAULT 1,
  task_reminders INTEGER NOT NULL DEFAULT 1,
  compact_layout INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
