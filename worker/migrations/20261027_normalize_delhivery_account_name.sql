-- Delhivery's exact account name is PSSBOOKSCFT10 B2BC. Preserve the account
-- id and credential binding while correcting the historical local typo.
UPDATE provider_accounts
SET account_name = 'PSSBOOKSCFT10 B2BC',
    updated_at = CURRENT_TIMESTAMP
WHERE provider = 'delhivery'
  AND upper(trim(account_name)) = 'PSSBOOKCFT10 B2BC';
