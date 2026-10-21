-- Enable PSSLOGISTICS04 B2BC for itismeoogway@gmail.com only.
INSERT INTO provider_account_client_policies (
  provider_account_id, client_id, enabled, priority, confidence_score,
  rate_card_id, notes, updated_by_user_id, updated_at
)
SELECT pa.id,
       '515f3d94-496d-4376-84e4-84d70d9fc068',
       1,
       100,
       0,
       NULL,
       'Enabled PSSLOGISTICS04 B2BC for itismeoogway@gmail.com.',
       'system',
       CURRENT_TIMESTAMP
FROM provider_accounts pa
WHERE pa.id = 'dlv-psslogistics04-b2bc'
  AND pa.provider = 'delhivery'
  AND pa.status = 'active'
ON CONFLICT(provider_account_id, client_id) DO UPDATE SET
  enabled = excluded.enabled,
  priority = excluded.priority,
  confidence_score = excluded.confidence_score,
  rate_card_id = excluded.rate_card_id,
  notes = excluded.notes,
  updated_by_user_id = excluded.updated_by_user_id,
  updated_at = excluded.updated_at;
