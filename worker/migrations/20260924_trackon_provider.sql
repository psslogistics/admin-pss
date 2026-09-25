-- Expand the provider account allow-list without changing existing rows.
-- SQLite cannot alter a CHECK constraint in place, so copy the table while
-- preserving the existing account ids, secrets, scopes, status, and timestamps.
PRAGMA foreign_keys = OFF;

CREATE TABLE provider_accounts_trackon (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('delhivery', 'ekart', 'trackon')),
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'production',
  credential_secret_name TEXT NOT NULL,
  client_id TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, account_name)
);

INSERT INTO provider_accounts_trackon
  (id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, status, created_by_user_id, created_at, updated_at)
SELECT id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, status, created_by_user_id, created_at, updated_at
FROM provider_accounts;

DROP TABLE provider_accounts;
ALTER TABLE provider_accounts_trackon RENAME TO provider_accounts;

CREATE INDEX IF NOT EXISTS provider_accounts_client_idx ON provider_accounts(client_id, provider, status);
CREATE INDEX IF NOT EXISTS provider_accounts_provider_idx ON provider_accounts(provider, status);

PRAGMA foreign_keys = ON;
