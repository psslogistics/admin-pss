-- Keep legacy 04/08/other rows, but allow exact provider-account scopes too.
ALTER TABLE pricing_rate_matrix RENAME TO pricing_rate_matrix_legacy;
DROP INDEX IF EXISTS idx_pricing_matrix_lookup;
CREATE TABLE pricing_rate_matrix (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  account_scope TEXT NOT NULL,
  origin_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  rate_per_kg REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, account_scope, origin_zone, destination_zone)
);
INSERT INTO pricing_rate_matrix (id, version_id, account_scope, origin_zone, destination_zone, rate_per_kg, created_at)
  SELECT id, version_id, account_scope, origin_zone, destination_zone, rate_per_kg, created_at
  FROM pricing_rate_matrix_legacy;
DROP TABLE pricing_rate_matrix_legacy;
CREATE INDEX IF NOT EXISTS idx_pricing_matrix_lookup
  ON pricing_rate_matrix(version_id, account_scope, origin_zone, destination_zone);
