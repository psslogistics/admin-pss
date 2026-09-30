-- These columns are part of the canonical worker/schema.sql baseline. Keep
-- this migration data-safe for databases created from that baseline; older
-- installations that already ran the original ALTER statements remain
-- compatible because the migration is tracked by Wrangler.

UPDATE support_tickets
SET sla_due_at = datetime(
  created_at,
  CASE lower(priority)
    WHEN 'urgent' THEN '+4 hours'
    WHEN 'high' THEN '+8 hours'
    ELSE '+24 hours'
  END
)
WHERE sla_due_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_sla_state
  ON support_tickets(escalation_state, sla_due_at, status);
