import type { IconName } from "@/lib/iconography";
import type { PermissionKey } from "@/lib/admin-permissions";

export type NavigationItem = {
  title: string;
  href: string;
  icon: IconName;
  permission: PermissionKey;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/dashboard", icon: "dashboard", permission: "admin.dashboard.view" }],
  },
  {
    label: "My work",
    items: [
      { title: "My Clients", href: "/dashboard/myClients", icon: "clients", permission: "admin.clients.view" },
      { title: "My Tasks", href: "/dashboard/myTasks", icon: "tasks", permission: "admin.tasks.view" },
      { title: "My Activity", href: "/dashboard/myActivity", icon: "employeeActivity", permission: "admin.activity.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Booking", href: "/dashboard/booking", icon: "createShipment", permission: "admin.booking.view" },
      { title: "Tracking", href: "/dashboard/tracking", icon: "shipment", permission: "admin.tracking.view" },
      { title: "Pickup", href: "/dashboard/pickup", icon: "pickups", permission: "admin.pickup.view" },
      { title: "Reports", href: "/dashboard/reports", icon: "reports", permission: "admin.reports.view" },
      { title: "Rate Cards", href: "/dashboard/rate-cards", icon: "reports", permission: "admin.rate_cards.view" },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Notifications", href: "/dashboard/notifications", icon: "notifications", permission: "admin.notifications.view" },
      { title: "Support", href: "/dashboard/support", icon: "support", permission: "admin.support.view" },
      { title: "Profile", href: "/dashboard/profile", icon: "user", permission: "admin.profile.view" },
      { title: "Settings", href: "/dashboard/settings", icon: "settings", permission: "admin.settings.view" },
    ],
  },
];

export const allNavigationItems = navigationGroups.flatMap((group) => group.items);
