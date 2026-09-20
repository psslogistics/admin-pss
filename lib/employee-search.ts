import { allNavigationItems } from "@/components/navigation/navigation-config";
import { type AssignedClient, type DemoEmployee, type EmployeeActivity, type EmployeeTask, type DemoNotification } from "@/lib/employee-data";

export type EmployeeSearchResult = { id: string; type: string; title: string; detail: string; href: string; keywords: string };
function getEmployeeSearchIndex(currentEmployee: DemoEmployee, clients: AssignedClient[], tasks: EmployeeTask[], activity: EmployeeActivity[], notifications: DemoNotification[]): EmployeeSearchResult[] {
  const pages = allNavigationItems.filter((item) => currentEmployee.permissions.includes(item.permission)).map((item) => ({ id: `page-${item.href}`, type: "Page", title: item.title, detail: "Workspace page", href: item.href, keywords: `${item.title} ${item.href}` }));
  const profile = { id: "employee-profile", type: "Employee", title: currentEmployee.name, detail: `${currentEmployee.role} · ${currentEmployee.employeeId}`, href: "/dashboard/profile", keywords: `${currentEmployee.name} ${currentEmployee.email} ${currentEmployee.employeeId} ${currentEmployee.workspace} ${currentEmployee.role}` };
  const clientResults = clients.map((client) => ({ id: client.id, type: "Client", title: client.name, detail: `${client.status} · ${client.lastActivity}`, href: `/dashboard/myClients/${encodeURIComponent(client.id)}`, keywords: `${client.name} ${client.status} ${client.lastActivity}` }));
  const taskResults = tasks.map((task) => ({ id: task.id, type: "Task", title: task.title, detail: `${task.id} · ${task.context} · ${task.status}`, href: "/dashboard/myTasks", keywords: `${task.id} ${task.title} ${task.context} ${task.status} ${task.priority}` }));
  const activityResults = activity.map((item) => ({ id: item.id, type: "Activity", title: item.title, detail: `${item.detail} · ${item.time}`, href: "/dashboard/myActivity", keywords: `${item.id} ${item.title} ${item.detail}` }));
  const notificationResults = notifications.map((item) => ({ id: item.id, type: "Notification", title: item.title, detail: item.detail, href: "/dashboard/notifications", keywords: `${item.id} ${item.title} ${item.detail}` }));
  return [profile, ...pages, ...clientResults, ...taskResults, ...activityResults, ...notificationResults];
}
export function searchEmployeeMaster(query: string, currentEmployee: DemoEmployee, clients: AssignedClient[], tasks: EmployeeTask[], activity: EmployeeActivity[], notifications: DemoNotification[]) {
  const normalized = query.trim().toLowerCase(); if (!normalized) return [];
  return getEmployeeSearchIndex(currentEmployee, clients, tasks, activity, notifications).map((result) => ({ result, score: result.title.toLowerCase() === normalized ? 100 : result.title.toLowerCase().startsWith(normalized) ? 80 : result.keywords.toLowerCase().includes(normalized) ? 25 : 0 })).filter(({ score }) => score).sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title)).slice(0, 12).map(({ result }) => result);
}
