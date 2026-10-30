import assert from "node:assert/strict";
import test from "node:test";
import { TICKET_ATTENTION_SQL } from "../src/ticket-attention.ts";

test("organization attention predicate covers escalation, breached and due-soon SLA, and unassigned tickets", () => {
  assert.match(TICKET_ATTENTION_SQL, /IN \('escalated', 'overdue'\)/);
  assert.match(TICKET_ATTENTION_SQL, /datetime\(sla_due_at\) <= datetime\('now', '\+1 day'\)/);
  assert.match(TICKET_ATTENTION_SQL, /assigned_to_user_id IS NULL/);
  assert.match(TICKET_ATTENTION_SQL, /trim\(assigned_to_user_id\) = ''/);
});
