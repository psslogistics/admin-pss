export type PermissionKey =
  | "dashboard.view" | "clients.view" | "booking.view" | "tracking.view" | "pickup.view" | "reports.view"
  | "tasks.view" | "tasks.manage" | "activity.view" | "notifications.view" | "support.view" | "tickets.manage"
  | "profile.view" | "settings.view";

export type TaskStatus = "In progress" | "Pending" | "Completed";
export type TaskPriority = "High" | "Medium" | "Low";
export type TicketStatus = "Open" | "In progress" | "Waiting" | "Resolved" | "Closed";
export type TicketSlaState = "Healthy" | "Due soon" | "Escalated";

export type DemoEmployee = { id: string; name: string; initials: string; role: string; email: string; employeeId: string; workspace: string; assignedClientIds: string[]; permissions: PermissionKey[]; panelRole: "admin" };
export type EmployeeTask = { id: string; title: string; context: string; due: string; dueAt?: string; status: TaskStatus; priority: TaskPriority; clientId?: string };
export type EmployeeActivity = { id: string; title: string; detail: string; time: string; tone: "blue" | "green" | "amber" | "slate" };
export type DemoNotification = { id: string; title: string; detail: string; tone: "warning" | "info" | "success"; read: boolean; href?: string };
export type AssignedClient = { id: string; name: string; contact: string; location: string; shipments: number; status: string; lastActivity: string };
export type DemoShipment = { id: string; route: string; status: string; eta: string; clientId: string };
export type DemoTicket = { id: string; clientId: string; title: string; description: string; status: TicketStatus; priority: "Urgent" | "High" | "Normal"; createdAt: string; messages: { id: string; author: string; body: string; time: string }[] };
export type EmployeeSettings = { emailNotifications: boolean; taskReminders: boolean; compactLayout: boolean };

export const permissions: { key: PermissionKey; label: string }[] = [
  { key: "dashboard.view", label: "Dashboard" }, { key: "clients.view", label: "Clients" }, { key: "booking.view", label: "Booking" },
  { key: "tracking.view", label: "Tracking" }, { key: "pickup.view", label: "Pickup" }, { key: "reports.view", label: "Reports" },
  { key: "tasks.view", label: "Tasks" }, { key: "tasks.manage", label: "Manage tasks" }, { key: "activity.view", label: "Activity" },
  { key: "notifications.view", label: "Notifications" }, { key: "support.view", label: "Support" }, { key: "tickets.manage", label: "Manage tickets" },
  { key: "profile.view", label: "Profile" }, { key: "settings.view", label: "Settings" },
];

const baseline: PermissionKey[] = ["dashboard.view", "tasks.view", "activity.view", "notifications.view", "profile.view", "settings.view"];

export const demoEmployees: DemoEmployee[] = [
  { id: "rahul", name: "Rahul Sharma", initials: "RS", role: "Operations Executive", email: "rahul.sharma@psslogistics.in", employeeId: "EMP-0018", workspace: "rahul.psslogistics.in", assignedClientIds: ["client-1", "client-2", "client-3"], permissions: [...baseline, "clients.view", "booking.view", "tracking.view", "pickup.view", "reports.view", "tasks.manage", "support.view", "tickets.manage"], panelRole: "admin" },
  { id: "priya", name: "Priya Mehta", initials: "PM", role: "Support Executive", email: "priya.mehta@psslogistics.in", employeeId: "EMP-0021", workspace: "priya.psslogistics.in", assignedClientIds: ["client-1"], permissions: [...baseline, "clients.view", "support.view", "tickets.manage"], panelRole: "admin" },
  { id: "amit", name: "Amit Shah", initials: "AS", role: "Limited Operations", email: "amit.shah@psslogistics.in", employeeId: "EMP-0027", workspace: "amit.psslogistics.in", assignedClientIds: ["client-2"], permissions: [...baseline, "clients.view", "tracking.view"], panelRole: "admin" },
];

export const assignedClients: AssignedClient[] = [
  { id: "client-1", name: "ABC Industries", contact: "Priya Menon", location: "Bengaluru, IN", shipments: 8, status: "Active", lastActivity: "Ticket updated 18 min ago" },
  { id: "client-2", name: "Northstar Retail", contact: "Daniel Cooper", location: "Mumbai, IN", shipments: 5, status: "Active", lastActivity: "Pickup scheduled today" },
  { id: "client-3", name: "Atlas Imports", contact: "Maya Shah", location: "Delhi, IN", shipments: 3, status: "Needs attention", lastActivity: "Customs note added yesterday" },
];

