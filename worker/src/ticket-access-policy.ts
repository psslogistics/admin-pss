export type TicketAccessAction = "create" | "reply";

export type TicketAccessIdentity = {
  system: boolean;
  kind: "user" | "api";
  roles: Set<string>;
  permissions: Set<string>;
  scopes: Set<string>;
};

/** Keep staff ticket creation and conversation replies independently grantable. */
export function canPerformTicketAction(auth: TicketAccessIdentity, action: TicketAccessAction): boolean {
  if (auth.system) return true;
  if (auth.kind === "api") return auth.scopes.has("tickets.create");

  if (["employee", "admin", "super_admin"].some((role) => auth.roles.has(role))) {
    const keys = action === "create"
      ? ["admin.tickets.create", "tickets.create"]
      : ["admin.tickets.reply", "tickets.reply"];
    return keys.some((key) => auth.permissions.has(key));
  }

  if (auth.roles.has("client")) return true;

  // Client ticket UI historically uses the reply permission for both opening
  // and replying; preserve that contract while staff use the granular catalog.
  return action === "create"
    ? auth.permissions.has("tickets.create") || auth.permissions.has("tickets.reply")
    : auth.permissions.has("tickets.reply") || auth.permissions.has("tickets.create");
}
