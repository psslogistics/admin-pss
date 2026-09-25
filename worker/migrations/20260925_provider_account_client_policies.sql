CREATE TABLE IF NOT EXISTS provider_account_client_policies (
  provider_account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 100000),
  confidence_score REAL NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  rate_card_id TEXT,
  notes TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_account_id, client_id),
  FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_account_client_policies_client_idx
  ON provider_account_client_policies(client_id, enabled, priority, confidence_score);

CREATE INDEX IF NOT EXISTS provider_account_client_policies_account_idx
  ON provider_account_client_policies(provider_account_id, enabled);

ALTER TABLE shipments ADD COLUMN provider_account_id TEXT;
CREATE INDEX IF NOT EXISTS shipments_provider_account_idx ON shipments(provider_account_id);
