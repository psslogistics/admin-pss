-- Keep every Delhivery account named by the business visible to operations.
-- The four entries below remain disabled until their provider credential is
-- added as a Worker secret and Delhivery confirms account activation.
INSERT OR IGNORE INTO provider_accounts
  (id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, status, created_by_user_id)
VALUES
  ('dlv-psslogistics15-b2bc', 'delhivery', 'PSSLOGISTICS15 B2BC', 'production', 'DELHIVERY_TOKEN_PSSLOGISTICS15_B2BC', NULL, '[]', 'disabled', 'system:migration'),
  ('dlv-pssbookcft10-b2bc', 'delhivery', 'PSSBOOKCFT10 B2BC', 'production', 'DELHIVERY_TOKEN_PSSBOOKCFT10_B2BC', NULL, '[]', 'disabled', 'system:migration'),
  ('dlv-psschandigarhcargo6-b2bc', 'delhivery', 'PSSCHANDIGARHCARGO6 B2BC', 'production', 'DELHIVERY_TOKEN_PSSCHANDIGARHCARGO6_B2BC', NULL, '[]', 'disabled', 'system:migration'),
  ('dlv-psslogistics10-b2bc', 'delhivery', 'PSSLOGISTICS10 B2BC', 'production', 'DELHIVERY_TOKEN_PSSLOGISTICS10_B2BC', NULL, '[]', 'disabled', 'system:migration');
