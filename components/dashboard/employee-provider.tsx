"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSlaState, initialSettings, type AssignedClient, type DemoEmployee, type DemoNotification, type DemoShipment, type DemoTicket, type EmployeeActivity, type EmployeeSettings, type EmployeeTask, type PermissionKey, type TaskPriority, type TaskStatus, type TicketStatus } from "@/lib/employee-data";

type EmployeeState = { employeeId: string; profile: DemoEmployee; tasks: EmployeeTask[]; tickets: DemoTicket[]; notifications: DemoNotification[]; activity: EmployeeActivity[]; settings: EmployeeSettings; shipments: DemoShipment[] };
type EmployeeContextValue = EmployeeState & { hydrated: boolean; employees: DemoEmployee[]; clients: AssignedClient[]; can: (permission: PermissionKey) => boolean; selectEmployee: (id: string) => void; resetDemo: () => void; saveTask: (task: EmployeeTask) => void; updateTask: (id: string, patch: Partial<EmployeeTask>) => void; saveTicket: (ticket: DemoTicket) => void; updateTicket: (id: string, patch: Partial<DemoTicket>) => void; replyToTicket: (id: string, body: string) => void; markNotificationRead: (id: string) => void; markAllNotificationsRead: () => void; addActivity: (title: string, detail: string, tone?: EmployeeActivity["tone"]) => void; updateSettings: (patch: Partial<EmployeeSettings>) => void; updateProfile: (patch: Partial<Pick<DemoEmployee, "name" | "phone">>) => Promise<{ error?: string }>; getVisibleClients: () => AssignedClient[]; getVisibleTickets: () => DemoTicket[] };
const emptyProfile: DemoEmployee = { id: "authenticated", name: "Authenticated employee", initials: "AE", role: "Employee", email: "", employeeId: "", workspace: "", assignedClientIds: [], permissions: [], panelRole: "admin" };
const defaultState = (): EmployeeState => ({ employeeId: emptyProfile.id, profile: emptyProfile, tasks: [], tickets: [], notifications: [], activity: [], settings: initialSettings, shipments: [] });
const EmployeeContext = createContext<EmployeeContextValue | null>(null);
let liveSlaNow: number | undefined;
function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AE"; }
function permissionSet(rows: Array<{ permission_key?: string }>) {
  const permissions = new Set(rows.map((row) => row.permission_key).filter(Boolean) as string[]);
  if (permissions.has("shipments.view") || permissions.has("shipments.create")) permissions.add("booking.view");
  if (permissions.has("tickets.view")) permissions.add("support.view");
  if (permissions.has("tickets.reply") || permissions.has("tickets.close")) permissions.add("tickets.manage");
  if (permissions.has("employee_activity.view")) permissions.add("activity.view");
  return [...permissions].filter((key): key is PermissionKey => Boolean(key));
}

