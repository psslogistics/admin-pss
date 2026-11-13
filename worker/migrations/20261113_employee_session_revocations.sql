-- Employee logout revocation. Supabase access tokens remain cryptographically
-- valid until expiry, so the Employee Panel records an explicit logout hash
-- and the Worker rejects replayed requests immediately.
CREATE TABLE IF NOT EXISTS employee_session_revocations (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours'))
);

CREATE INDEX IF NOT EXISTS idx_employee_session_revocations_expiry
  ON employee_session_revocations(expires_at);
