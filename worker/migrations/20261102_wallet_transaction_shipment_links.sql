-- Adds explicit shipment identity to wallet ledger entries without changing
-- financial values, statuses, references, or balances. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS wallet_transaction_shipment_links (
  wallet_transaction_id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_shipment_links_client_shipment
  ON wallet_transaction_shipment_links(client_id, shipment_id);

INSERT OR IGNORE INTO wallet_transaction_shipment_links (wallet_transaction_id, shipment_id, client_id)
SELECT w.id,
  CASE
    WHEN w.reference LIKE 'SHIPMENT-%' OR w.reference LIKE 'REVERSAL-%' THEN substr(w.reference, 10)
    WHEN w.reference LIKE 'WEIGHT-DEBIT-%' THEN substr(w.reference, 14)
    WHEN w.reference LIKE 'WEIGHT-CREDIT-%' THEN substr(w.reference, 15)
  END,
  w.client_id
FROM wallet_transactions w
JOIN shipments s
  ON s.client_id = w.client_id
 AND s.id = CASE
    WHEN w.reference LIKE 'SHIPMENT-%' OR w.reference LIKE 'REVERSAL-%' THEN substr(w.reference, 10)
    WHEN w.reference LIKE 'WEIGHT-DEBIT-%' THEN substr(w.reference, 14)
    WHEN w.reference LIKE 'WEIGHT-CREDIT-%' THEN substr(w.reference, 15)
  END
WHERE w.reference LIKE 'SHIPMENT-%'
   OR w.reference LIKE 'REVERSAL-%'
   OR w.reference LIKE 'WEIGHT-DEBIT-%'
   OR w.reference LIKE 'WEIGHT-CREDIT-%';

INSERT OR IGNORE INTO wallet_transaction_shipment_links (wallet_transaction_id, shipment_id, client_id)
SELECT w.id, p.shipment_id, w.client_id
FROM wallet_transactions w
JOIN pricing_overrides p
  ON p.id = substr(w.reference, 18)
 AND p.client_id = w.client_id
JOIN shipments s
  ON s.id = p.shipment_id
 AND s.client_id = w.client_id
WHERE w.reference LIKE 'PRICING-OVERRIDE-%';
