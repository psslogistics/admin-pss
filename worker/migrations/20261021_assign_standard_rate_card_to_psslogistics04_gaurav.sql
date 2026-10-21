-- Assign the existing Standard rate card to PSSLOGISTICS04 for itismeoogway@gmail.com.
UPDATE provider_account_client_policies
SET rate_card_id = '57bdb049-28a7-472d-a235-7a3166ade1ed',
    notes = 'PSSLOGISTICS04 B2BC enabled with the existing Standard rate card for itismeoogway@gmail.com.',
    updated_by_user_id = 'system',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_account_id = 'dlv-psslogistics04-b2bc'
  AND client_id = '515f3d94-496d-4376-84e4-84d70d9fc068'
  AND enabled = 1;
