import {
  Bell,
  ClipboardCheck,
  Headphones,
  LayoutDashboard,
  ListChecks,
  UsersRound,
  Settings,
  UserRound,
} from "lucide-react";

export type NavigationItem = {
  title: string;
  href: string;
  icon: typeof LayoutDashboard;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "My work",
    items: [
      { title: "My Clients", href: "/dashboard/myClients", icon: UsersRound },
      { title: "My Tasks", href: "/dashboard/myTasks", icon: ListChecks },
      { title: "My Activity", href: "/dashboard/myActivity", icon: ClipboardCheck },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Notifications", href: "/dashboard/notifications", icon: Bell },
      { title: "Support", href: "/dashboard/support", icon: Headphones },
      { title: "Profile", href: "/dashboard/profile", icon: UserRound },
      { title: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

export const allNavigationItems = navigationGroups.flatMap((group) => group.items);
