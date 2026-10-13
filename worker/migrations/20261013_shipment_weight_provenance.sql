ALTER TABLE shipments ADD COLUMN weight_source TEXT NOT NULL DEFAULT 'booking';
ALTER TABLE shipments ADD COLUMN weight_override_kg REAL;
ALTER TABLE shipments ADD COLUMN weight_updated_at TEXT;

UPDATE shipments
SET weight_source = 'sheet',
    weight_updated_at = COALESCE(weight_updated_at, created_at)
WHERE client_id = 'bb308dde-aae8-4503-ac7b-f91cd80ada78'
  AND weight_source = 'booking'
  AND id LIKE 'fujiyama-import-%';
