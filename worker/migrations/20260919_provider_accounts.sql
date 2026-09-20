CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('delhivery', 'ekart')),
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

CREATE INDEX IF NOT EXISTS provider_accounts_client_idx ON provider_accounts(client_id, provider, status);
CREATE INDEX IF NOT EXISTS provider_accounts_provider_idx ON provider_accounts(provider, status);
