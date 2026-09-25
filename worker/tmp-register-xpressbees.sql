INSERT OR IGNORE INTO provider_accounts
  (id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, status, created_by_user_id)
VALUES
  ('provider-xpressbees-production', 'xpressbees', 'PSS XpressBees Franchise', 'production', 'XPRESSBEES_CREDENTIALS_JSON', NULL, '["tracking","quotes"]', 'active', 'system');

SELECT provider, account_name, credential_secret_name, capabilities_json, status
FROM provider_accounts
WHERE provider IN ('xpressbees','rivigo');
