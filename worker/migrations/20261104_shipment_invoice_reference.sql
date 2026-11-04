ALTER TABLE shipments ADD COLUMN invoice_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_shipments_invoice_reference
  ON shipments(invoice_reference);
