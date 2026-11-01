-- Keep the Delhivery freight-breakup reconciliation cadence independent from
-- tracking refreshes so frequent tracking calls cannot starve weight updates.
ALTER TABLE weight_reconciliations
  ADD COLUMN provider_weight_last_attempt_at TEXT;
