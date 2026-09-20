-- Additive production migration: task persistence required by the Admin workspace.

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  shipment_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to_user_id TEXT,
  due_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_client_status ON tasks(client_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assigned_to_user_id, status, due_at);
CREATE TABLE IF NOT EXISTS request_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);
