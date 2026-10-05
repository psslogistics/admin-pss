-- PSS standard ODA surcharge: max(INR 750, chargeable_weight_kg * INR 3).
-- The pricing engine represents this as a per-kg rule with a minimum amount.
-- Apply the approved standard to the known legacy defaults; preserve any
-- client-specific exception that was already configured deliberately.
UPDATE pricing_charge_rules
SET value = 3,
    minimum_value = 750,
    label = 'ODA surcharge',
    marker = '*',
    condition = 'oda_or_opa'
WHERE code = 'oda'
  AND ((value = 2 AND minimum_value = 450)
    OR (value = 100 AND minimum_value IS NULL));
