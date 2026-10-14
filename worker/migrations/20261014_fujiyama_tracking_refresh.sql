ALTER TABLE shipments ADD COLUMN provider_last_attempt_at TEXT;
ALTER TABLE shipments ADD COLUMN provider_last_success_at TEXT;
ALTER TABLE shipments ADD COLUMN provider_last_error_code TEXT;
ALTER TABLE shipments ADD COLUMN provider_last_error_message TEXT;

-- The historical Fujiyama upload identifies the shipment by its 9-digit LRN.
-- Keep that value in the canonical LR field so B2B tracking/POD calls use the
-- correct provider identifier instead of relying on a generic PSS reference.
UPDATE shipments
SET lr_number = COALESCE(lr_number, tracking_number)
WHERE client_id = 'bb308dde-aae8-4503-ac7b-f91cd80ada78'
  AND provider = 'delhivery'
  AND provider_account_id = 'dlv-psslogistics10-b2bc'
  AND lr_number IS NULL
  AND tracking_number GLOB '[0-9]*';
