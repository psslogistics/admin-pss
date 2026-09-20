CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  manager_user_id TEXT,
  capacity_percent INTEGER NOT NULL DEFAULT 100 CHECK (capacity_percent BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS departments_status_idx ON departments(status);
CREATE INDEX IF NOT EXISTS departments_manager_user_id_idx ON departments(manager_user_id);
