-- Preserve the dimension groups submitted during shipment booking so the
-- client tracking pane can display the booked measurements later.
ALTER TABLE shipments ADD COLUMN dimensions_json TEXT;
