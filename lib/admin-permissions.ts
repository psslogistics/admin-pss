export type PermissionKey =
  | "admin.dashboard.view" | "admin.clients.view" | "admin.tasks.view" | "admin.tasks.manage"
  | "admin.activity.view" | "admin.booking.view" | "admin.booking.create" | "admin.tracking.view"
  | "admin.tracking.update" | "admin.pickup.view" | "admin.pickup.create" | "admin.pickup.assign"
  | "admin.shipments.view" | "admin.shipments.export" | "admin.shipments.assigned.view" | "admin.shipments.sensitive.view"
  | "admin.documents.pod.view" | "admin.documents.pod.download" | "admin.exceptions.view" | "admin.exceptions.manage"
  | "admin.weight.view" | "admin.weight.manage" | "admin.weight.resolve"
  | "admin.reports.view" | "admin.reports.export" | "admin.rate_cards.view" | "admin.rate_cards.manage"
  | "admin.pricing.view" | "admin.pricing.manage" | "admin.pricing.publish" | "admin.pricing.override" | "admin.provider_cost.view"
  | "admin.support.view" | "admin.tickets.create" | "admin.tickets.reply" | "admin.tickets.close" | "admin.tickets.reassign"
  | "admin.notifications.view" | "admin.profile.view" | "admin.profile.edit" | "admin.settings.view";

export const ADMIN_PERMISSION_KEYS = new Set<string>([
  "admin.dashboard.view", "admin.clients.view", "admin.tasks.view", "admin.tasks.manage", "admin.activity.view",
  "admin.booking.view", "admin.booking.create", "admin.tracking.view", "admin.tracking.update",
  "admin.pickup.view", "admin.pickup.create", "admin.pickup.assign", "admin.shipments.view", "admin.shipments.export", "admin.shipments.assigned.view", "admin.shipments.sensitive.view", "admin.documents.pod.view", "admin.documents.pod.download", "admin.exceptions.view", "admin.exceptions.manage", "admin.weight.view", "admin.weight.manage", "admin.weight.resolve", "admin.reports.view", "admin.reports.export",
  "admin.rate_cards.view", "admin.rate_cards.manage", "admin.support.view", "admin.tickets.create", "admin.tickets.reply",
  "admin.tickets.close", "admin.tickets.reassign", "admin.notifications.view", "admin.profile.view",
  "admin.profile.edit", "admin.settings.view", "admin.pricing.view", "admin.pricing.manage",
  "admin.pricing.publish", "admin.pricing.override", "admin.provider_cost.view",
]);

export function isAdminPermission(value: string): value is PermissionKey {
  return ADMIN_PERMISSION_KEYS.has(value);
}
