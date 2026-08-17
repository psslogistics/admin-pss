import { allNavigationItems } from "@/components/navigation/navigation-config";
import { assignedClients, employee, employeeActivity, employeeNotifications, employeeTasks } from "@/lib/employee-data";

export type EmployeeSearchResult = { id: string; type: string; title: string; detail: string; href: string; keywords: string };

export function getEmployeeSearchIndex(): EmployeeSearchResult[] {
  const pages = allNavigationItems.map((item) => ({ id: `page-${item.href}`, type: "Page", title: item.title, detail: "Workspace page", href: item.href, keywords: `${item.title} ${item.href}` }));
  const profile = { id: "employee-profile", type: "Employee", title: employee.name, detail: `${employee.role} · ${employee.employeeId}`, href: "/dashboard/profile", keywords: `${employee.name} ${employee.email} ${employee.employeeId} ${employee.workspace} ${employee.role}` };
  const clients = assignedClients.map((client) => ({ id: client.id, type: "Client", title: client.name, detail: `${client.contact} · ${client.location} · ${client.status}`, href: `/dashboard/myClients?client=${encodeURIComponent(client.id)}`, keywords: `${client.name} ${client.contact} ${client.location} ${client.status} ${client.lastActivity}` }));
  const tasks = employeeTasks.map((task) => ({ id: task.id, type: "Task", title: task.title, detail: `${task.id} · ${task.context} · ${task.status}`, href: "/dashboard/myTasks", keywords: `${task.id} ${task.title} ${task.context} ${task.status} ${task.priority}` }));
  const activity = employeeActivity.map((item) => ({ id: item.id, type: "Activity", title: item.title, detail: `${item.detail} · ${item.time}`, href: "/dashboard/myActivity", keywords: `${item.id} ${item.title} ${item.detail}` }));
  const notifications = employeeNotifications.map((item) => ({ id: item.id, type: "Notification", title: item.title, detail: item.detail, href: "/dashboard/notifications", keywords: `${item.id} ${item.title} ${item.detail}` }));
  return [profile, ...pages, ...clients, ...tasks, ...activity, ...notifications];
}

export function searchEmployeeMaster(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return getEmployeeSearchIndex().map((result) => ({ result, score: result.title.toLowerCase() === normalized ? 100 : result.title.toLowerCase().startsWith(normalized) ? 80 : result.keywords.toLowerCase().includes(normalized) ? 25 : 0 })).filter(({ score }) => score).sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title)).slice(0, 12).map(({ result }) => result);
}
