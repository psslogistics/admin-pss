-- Persist whether a saved client address is used as a consignor or consignee.
ALTER TABLE client_addresses ADD COLUMN address_kind TEXT NOT NULL DEFAULT 'consignor';
CREATE INDEX IF NOT EXISTS idx_client_addresses_client_kind ON client_addresses(client_id, address_kind, status);
