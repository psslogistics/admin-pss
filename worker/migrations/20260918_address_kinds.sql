-- Persist whether a saved client address is used as a consignor or consignee.
-- address_kind is part of the canonical worker/schema.sql baseline.
CREATE INDEX IF NOT EXISTS idx_client_addresses_client_kind ON client_addresses(client_id, address_kind, status);
