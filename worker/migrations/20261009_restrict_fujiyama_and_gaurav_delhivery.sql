-- Keep the two named clients on the single Delhivery B2B account requested
-- for production testing. Existing policies are retained as disabled audit
-- history rather than deleted.
UPDATE provider_account_client_policies
SET enabled = 0,
    updated_at = CURRENT_TIMESTAMP,
    notes = 'Disabled: client is restricted to PSSLOGISTICS10 B2BC'
WHERE client_id IN (
  '515f3d94-496d-4376-84e4-84d70d9fc068',
  'bb308dde-aae8-4503-ac7b-f91cd80ada78'
)
AND provider_account_id IN (
  SELECT id FROM provider_accounts WHERE provider = 'delhivery'
);

INSERT INTO provider_account_client_policies (
  provider_account_id, client_id, enabled, priority, confidence_score,
  rate_card_id, notes, updated_by_user_id, updated_at
)
SELECT pa.id, '515f3d94-496d-4376-84e4-84d70d9fc068', 1, 0, 100,
       NULL, 'Only enabled Delhivery account for itismeoogway@gmail.com', 'system', CURRENT_TIMESTAMP
FROM provider_accounts pa
WHERE pa.provider = 'delhivery' AND pa.status = 'active'
  AND upper(trim(pa.account_name)) = 'PSSLOGISTICS10 B2BC'
ON CONFLICT(provider_account_id, client_id) DO UPDATE SET
  enabled = 1, priority = 0, confidence_score = 100,
  notes = excluded.notes, updated_by_user_id = 'system', updated_at = CURRENT_TIMESTAMP;

INSERT INTO provider_account_client_policies (
  provider_account_id, client_id, enabled, priority, confidence_score,
  rate_card_id, notes, updated_by_user_id, updated_at
)
SELECT pa.id, 'bb308dde-aae8-4503-ac7b-f91cd80ada78', 1, 0, 100,
       NULL, 'Only enabled Delhivery account for Fujiyama Power Systems', 'system', CURRENT_TIMESTAMP
FROM provider_accounts pa
WHERE pa.provider = 'delhivery' AND pa.status = 'active'
  AND upper(trim(pa.account_name)) = 'PSSLOGISTICS10 B2BC'
ON CONFLICT(provider_account_id, client_id) DO UPDATE SET
  enabled = 1, priority = 0, confidence_score = 100,
  notes = excluded.notes, updated_by_user_id = 'system', updated_at = CURRENT_TIMESTAMP;