export const initialTasks: EmployeeTask[] = [
  { id: "TSK-1042", title: "Review delayed delivery", context: "ABC Industries · PSS20260142", due: "Due today", status: "In progress", priority: "High", clientId: "client-1" },
  { id: "TSK-1038", title: "Confirm pickup window", context: "Northstar Retail · PKU20260017", due: "Due today", status: "Pending", priority: "Medium", clientId: "client-2" },
  { id: "TSK-1031", title: "Share customs documents", context: "Atlas Imports · PSS20260138", due: "Tomorrow", status: "Pending", priority: "High", clientId: "client-3" },
  { id: "TSK-1027", title: "Update client contact", context: "ABC Industries · CLT-0091", due: "Completed yesterday", status: "Completed", priority: "Low", clientId: "client-1" },
];

export const initialActivity: EmployeeActivity[] = [
  { id: "ACT-1", title: "Updated shipment tracking", detail: "PSS20260142 moved to In Transit", time: "12 min ago", tone: "blue" },
  { id: "ACT-2", title: "Support ticket assigned", detail: "TKT-1042 from ABC Industries", time: "48 min ago", tone: "amber" },
  { id: "ACT-3", title: "Pickup confirmed", detail: "PKU20260017 scheduled for 3:00 PM", time: "2 hr ago", tone: "green" },
  { id: "ACT-4", title: "Client profile updated", detail: "ABC Industries · Billing contact", time: "Yesterday", tone: "slate" },
];

export const initialNotifications: DemoNotification[] = [
  { id: "NTF-1", title: "Ticket approaching SLA", detail: "TKT-1042 has 18 hours remaining", tone: "warning", read: false, href: "/dashboard/support" },
  { id: "NTF-2", title: "Pickup reminder", detail: "PKU20260017 is scheduled today at 3:00 PM", tone: "info", read: false, href: "/dashboard/pickup" },
  { id: "NTF-3", title: "New client note", detail: "Atlas Imports added a customs update", tone: "success", read: true, href: "/dashboard/myClients/client-3" },
];

export const initialShipments: DemoShipment[] = [
  { id: "PSS20260142", route: "Bengaluru → Hamburg", status: "Delayed", eta: "14 Aug 2026", clientId: "client-1" },
  { id: "PSS20260139", route: "Mumbai → Dubai", status: "In Transit", eta: "16 Aug 2026", clientId: "client-2" },
  { id: "PSS20260138", route: "Delhi → London", status: "Customs Hold", eta: "Pending documents", clientId: "client-3" },
];

export const initialTickets: DemoTicket[] = [
  { id: "TKT-1042", clientId: "client-1", title: "Delivery status update", description: "The client needs an updated delivery commitment for the delayed shipment.", status: "Open", priority: "High", createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), messages: [{ id: "MSG-1", author: "Priya Menon", body: "Please share the latest delivery status.", time: "6 hours ago" }] },
  { id: "TKT-1036", clientId: "client-3", title: "Customs document request", description: "Additional customs documents are required before release.", status: "Waiting", priority: "Normal", createdAt: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(), messages: [{ id: "MSG-2", author: "Maya Shah", body: "We are collecting the requested documents.", time: "Yesterday" }] },
];

export const initialSettings: EmployeeSettings = { emailNotifications: true, taskReminders: true, compactLayout: false };
export const employee = demoEmployees[0];
export const employeeTasks = initialTasks;
export const employeeActivity = initialActivity;
export const employeeNotifications = initialNotifications;
export const clientWorkspaceData = Object.fromEntries(assignedClients.map((client) => [client.id, { shipments: initialShipments.filter((shipment) => shipment.clientId === client.id), tickets: initialTickets.filter((ticket) => ticket.clientId === client.id) }]));

export function hasPermission(currentEmployee: DemoEmployee | undefined, permission: PermissionKey) { return Boolean(currentEmployee?.permissions.includes(permission)); }
export function getSlaState(ticket: DemoTicket, now = Date.now()): TicketSlaState {
  if (ticket.status === "Resolved" || ticket.status === "Closed") return "Healthy";
  const age = now - new Date(ticket.createdAt).getTime();
  if (age >= 24 * 60 * 60 * 1000) return "Escalated";
  if (age >= 18 * 60 * 60 * 1000) return "Due soon";
  return "Healthy";
}
