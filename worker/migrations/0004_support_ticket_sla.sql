ALTER TABLE support_tickets ADD COLUMN sla_due_at TEXT;
ALTER TABLE support_tickets ADD COLUMN escalation_state TEXT NOT NULL DEFAULT 'normal';

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
