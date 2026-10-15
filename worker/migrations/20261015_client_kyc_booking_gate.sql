-- Preserve the approved client identity values used for each shipment booking.
ALTER TABLE shipments ADD COLUMN client_gst_number TEXT;
ALTER TABLE shipments ADD COLUMN client_pan_number TEXT;
ALTER TABLE shipments ADD COLUMN kyc_version INTEGER;
