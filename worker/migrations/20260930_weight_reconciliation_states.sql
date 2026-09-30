ALTER TABLE weight_reconciliations ADD COLUMN declared_volumetric_weight_kg REAL;
ALTER TABLE weight_reconciliations ADD COLUMN initial_billable_weight_kg REAL;
ALTER TABLE weight_reconciliations ADD COLUMN courier_billed_weight_kg REAL;
ALTER TABLE weight_reconciliations ADD COLUMN client_dispute_deadline_at TEXT;
ALTER TABLE weight_reconciliations ADD COLUMN provider_dispute_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE weight_reconciliations ADD COLUMN provider_recovery_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE weight_reconciliations ADD COLUMN retained_recovery_amount REAL NOT NULL DEFAULT 0;
