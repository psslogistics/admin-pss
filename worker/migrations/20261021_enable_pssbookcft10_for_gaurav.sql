-- Enable the Delhivery B2B booking account only for itismeoogway@gmail.com.
-- The Worker secret is account-scoped and is rotated from the stored login
-- credentials; this policy only controls booking visibility for this client.
UPDATE provider_accounts
SET status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE provider = 'delhivery'
  AND upper(trim(account_name)) = 'PSSBOOKCFT10 B2BC'
  AND credential_secret_name = 'DELHIVERY_TOKEN_PSSBOOKCFT10_B2BC';

INSERT INTO provider_account_client_policies (
  provider_account_id, client_id, enabled, priority, confidence_score,
  rate_card_id, notes, updated_by_user_id, updated_at
)
SELECT pa.id,
       '515f3d94-496d-4376-84e4-84d70d9fc068',
       1,
       10,
       100,
       '57bdb049-28a7-472d-a235-7a3166ade1ed',
       'Enabled PSSBOOKCFT10 B2BC for itismeoogway@gmail.com; account-scoped Delhivery credential.',
       'system',
       CURRENT_TIMESTAMP
FROM provider_accounts pa
WHERE pa.provider = 'delhivery'
  AND pa.status = 'active'
  AND upper(trim(pa.account_name)) = 'PSSBOOKCFT10 B2BC'
  AND pa.credential_secret_name = 'DELHIVERY_TOKEN_PSSBOOKCFT10_B2BC'
ON CONFLICT(provider_account_id, client_id) DO UPDATE SET
  enabled = excluded.enabled,
  priority = excluded.priority,
  confidence_score = excluded.confidence_score,
  rate_card_id = excluded.rate_card_id,
  notes = excluded.notes,
  updated_by_user_id = excluded.updated_by_user_id,
  updated_at = excluded.updated_at;