export function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EmployeeState>(defaultState);
  const [clients, setClients] = useState<AssignedClient[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function loadEmployee() {
      const supabase = createClient(); const { data: auth } = await supabase.auth.getUser(); const user = auth.user;
      if (!user) { if (!cancelled) setHydrated(true); return; }
      const [{ data: profile }, { data: employee }, { data: userRoles }, { data: assignments }] = await Promise.all([
        supabase.from("profiles").select("id,email,display_name,phone,company_name").eq("id", user.id).maybeSingle(),
        supabase.from("employee_profiles").select("employee_code,workspace_slug,employment_status").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role_id,is_active,roles(name)").eq("user_id", user.id).eq("is_active", true),
        supabase.from("employee_client_assignments").select("client_id,client_accounts(id,legal_name,status)").eq("employee_user_id", user.id),
      ]);
      const roles = (userRoles ?? []) as Array<{ role_id?: string; roles?: { name?: string } | { name?: string }[] }>;
      const roleNames = roles.flatMap((item) => Array.isArray(item.roles) ? item.roles.map((role) => role.name) : [item.roles?.name]).filter((name): name is string => Boolean(name));
      const roleIds = roles.map((item) => item.role_id).filter((id): id is string => Boolean(id));
      const { data: rolePermissions } = roleIds.length ? await supabase.from("role_permissions").select("role_id,permission_key").in("role_id", roleIds) : { data: [] };
      const assignedClientIds = (assignments ?? []).map((item) => item.client_id).filter(Boolean);
      const loadedClients: AssignedClient[] = (assignments ?? []).flatMap((item) => { const client = Array.isArray(item.client_accounts) ? item.client_accounts[0] : item.client_accounts; return client ? [{ id: client.id, name: client.legal_name, contact: "", location: "", shipments: 0, status: client.status === "active" ? "Active" : client.status, lastActivity: "Operational activity is not connected yet" }] : []; });
      if (!cancelled) {
        const name = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || emptyProfile.name;
        setState((current) => ({ ...current, employeeId: user.id, profile: { id: user.id, name, initials: initials(name), role: roleNames.join(" · ") || "Employee", email: profile?.email || user.email || "", employeeId: employee?.employee_code || "", workspace: employee?.workspace_slug || "", assignedClientIds, permissions: permissionSet((rolePermissions ?? []) as Array<{ permission_key?: string }>), panelRole: "admin", phone: profile?.phone || "", companyName: profile?.company_name || "" } }));
        setClients(loadedClients); setHydrated(true);
      }
    }
    void loadEmployee().catch(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);
  const commit = useCallback((change: (current: EmployeeState) => EmployeeState) => setState((current) => change(current)), []);
  const selectEmployee = useCallback(() => {}, []); const resetDemo = useCallback(() => {}, []);
  const addActivity = useCallback((title: string, detail: string, tone: EmployeeActivity["tone"] = "blue") => commit((current) => ({ ...current, activity: [{ id: `ACT-${Date.now()}`, title, detail, time: "Just now", tone }, ...current.activity] })), [commit]);
  const saveTask = useCallback((task: EmployeeTask) => commit((current) => ({ ...current, tasks: [task, ...current.tasks] })), [commit]);
  const updateTask = useCallback((id: string, patch: Partial<EmployeeTask>) => commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) })), [commit]);
  const saveTicket = useCallback((ticket: DemoTicket) => commit((current) => ({ ...current, tickets: [ticket, ...current.tickets] })), [commit]);
  const updateTicket = useCallback((id: string, patch: Partial<DemoTicket>) => commit((current) => ({ ...current, tickets: current.tickets.map((ticket) => ticket.id === id ? { ...ticket, ...patch } : ticket) })), [commit]);
  const replyToTicket = useCallback((id: string, body: string) => commit((current) => ({ ...current, tickets: current.tickets.map((ticket) => ticket.id === id ? { ...ticket, status: "In progress", messages: [...ticket.messages, { id: `MSG-${Date.now()}`, author: current.profile.name, body, time: "Just now" }] } : ticket) })), [commit]);
  const markNotificationRead = useCallback((id: string) => commit((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === id ? { ...item, read: true } : item) })), [commit]);
  const markAllNotificationsRead = useCallback(() => commit((current) => ({ ...current, notifications: current.notifications.map((item) => ({ ...item, read: true })) })), [commit]);
  const updateSettings = useCallback((patch: Partial<EmployeeSettings>) => commit((current) => ({ ...current, settings: { ...current.settings, ...patch } })), [commit]);
  const updateProfile = useCallback(async (patch: Partial<Pick<DemoEmployee, "name" | "phone">>) => {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { error: "Your session has expired. Please sign in again." };
    const update: { display_name?: string; phone?: string } = {};
    if (patch.name !== undefined) update.display_name = patch.name.trim();
    if (patch.phone !== undefined) update.phone = patch.phone.trim();
    const { error } = await supabase.from("profiles").update(update).eq("id", auth.user.id);
    if (error) return { error: "Your profile could not be saved. Please try again." };
    commit((current) => ({ ...current, profile: { ...current.profile, ...patch, initials: initials(patch.name ?? current.profile.name) } }));
    return {};
  }, [commit]);
  const value = useMemo<EmployeeContextValue>(() => ({ ...state, hydrated, employees: [], clients, can: (permission) => state.profile.permissions.includes(permission), selectEmployee, resetDemo, saveTask, updateTask, saveTicket, updateTicket, replyToTicket, markNotificationRead, markAllNotificationsRead, addActivity, updateSettings, updateProfile, getVisibleClients: () => clients, getVisibleTickets: () => state.tickets.filter((ticket) => state.profile.assignedClientIds.includes(ticket.clientId)) }), [state, hydrated, clients, selectEmployee, resetDemo, saveTask, updateTask, saveTicket, updateTicket, replyToTicket, markNotificationRead, markAllNotificationsRead, addActivity, updateSettings, updateProfile]);
  return <EmployeeContext.Provider value={value}>{children}</EmployeeContext.Provider>;
}
export function useEmployee() { const value = useContext(EmployeeContext); if (!value) throw new Error("useEmployee must be used inside EmployeeProvider"); return value; }
export function formatSla(ticket: DemoTicket, now = liveSlaNow ?? new Date(ticket.createdAt).getTime()) { const age = now - new Date(ticket.createdAt).getTime(); const remaining = Math.max(0, 24 * 60 * 60 * 1000 - age); const hours = Math.floor(remaining / 3600000); const minutes = Math.floor((remaining % 3600000) / 60000); const state = getSlaState(ticket, now); return { state, label: state === "Escalated" ? "Escalated to Super Admin" : `${hours}h ${minutes}m remaining` }; }
export type { AssignedClient, DemoEmployee, DemoNotification, DemoShipment, DemoTicket, EmployeeActivity, EmployeeSettings, EmployeeTask, PermissionKey, TaskPriority, TaskStatus, TicketStatus };
