import assert from "node:assert/strict";
import test from "node:test";
import { canPerformTicketAction } from "../src/ticket-access-policy.ts";

const identity = (roles, permissions = [], scopes = [], overrides = {}) => ({
  system: false,
  kind: "user",
  roles: new Set(roles),
  permissions: new Set(permissions),
  scopes: new Set(scopes),
  ...overrides,
});

test("staff create grant cannot be used to reply", () => {
  const staff = identity(["employee"], ["admin.tickets.create"]);
  assert.equal(canPerformTicketAction(staff, "create"), true);
  assert.equal(canPerformTicketAction(staff, "reply"), false);
});

test("staff reply grant cannot be used to create tickets", () => {
  const staff = identity(["employee"], ["admin.tickets.reply"]);
  assert.equal(canPerformTicketAction(staff, "reply"), true);
  assert.equal(canPerformTicketAction(staff, "create"), false);
});

test("legacy staff ticket grants remain supported for their matching action", () => {
  const staff = identity(["employee"], ["tickets.create", "tickets.reply"]);
  assert.equal(canPerformTicketAction(staff, "create"), true);
  assert.equal(canPerformTicketAction(staff, "reply"), true);
});

test("API keys and clients retain the existing ticket flow", () => {
  const api = identity([], [], ["tickets.create"], { kind: "api" });
  const client = identity(["client"]);
  assert.equal(canPerformTicketAction(api, "create"), true);
  assert.equal(canPerformTicketAction(api, "reply"), true);
  assert.equal(canPerformTicketAction(client, "create"), true);
  assert.equal(canPerformTicketAction(client, "reply"), true);
});

test("system identity retains full ticket access", () => {
  assert.equal(canPerformTicketAction(identity([], [], [], { system: true }), "create"), true);
  assert.equal(canPerformTicketAction(identity([], [], [], { system: true }), "reply"), true);
});
