export type TicketUpdatePermission = "tickets.reassign" | "tickets.close" | "tickets.escalate" | "admin";

export function ticketUpdatePermissions(payload: Record<string, unknown>): TicketUpdatePermission[] {
  const permissions: TicketUpdatePermission[] = [];
  if (payload.assigned_to_user_id !== undefined) permissions.push("tickets.reassign");
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (status === "resolved" || status === "closed") permissions.push("tickets.close");
  if (status === "escalated") permissions.push("tickets.escalate");
  if (payload.priority !== undefined) permissions.push("admin");
  return permissions;
}
