CREATE TABLE IF NOT EXISTS pricing_versions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'delhivery',
  service_level TEXT NOT NULL DEFAULT 'b2b',
  status TEXT NOT NULL DEFAULT 'draft',
  effective_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_rate_card_id TEXT,
  minimum_weight_kg REAL NOT NULL DEFAULT 20,
  volumetric_divisor REAL NOT NULL DEFAULT 5000,
  gst_percent REAL NOT NULL DEFAULT 18,
  created_by_user_id TEXT NOT NULL,
  published_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_versions_active ON pricing_versions(client_id) WHERE provider = 'delhivery' AND service_level = 'b2b' AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_pricing_versions_client ON pricing_versions(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pricing_rate_matrix (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  account_scope TEXT NOT NULL CHECK (account_scope IN ('04', '08', 'other')),
  origin_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  rate_per_kg REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, account_scope, origin_zone, destination_zone)
);
CREATE INDEX IF NOT EXISTS idx_pricing_matrix_lookup ON pricing_rate_matrix(version_id, account_scope, origin_zone, destination_zone);

CREATE TABLE IF NOT EXISTS pricing_charge_rules (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  calculation_type TEXT NOT NULL CHECK (calculation_type IN ('fixed', 'percent', 'per_kg', 'minimum')),
  value REAL NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'freight',
  minimum_value REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  marker TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, code)
);
CREATE INDEX IF NOT EXISTS idx_pricing_charge_rules_lookup ON pricing_charge_rules(version_id, display_order, code);

CREATE TABLE IF NOT EXISTS pricing_zone_rules (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL CHECK (match_type IN ('state', 'city', 'pincode')),
  match_value TEXT NOT NULL,
  zone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, match_type, match_value)
);
CREATE INDEX IF NOT EXISTS idx_pricing_zone_rules_lookup ON pricing_zone_rules(version_id, match_type, match_value);

CREATE TABLE IF NOT EXISTS pricing_quotes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  account_scope TEXT NOT NULL,
  origin_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  chargeable_weight_kg REAL NOT NULL,
  client_breakdown_json TEXT NOT NULL,
  internal_breakdown_json TEXT,
  expires_at TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pricing_quotes_client ON pricing_quotes(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pricing_overrides (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  shipment_id TEXT,
  billing_id TEXT,
  component_code TEXT NOT NULL,
  previous_amount REAL NOT NULL,
  new_amount REAL NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pricing_overrides_client ON pricing_overrides(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pricing_shipment_snapshots (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  quote_id TEXT,
  version_id TEXT NOT NULL,
  account_scope TEXT NOT NULL,
  origin_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  chargeable_weight_kg REAL NOT NULL,
  client_breakdown_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_client ON pricing_shipment_snapshots(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS weight_reconciliation_tickets (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL UNIQUE,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  deadline_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  resolved_by_user_id TEXT,
  resolution_reason TEXT,
  client_credit_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_weight_reconciliation_tickets_client ON weight_reconciliation_tickets(client_id, status, deadline_at);

CREATE TABLE IF NOT EXISTS delhivery_b2b_pincode_zones (
  pincode TEXT PRIMARY KEY,
  facility_city TEXT NOT NULL,
  facility_state TEXT NOT NULL,
  oda INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_delhivery_b2b_pincode_state ON delhivery_b2b_pincode_zones(facility_state, facility_city);
