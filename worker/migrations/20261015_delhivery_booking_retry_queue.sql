ALTER TABLE shipments ADD COLUMN provider_booking_payload_json TEXT;
ALTER TABLE shipments ADD COLUMN provider_retry_at TEXT;
ALTER TABLE shipments ADD COLUMN provider_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN provider_last_error TEXT;
