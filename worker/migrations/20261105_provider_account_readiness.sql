-- Provider accounts are inventory records; they are not client-ready merely
-- because a row is active.  Readiness is explicit and is required by every
-- live booking/pickup path.
ALTER TABLE provider_accounts ADD COLUMN activation_status TEXT NOT NULL DEFAULT 'pending_verification';
ALTER TABLE provider_accounts ADD COLUMN available_for_clients INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_accounts ADD COLUMN booking_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_accounts ADD COLUMN tracking_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_accounts ADD COLUMN quotes_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_accounts ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE provider_accounts ADD COLUMN health_error_code TEXT;
ALTER TABLE provider_accounts ADD COLUMN health_error_message TEXT;
ALTER TABLE provider_accounts ADD COLUMN last_health_checked_at TEXT;

-- Preserve only assignments that already existed explicitly.  New accounts
-- remain pending and unavailable until an administrator verifies them.
UPDATE provider_accounts
SET activation_status = 'ready',
    available_for_clients = 1,
    booking_enabled = 1,
    tracking_enabled = 1,
    quotes_enabled = 1,
    health_status = 'unknown'
WHERE status = 'active'
  AND id IN (
    SELECT provider_account_id
    FROM provider_account_client_policies
    WHERE enabled = 1
  );

CREATE INDEX IF NOT EXISTS provider_accounts_readiness_idx
  ON provider_accounts(provider, status, activation_status, available_for_clients, booking_enabled);
