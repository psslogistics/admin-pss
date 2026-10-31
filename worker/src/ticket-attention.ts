// Keep the organization-wide attention count aligned with the ticket queue:
// escalated/overdue, due within 24 hours, and unassigned active tickets need action.
export const TICKET_ATTENTION_SQL = "(lower(COALESCE(status, '')) = 'escalated' OR lower(COALESCE(escalation_state, '')) IN ('escalated', 'overdue') OR (sla_due_at IS NOT NULL AND datetime(sla_due_at) <= datetime('now', '+1 day')) OR assigned_to_user_id IS NULL OR trim(assigned_to_user_id) = '')";
