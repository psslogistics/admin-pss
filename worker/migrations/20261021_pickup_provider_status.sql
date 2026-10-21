-- Persist provider-derived pickup state separately from requested/local state.
ALTER TABLE pickup_requests ADD COLUMN provider_picked_count INTEGER;
ALTER TABLE pickup_requests ADD COLUMN provider_expected_count INTEGER;
ALTER TABLE pickup_requests ADD COLUMN provider_status_synced_at TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_status_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_pickup_requests_provider_reference
  ON pickup_requests(provider, provider_reference, provider_status_synced_at);
