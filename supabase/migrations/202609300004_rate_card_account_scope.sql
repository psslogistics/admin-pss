-- Delhivery B2B source files are account-specific; extra charge rules remain client-level.
ALTER TABLE public.rate_cards
  ADD COLUMN IF NOT EXISTS account_code text NOT NULL DEFAULT 'other';

ALTER TABLE public.rate_cards
  DROP CONSTRAINT IF EXISTS rate_cards_client_id_key;

ALTER TABLE public.rate_cards
  DROP CONSTRAINT IF EXISTS rate_cards_account_code_check;

ALTER TABLE public.rate_cards
  ADD CONSTRAINT rate_cards_account_code_check
  CHECK (account_code IN ('04', '08', 'other'));

ALTER TABLE public.rate_cards
  ADD CONSTRAINT rate_cards_client_account_key UNIQUE (client_id, account_code);

CREATE INDEX IF NOT EXISTS rate_cards_client_account_idx
  ON public.rate_cards (client_id, account_code, updated_at DESC);
