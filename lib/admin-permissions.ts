export type PermissionKey =
  | "admin.dashboard.view" | "admin.clients.view" | "admin.tasks.view" | "admin.tasks.manage"
  | "admin.activity.view" | "admin.booking.view" | "admin.booking.create" | "admin.tracking.view"
  | "admin.tracking.update" | "admin.pickup.view" | "admin.pickup.create" | "admin.pickup.assign"
  | "admin.reports.view" | "admin.reports.export" | "admin.rate_cards.view" | "admin.rate_cards.manage"
  | "admin.support.view" | "admin.tickets.create" | "admin.tickets.reply" | "admin.tickets.close" | "admin.tickets.reassign"
  | "admin.notifications.view" | "admin.profile.view" | "admin.profile.edit" | "admin.settings.view";

export const ADMIN_PERMISSION_KEYS = new Set<string>([
  "admin.dashboard.view", "admin.clients.view", "admin.tasks.view", "admin.tasks.manage", "admin.activity.view",
  "admin.booking.view", "admin.booking.create", "admin.tracking.view", "admin.tracking.update",
  "admin.pickup.view", "admin.pickup.create", "admin.pickup.assign", "admin.reports.view", "admin.reports.export",
  "admin.rate_cards.view", "admin.rate_cards.manage", "admin.support.view", "admin.tickets.create", "admin.tickets.reply",
  "admin.tickets.close", "admin.tickets.reassign", "admin.notifications.view", "admin.profile.view",
  "admin.profile.edit", "admin.settings.view",
]);

export function isAdminPermission(value: string): value is PermissionKey {
  return ADMIN_PERMISSION_KEYS.has(value);
}
