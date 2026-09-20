export type PermissionKey = import("@/lib/admin-permissions").PermissionKey;

export type TaskStatus = "In progress" | "Pending" | "Completed";
export type TaskPriority = "High" | "Medium" | "Low";
export type TicketStatus = "Open" | "In progress" | "Waiting" | "Resolved" | "Closed";
export type TicketSlaState = "Healthy" | "Due soon" | "Escalated";

export type DemoEmployee = { id: string; name: string; initials: string; role: string; email: string; phone?: string; companyName?: string; employeeId: string; workspace: string; assignedClientIds: string[]; permissions: PermissionKey[]; panelRole: "admin" };
export type EmployeeTask = { id: string; title: string; context: string; due: string; dueAt?: string; status: TaskStatus; priority: TaskPriority; clientId?: string };
export type EmployeeActivity = { id: string; title: string; detail: string; time: string; tone: "blue" | "green" | "amber" | "slate" };
export type DemoNotification = { id: string; title: string; detail: string; tone: "warning" | "info" | "success"; read: boolean; href?: string };
export type AssignedClient = { id: string; name: string; contact: string; location: string; shipments: number; status: string; lastActivity: string };
export type DemoShipment = { id: string; route: string; status: string; eta: string; clientId: string };
export type DemoTicket = { id: string; clientId: string; title: string; description: string; status: TicketStatus; priority: "Urgent" | "High" | "Normal"; createdAt: string; messages: { id: string; author: string; body: string; time: string }[] };
export type EmployeeSettings = { emailNotifications: boolean; taskReminders: boolean; compactLayout: boolean };

// Runtime operational records are loaded from Supabase and the Worker. These
// exports remain as empty compatibility collections for older type imports.
export const assignedClients: AssignedClient[] = [];
export const initialTasks: EmployeeTask[] = [];
export const initialActivity: EmployeeActivity[] = [];
export const initialNotifications: DemoNotification[] = [];
export const initialShipments: DemoShipment[] = [];
export const initialTickets: DemoTicket[] = [];

export const initialSettings: EmployeeSettings = { emailNotifications: true, taskReminders: true, compactLayout: false };
export function getSlaState(ticket: DemoTicket, now = Date.now()): TicketSlaState {
  if (ticket.status === "Resolved" || ticket.status === "Closed") return "Healthy";
  const age = now - new Date(ticket.createdAt).getTime();
  if (age >= 24 * 60 * 60 * 1000) return "Escalated";
  if (age >= 18 * 60 * 60 * 1000) return "Due soon";
  return "Healthy";
}
