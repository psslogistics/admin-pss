import type { IconName } from "@/lib/iconography";

export type NavigationItem = {
  title: string;
  href: string;
  icon: IconName;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/dashboard", icon: "dashboard" }],
  },
  {
    label: "My work",
    items: [
      { title: "My Clients", href: "/dashboard/myClients", icon: "clients" },
      { title: "My Tasks", href: "/dashboard/myTasks", icon: "tasks" },
      { title: "My Activity", href: "/dashboard/myActivity", icon: "employeeActivity" },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Notifications", href: "/dashboard/notifications", icon: "notifications" },
      { title: "Support", href: "/dashboard/support", icon: "support" },
      { title: "Profile", href: "/dashboard/profile", icon: "user" },
      { title: "Settings", href: "/dashboard/settings", icon: "settings" },
    ],
  },
];

export const allNavigationItems = navigationGroups.flatMap((group) => group.items);
