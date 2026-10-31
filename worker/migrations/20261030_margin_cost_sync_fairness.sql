CREATE INDEX IF NOT EXISTS idx_integration_requests_margin_cost_cooldown
ON integration_requests(provider, operation, idempotency_key, updated_at DESC);
