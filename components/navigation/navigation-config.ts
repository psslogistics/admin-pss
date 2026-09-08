import type { IconName } from "@/lib/iconography";
import type { PermissionKey } from "@/lib/employee-data";

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
    items: [{ title: "Dashboard", href: "/dashboard", icon: "dashboard", permission: "dashboard.view" }],
  },
  {
    label: "My work",
    items: [
      { title: "My Clients", href: "/dashboard/myClients", icon: "clients", permission: "clients.view" },
      { title: "My Tasks", href: "/dashboard/myTasks", icon: "tasks", permission: "tasks.view" },
      { title: "My Activity", href: "/dashboard/myActivity", icon: "employeeActivity", permission: "activity.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Booking", href: "/dashboard/booking", icon: "createShipment", permission: "booking.view" },
      { title: "Tracking", href: "/dashboard/tracking", icon: "shipment", permission: "tracking.view" },
      { title: "Pickup", href: "/dashboard/pickup", icon: "pickups", permission: "pickup.view" },
      { title: "Reports", href: "/dashboard/reports", icon: "reports", permission: "reports.view" },
      { title: "Rate Cards", href: "/dashboard/rate-cards", icon: "reports", permission: "rate_cards.manage" },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Notifications", href: "/dashboard/notifications", icon: "notifications", permission: "notifications.view" },
      { title: "Support", href: "/dashboard/support", icon: "support", permission: "support.view" },
      { title: "Profile", href: "/dashboard/profile", icon: "user", permission: "profile.view" },
      { title: "Settings", href: "/dashboard/settings", icon: "settings", permission: "settings.view" },
    ],
  },
];

export const allNavigationItems = navigationGroups.flatMap((group) => group.items);
