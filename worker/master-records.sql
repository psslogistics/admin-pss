CREATE TABLE IF NOT EXISTS master_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  meta TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_master_records_kind_updated ON master_records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_records_client_kind ON master_records(client_id, kind, updated_at DESC);
