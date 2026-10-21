-- Enable PSSLOGISTICS04 B2BC for the active PSS test accounts.
-- PSS Test Client 2026 is intentionally excluded.
INSERT INTO provider_account_client_policies (
  provider_account_id, client_id, enabled, priority, confidence_score,
  rate_card_id, notes, updated_by_user_id, updated_at
)
SELECT pa.id,
       targets.client_id,
       1,
       100,
       0,
       NULL,
       'Enabled PSSLOGISTICS04 B2BC for active PSS test account; PSS Test Client 2026 intentionally excluded.',
       'system',
       CURRENT_TIMESTAMP
FROM provider_accounts pa
CROSS JOIN (
  SELECT '2e20ec99-ff5f-44fd-ba4b-cfc924bb5fdc' AS client_id
  UNION ALL SELECT '27bd305c-2633-42c2-ac63-6fbd64981ef3'
  UNION ALL SELECT '16aa8847-8bb6-4449-b8ee-c4ded0c772b2'
) targets
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
