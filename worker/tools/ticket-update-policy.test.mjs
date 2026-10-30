import test from "node:test";
import assert from "node:assert/strict";
import { ticketUpdatePermissions } from "../src/ticket-update-policy.ts";

test("reassignment requires its dedicated permission", () => {
  assert.deepEqual(ticketUpdatePermissions({ assigned_to_user_id: "employee-1" }), ["tickets.reassign"]);
});

test("resolution and escalation have separate permission requirements", () => {
  assert.deepEqual(ticketUpdatePermissions({ status: "resolved" }), ["tickets.close"]);
  assert.deepEqual(ticketUpdatePermissions({ status: "closed" }), ["tickets.close"]);
  assert.deepEqual(ticketUpdatePermissions({ status: "escalated" }), ["tickets.escalate"]);
});

test("ordinary status updates need no elevated transition permission", () => {
  assert.deepEqual(ticketUpdatePermissions({ status: "in_progress" }), []);
});

test("ticket priority changes remain administrator-only", () => {
  assert.deepEqual(ticketUpdatePermissions({ priority: "urgent" }), ["admin"]);
});
