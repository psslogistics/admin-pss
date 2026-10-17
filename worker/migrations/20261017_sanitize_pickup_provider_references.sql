-- A Delhivery PUR is numeric. Older pickup rows accidentally stored the
-- internal request ID in provider_reference; keep that only in
-- provider_request_id and remove it from the provider-facing reference.
UPDATE pickup_requests
SET provider_reference = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE provider = 'delhivery'
  AND provider_reference IS NOT NULL
  AND TRIM(provider_reference) <> ''
  AND provider_reference GLOB '*[^0-9]*';
