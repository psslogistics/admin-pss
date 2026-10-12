-- Keep provider identifiers distinct. Legacy tracking_number/provider_reference
-- remain for compatibility, but new reads and writes must use these typed fields.
ALTER TABLE shipments ADD COLUMN lr_number TEXT;
ALTER TABLE shipments ADD COLUMN master_awb TEXT;
ALTER TABLE shipments ADD COLUMN box_awbs_json TEXT;
ALTER TABLE shipments ADD COLUMN provider_booking_id TEXT;
ALTER TABLE shipments ADD COLUMN provider_pickup_id TEXT;
ALTER TABLE shipments ADD COLUMN provider_sync_status TEXT;
