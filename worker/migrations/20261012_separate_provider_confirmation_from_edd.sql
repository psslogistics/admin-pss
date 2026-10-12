-- EDD is a delivery date and must never contain a provider status label.
-- Older bookings persisted the UI placeholder in this column.
UPDATE shipments
SET edd = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE lower(trim(edd)) = 'provider confirmation pending';
