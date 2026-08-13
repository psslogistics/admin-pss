export type TaskStatus = "In progress" | "Pending" | "Completed";
export type TaskPriority = "High" | "Medium" | "Low";

export type EmployeeTask = {
  id: string;
  title: string;
  context: string;
  due: string;
  status: TaskStatus;
  priority: TaskPriority;
};

export type EmployeeActivity = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "blue" | "green" | "amber" | "slate";
};

export const employee = {
  name: "Rahul Sharma",
  initials: "RS",
  role: "Operations Executive",
  email: "rahul.sharma@psslogistics.in",
  employeeId: "EMP-0018",
  workspace: "rahul.psslogistics.in",
  assignedClients: 12,
  panelRole: "admin" as const,
};

export const employeeTasks: EmployeeTask[] = [
  { id: "TSK-1042", title: "Review delayed delivery", context: "Client 1 · PSS20260142", due: "Due today", status: "In progress", priority: "High" },
  { id: "TSK-1038", title: "Confirm pickup window", context: "Northstar Retail · PKU20260017", due: "Due today", status: "Pending", priority: "Medium" },
  { id: "TSK-1031", title: "Share customs documents", context: "Atlas Imports · PSS20260138", due: "Tomorrow", status: "Pending", priority: "High" },
  { id: "TSK-1027", title: "Update client contact", context: "Brightline Foods · CLT-0091", due: "Completed yesterday", status: "Completed", priority: "Low" },
];

export const employeeActivity: EmployeeActivity[] = [
  { id: "ACT-1", title: "Updated shipment tracking", detail: "PSS20260142 moved to In Transit", time: "12 min ago", tone: "blue" },
  { id: "ACT-2", title: "Support ticket assigned", detail: "TKT-1042 from Client 1", time: "48 min ago", tone: "amber" },
  { id: "ACT-3", title: "Pickup confirmed", detail: "PKU20260017 scheduled for 3:00 PM", time: "2 hr ago", tone: "green" },
  { id: "ACT-4", title: "Client profile updated", detail: "Brightline Foods · Billing contact", time: "Yesterday", tone: "slate" },
];

export const employeeNotifications = [
  { id: "NTF-1", title: "Ticket approaching SLA", detail: "TKT-1042 has 18 hours remaining", tone: "warning" },
  { id: "NTF-2", title: "Pickup reminder", detail: "PKU20260017 is scheduled today at 3:00 PM", tone: "info" },
  { id: "NTF-3", title: "New client note", detail: "Atlas Imports added a customs update", tone: "success" },
];

export type AssignedClient = { id: string; name: string; contact: string; location: string; shipments: number; status: string; lastActivity: string };

export const assignedClients: AssignedClient[] = [
  { id: "client-1", name: "ABC Industries", contact: "Priya Menon", location: "Bengaluru, IN", shipments: 8, status: "Active", lastActivity: "Ticket updated 18 min ago" },
  { id: "client-2", name: "Northstar Retail", contact: "Daniel Cooper", location: "Mumbai, IN", shipments: 5, status: "Active", lastActivity: "Pickup scheduled today" },
  { id: "client-3", name: "Atlas Imports", contact: "Maya Shah", location: "Delhi, IN", shipments: 3, status: "Needs attention", lastActivity: "Customs note added yesterday" },
];

export const clientWorkspaceData = {
  "client-1": { shipments: [{ id: "PSS20260142", route: "Bengaluru → Hamburg", status: "Delayed", eta: "14 Aug 2026" }], tickets: [{ id: "TKT-1042", title: "Delivery status update", status: "Open", sla: "18h remaining" }] },
  "client-2": { shipments: [{ id: "PSS20260139", route: "Mumbai → Dubai", status: "In Transit", eta: "16 Aug 2026" }], tickets: [] },
  "client-3": { shipments: [{ id: "PSS20260138", route: "Delhi → London", status: "Customs Hold", eta: "Pending documents" }], tickets: [{ id: "TKT-1036", title: "Customs document request", status: "Waiting", sla: "2d remaining" }] },
} as const;
