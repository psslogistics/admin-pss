"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  assignedClients, demoEmployees, getSlaState, initialActivity, initialNotifications, initialSettings, initialShipments, initialTasks, initialTickets,
  type AssignedClient, type DemoEmployee, type DemoNotification, type DemoShipment, type DemoTicket, type EmployeeActivity, type EmployeeSettings, type EmployeeTask, type PermissionKey, type TaskPriority, type TaskStatus, type TicketStatus,
} from "@/lib/employee-data";

type EmployeeState = { employeeId: string; tasks: EmployeeTask[]; tickets: DemoTicket[]; notifications: DemoNotification[]; activity: EmployeeActivity[]; settings: EmployeeSettings; shipments: DemoShipment[]; profileOverrides: Record<string, Partial<Pick<DemoEmployee, "name" | "email" | "role">>> };
type EmployeeContextValue = EmployeeState & { profile: DemoEmployee; hydrated: boolean; employees: DemoEmployee[]; clients: AssignedClient[]; can: (permission: PermissionKey) => boolean; selectEmployee: (id: string) => void; resetDemo: () => void; saveTask: (task: EmployeeTask) => void; updateTask: (id: string, patch: Partial<EmployeeTask>) => void; saveTicket: (ticket: DemoTicket) => void; updateTicket: (id: string, patch: Partial<DemoTicket>) => void; replyToTicket: (id: string, body: string) => void; markNotificationRead: (id: string) => void; markAllNotificationsRead: () => void; addActivity: (title: string, detail: string, tone?: EmployeeActivity["tone"]) => void; updateSettings: (patch: Partial<EmployeeSettings>) => void; updateProfile: (patch: Partial<Pick<DemoEmployee, "name" | "email" | "role">>) => void; getVisibleClients: () => AssignedClient[]; getVisibleTickets: () => DemoTicket[] };

const STORAGE_KEY = "pss_employee_frontend_demo_v2";
const defaultState = (): EmployeeState => ({ employeeId: "rahul", tasks: initialTasks, tickets: initialTickets, notifications: initialNotifications, activity: initialActivity, settings: initialSettings, shipments: initialShipments, profileOverrides: {} });
const EmployeeContext = createContext<EmployeeContextValue | null>(null);

export function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EmployeeState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const baseProfile = demoEmployees.find((item) => item.id === state.employeeId) ?? demoEmployees[0];
  const profile = useMemo(() => ({ ...baseProfile, ...state.profileOverrides[state.employeeId] }), [baseProfile, state.profileOverrides, state.employeeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) { const parsed = JSON.parse(saved) as Partial<EmployeeState>; setState({ ...defaultState(), ...parsed, profileOverrides: parsed.profileOverrides ?? {} }); }
      } catch { /* local demo state can safely fall back to seed data */ }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state, hydrated]);

  const commit = useCallback((change: (current: EmployeeState) => EmployeeState) => setState((current) => change(current)), []);
  const selectEmployee = useCallback((id: string) => setState((current) => ({ ...current, employeeId: demoEmployees.some((item) => item.id === id) ? id : current.employeeId })), []);
  const resetDemo = useCallback(() => { setState(defaultState()); localStorage.removeItem(STORAGE_KEY); }, []);
  const addActivity = useCallback((title: string, detail: string, tone: EmployeeActivity["tone"] = "blue") => commit((current) => ({ ...current, activity: [{ id: `ACT-${Date.now()}`, title, detail, time: "Just now", tone }, ...current.activity] })), [commit]);
  const saveTask = useCallback((task: EmployeeTask) => { commit((current) => ({ ...current, tasks: [task, ...current.tasks] })); }, [commit]);
  const updateTask = useCallback((id: string, patch: Partial<EmployeeTask>) => { commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) })); }, [commit]);
  const saveTicket = useCallback((ticket: DemoTicket) => { commit((current) => ({ ...current, tickets: [ticket, ...current.tickets], notifications: [{ id: `NTF-${Date.now()}`, title: "New ticket created", detail: `${ticket.id} is assigned to your support queue`, tone: "info", read: false, href: "/dashboard/support" }, ...current.notifications] })); }, [commit]);
  const updateTicket = useCallback((id: string, patch: Partial<DemoTicket>) => { commit((current) => ({ ...current, tickets: current.tickets.map((ticket) => ticket.id === id ? { ...ticket, ...patch } : ticket) })); }, [commit]);
  const replyToTicket = useCallback((id: string, body: string) => { commit((current) => ({ ...current, tickets: current.tickets.map((ticket) => ticket.id === id ? { ...ticket, status: "In progress", messages: [...ticket.messages, { id: `MSG-${Date.now()}`, author: profile.name, body, time: "Just now" }] } : ticket) })); }, [commit, profile.name]);
  const markNotificationRead = useCallback((id: string) => commit((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === id ? { ...item, read: true } : item) })), [commit]);
  const markAllNotificationsRead = useCallback(() => commit((current) => ({ ...current, notifications: current.notifications.map((item) => ({ ...item, read: true })) })), [commit]);
  const updateSettings = useCallback((patch: Partial<EmployeeSettings>) => commit((current) => ({ ...current, settings: { ...current.settings, ...patch } })), [commit]);
  const updateProfile = useCallback((patch: Partial<Pick<DemoEmployee, "name" | "email" | "role">>) => commit((current) => ({ ...current, profileOverrides: { ...current.profileOverrides, [current.employeeId]: { ...current.profileOverrides[current.employeeId], ...patch } } })), [commit]);
  const value = useMemo<EmployeeContextValue>(() => ({ ...state, profile, hydrated, employees: demoEmployees, clients: assignedClients, can: (permission) => profile.permissions.includes(permission), selectEmployee, resetDemo, saveTask, updateTask, saveTicket, updateTicket, replyToTicket, markNotificationRead, markAllNotificationsRead, addActivity, updateSettings, updateProfile, getVisibleClients: () => assignedClients.filter((client) => profile.assignedClientIds.includes(client.id)), getVisibleTickets: () => state.tickets.filter((ticket) => profile.assignedClientIds.includes(ticket.clientId)) }), [state, profile, hydrated, selectEmployee, resetDemo, saveTask, updateTask, saveTicket, updateTicket, replyToTicket, markNotificationRead, markAllNotificationsRead, addActivity, updateSettings, updateProfile]);
  return <EmployeeContext.Provider value={value}>{children}</EmployeeContext.Provider>;
}

export function useEmployee() { const value = useContext(EmployeeContext); if (!value) throw new Error("useEmployee must be used inside EmployeeProvider"); return value; }
export function formatSla(ticket: DemoTicket, now = Date.now()) { const age = now - new Date(ticket.createdAt).getTime(); const remaining = Math.max(0, 24 * 60 * 60 * 1000 - age); const hours = Math.floor(remaining / 3600000); const minutes = Math.floor((remaining % 3600000) / 60000); const state = getSlaState(ticket, now); return { state, label: state === "Escalated" ? "Escalated to Super Admin" : `${hours}h ${minutes}m remaining` }; }
export type { AssignedClient, DemoEmployee, DemoNotification, DemoShipment, DemoTicket, EmployeeActivity, EmployeeSettings, EmployeeTask, PermissionKey, TaskPriority, TaskStatus, TicketStatus };
