CREATE TABLE pricing_charge_rules_new (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  calculation_type TEXT NOT NULL CHECK (calculation_type IN ('fixed', 'percent', 'per_kg', 'minimum', 'maximum')),
  value REAL NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'freight',
  minimum_value REAL,
  maximum_value REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  marker TEXT,
  condition TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, code)
);
INSERT INTO pricing_charge_rules_new (id, version_id, code, label, calculation_type, value, basis, minimum_value, maximum_value, enabled, marker, condition, display_order, created_at)
SELECT id, version_id, code, label, calculation_type, value, basis, minimum_value, NULL, enabled, marker, condition, display_order, created_at
FROM pricing_charge_rules;
DROP TABLE pricing_charge_rules;
ALTER TABLE pricing_charge_rules_new RENAME TO pricing_charge_rules;
CREATE INDEX IF NOT EXISTS idx_pricing_charge_rules_lookup ON pricing_charge_rules(version_id, display_order, code);
