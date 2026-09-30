CREATE TABLE IF NOT EXISTS delhivery_b2b_pincode_datasets (
  id TEXT PRIMARY KEY,
  source_filename TEXT NOT NULL,
  source_object_key TEXT,
  source_sha256 TEXT,
  expected_row_count INTEGER NOT NULL,
  imported_row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'validated', 'active', 'retired', 'failed')),
  error_message TEXT,
  uploaded_by_user_id TEXT NOT NULL,
  published_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delhivery_b2b_pincode_datasets_status ON delhivery_b2b_pincode_datasets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS delhivery_b2b_pincode_dataset_rows (
  dataset_id TEXT NOT NULL REFERENCES delhivery_b2b_pincode_datasets(id) ON DELETE CASCADE,
  pincode TEXT NOT NULL,
  facility_city TEXT NOT NULL,
  facility_state TEXT NOT NULL,
  oda INTEGER NOT NULL DEFAULT 0 CHECK (oda IN (0, 1)),
  PRIMARY KEY (dataset_id, pincode)
);
CREATE INDEX IF NOT EXISTS idx_delhivery_b2b_pincode_dataset_rows_lookup ON delhivery_b2b_pincode_dataset_rows(dataset_id, pincode);
