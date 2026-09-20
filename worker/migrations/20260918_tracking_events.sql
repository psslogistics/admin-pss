-- Compatibility migration for the Worker tracking contract.
-- The Worker uses this normalized event shape for client/public tracking,
-- webhook ingestion, and operational status updates.

CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  location TEXT,
  description TEXT,
  created_by_user_id TEXT,
  event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment_time
  ON tracking_events(shipment_id, event_time);
