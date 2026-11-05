export type PermissionKey =
  | "admin.dashboard.view" | "admin.clients.view" | "admin.addresses.view" | "admin.tasks.view" | "admin.tasks.manage" | "admin.tasks.create" | "admin.tasks.edit" | "admin.tasks.complete" | "admin.tasks.assign"
  | "admin.activity.view" | "admin.audit.export" | "admin.billing.export" | "admin.booking.view" | "admin.booking.create" | "admin.bookings.documents.manage" | "admin.tracking.view" | "admin.tracking.refresh"
  | "admin.tracking.update" | "admin.tracking.intervene" | "admin.pickup.view" | "admin.pickup.create" | "admin.pickup.assign" | "admin.pickup.cancel" | "admin.pickup.update_status"
  | "admin.shipments.view" | "admin.shipments.export" | "admin.shipments.assigned.view" | "admin.shipments.sensitive.view" | "admin.shipments.cancel" | "admin.shipments.edit"
  | "admin.documents.pod.view" | "admin.documents.pod.download" | "admin.documents.label.view" | "admin.documents.label.download" | "admin.exceptions.view" | "admin.exceptions.manage" | "admin.exceptions.assign" | "admin.exceptions.resolve"
  | "admin.weight.view" | "admin.weight.manage" | "admin.weight.resolve"
  | "admin.reports.view" | "admin.reports.export" | "admin.rate_cards.view" | "admin.rate_cards.manage" | "admin.rate_cards.publish" | "admin.returns.view" | "admin.returns.manage"
  | "admin.pricing.view" | "admin.pricing.manage" | "admin.pricing.publish" | "admin.pricing.override" | "admin.provider_cost.view" | "admin.couriers.view"
  | "admin.support.view" | "admin.tickets.view" | "admin.tickets.create" | "admin.tickets.reply" | "admin.tickets.close" | "admin.tickets.reassign" | "admin.tickets.escalate" | "admin.transactions.export" | "admin.wallet.view"
  | "admin.notifications.view" | "admin.security.view" | "admin.security.session_revoke" | "admin.profile.view" | "admin.profile.edit" | "admin.settings.view";

export const ADMIN_PERMISSION_KEYS = new Set<string>([
  "admin.dashboard.view", "admin.clients.view", "admin.addresses.view", "admin.tasks.view", "admin.tasks.manage", "admin.tasks.create", "admin.tasks.edit", "admin.tasks.complete", "admin.tasks.assign", "admin.activity.view",
  "admin.booking.view", "admin.booking.create", "admin.bookings.documents.manage", "admin.audit.export", "admin.billing.export", "admin.transactions.export", "admin.tracking.view", "admin.tracking.refresh", "admin.tracking.update", "admin.tracking.intervene",
  "admin.pickup.view", "admin.pickup.create", "admin.pickup.assign", "admin.pickup.cancel", "admin.pickup.update_status", "admin.shipments.view", "admin.shipments.export", "admin.shipments.assigned.view", "admin.shipments.sensitive.view", "admin.shipments.cancel", "admin.shipments.edit", "admin.documents.pod.view", "admin.documents.pod.download", "admin.documents.label.view", "admin.documents.label.download", "admin.exceptions.view", "admin.exceptions.manage", "admin.exceptions.assign", "admin.exceptions.resolve", "admin.weight.view", "admin.weight.manage", "admin.weight.resolve", "admin.reports.view", "admin.reports.export",
  "admin.rate_cards.view", "admin.rate_cards.manage", "admin.rate_cards.publish", "admin.returns.view", "admin.returns.manage", "admin.support.view", "admin.tickets.view", "admin.tickets.create", "admin.tickets.reply",
  "admin.tickets.close", "admin.tickets.reassign", "admin.tickets.escalate", "admin.notifications.view", "admin.security.view", "admin.security.session_revoke", "admin.profile.view", "admin.wallet.view",
  "admin.profile.edit", "admin.settings.view", "admin.pricing.view", "admin.pricing.manage",
  "admin.pricing.publish", "admin.pricing.override", "admin.provider_cost.view", "admin.couriers.view",
]);

export function isAdminPermission(value: string): value is PermissionKey {
  return ADMIN_PERMISSION_KEYS.has(value);
}
