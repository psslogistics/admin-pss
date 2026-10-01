ALTER TABLE shipments ADD COLUMN pss_reference TEXT;

UPDATE shipments
SET pss_reference = printf('%013d', 7000000000000 + rowid)
WHERE pss_reference IS NULL OR trim(pss_reference) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_pss_reference
  ON shipments(pss_reference);
