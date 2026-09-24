"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isAdminPermission, type PermissionKey } from "@/lib/admin-permissions";
import { getSlaState, initialSettings, type AssignedClient, type DemoEmployee, type DemoNotification, type DemoShipment, type DemoTicket, type EmployeeActivity, type EmployeeSettings, type EmployeeTask, type TaskPriority, type TaskStatus, type TicketStatus } from "@/lib/employee-data";
import { pssApi } from "@/lib/pss-api";

type EmployeeState = { employeeId: string; profile: DemoEmployee; tasks: EmployeeTask[]; tickets: DemoTicket[]; notifications: DemoNotification[]; activity: EmployeeActivity[]; settings: EmployeeSettings; shipments: DemoShipment[] };
type InitialIdentity = { id: string; name: string; email: string; employeeId: string; workspace: string; role: string };
type EmployeeContextValue = EmployeeState & { hydrated: boolean; employees: DemoEmployee[]; clients: AssignedClient[]; can: (permission: PermissionKey) => boolean; saveTask: (task: EmployeeTask) => Promise<{ error?: string }>; updateTask: (id: string, patch: Partial<EmployeeTask>) => Promise<{ error?: string }>; saveTicket: (ticket: DemoTicket) => Promise<{ error?: string }>; updateTicket: (id: string, patch: Partial<DemoTicket>) => Promise<{ error?: string }>; replyToTicket: (id: string, body: string) => Promise<{ error?: string }>; markNotificationRead: (id: string) => Promise<{ error?: string }>; markAllNotificationsRead: () => Promise<{ error?: string }>; addActivity: (title: string, detail: string, tone?: EmployeeActivity["tone"]) => Promise<{ error?: string }>; updateSettings: (patch: Partial<EmployeeSettings>) => Promise<{ error?: string }>; updateProfile: (patch: Partial<Pick<DemoEmployee, "name" | "phone">>) => Promise<{ error?: string }>; getVisibleClients: () => AssignedClient[]; getVisibleTickets: () => DemoTicket[] };
const emptyProfile: DemoEmployee = { id: "authenticated", name: "Authenticated employee", initials: "AE", role: "Employee", email: "", employeeId: "", workspace: "", assignedClientIds: [], permissions: [], panelRole: "admin" };
const defaultState = (): EmployeeState => ({ employeeId: emptyProfile.id, profile: emptyProfile, tasks: [], tickets: [], notifications: [], activity: [], settings: initialSettings, shipments: [] });
const EmployeeContext = createContext<EmployeeContextValue | null>(null);
let liveSlaNow: number | undefined;
function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AE"; }
function permissionSet(rows: Array<{ permission_key?: string }>, allowed: Set<string>) {
  return [...new Set(rows.map((row) => row.permission_key).filter((key): key is PermissionKey => Boolean(key && allowed.has(key) && isAdminPermission(key))))];
}

export function EmployeeProvider({ children, initialIdentity }: { children: React.ReactNode; initialIdentity?: InitialIdentity }) {
  const initialState = useMemo<EmployeeState>(() => {
    if (!initialIdentity) return defaultState();
    return { ...defaultState(), employeeId: initialIdentity.id, profile: { ...emptyProfile, id: initialIdentity.id, name: initialIdentity.name, initials: initials(initialIdentity.name), role: initialIdentity.role, email: initialIdentity.email, employeeId: initialIdentity.employeeId, workspace: initialIdentity.workspace } };
  }, [initialIdentity]);
  const [state, setState] = useState<EmployeeState>(initialState);
  const [clients, setClients] = useState<AssignedClient[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function loadEmployee() {
      const supabase = createClient(); const { data: auth } = await supabase.auth.getUser(); const user = auth.user;
      if (!user) { if (!cancelled) setHydrated(true); return; }
      const [{ data: profile }, { data: employee }, { data: userRoles }, { data: assignments }, { data: catalogue }] = await Promise.all([
        supabase.from("profiles").select("id,email,display_name,phone,company_name").eq("id", user.id).maybeSingle(),
        supabase.from("employee_profiles").select("employee_code,workspace_slug,employment_status").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role_id,is_active,roles(name)").eq("user_id", user.id).eq("is_active", true),
        supabase.from("employee_client_assignments").select("client_id,client_accounts(id,legal_name,status)").eq("employee_user_id", user.id),
        supabase.from("permissions").select("permission_key").eq("panel", "admin").eq("assignable_to_employee", true),
      ]);
      const roles = (userRoles ?? []) as Array<{ role_id?: string; roles?: { name?: string } | { name?: string }[] }>;
      const roleNames = roles.flatMap((item) => Array.isArray(item.roles) ? item.roles.map((role) => role.name) : [item.roles?.name]).filter((name): name is string => Boolean(name));
      const roleIds = roles.map((item) => item.role_id).filter((id): id is string => Boolean(id));
      const [{ data: rolePermissions }, { data: overrides }] = await Promise.all([
        roleIds.length ? supabase.from("role_permissions").select("role_id,permission_key").in("role_id", roleIds) : Promise.resolve({ data: [] }),
        supabase.from("employee_permission_overrides").select("permission_key,mode").eq("employee_user_id", user.id),
      ]);
      const allowed = new Set((catalogue ?? []).map((item) => item.permission_key));
      let apiPermissions: string[] | null = null;
      try {
        const identity = await pssApi<{ permissions?: string[] }>("/v1/me");
        if (Array.isArray(identity.permissions)) apiPermissions = identity.permissions;
      } catch {
        // Fall back to the Supabase permission query if the API identity check is unavailable.
      }
      const roleBasedPermissions = permissionSet((rolePermissions ?? []) as Array<{ permission_key?: string }>, allowed);
      // The Worker is an additional production cross-check, not a reason to
      // erase permissions when a stale deployment or transient API response
      // returns an empty list. Supabase is the same authenticated source used
      // by the server-side permission gate, so retain it as the safe fallback.
      const effectivePermissions = new Set(
        apiPermissions?.length
          ? apiPermissions.filter((permission): permission is PermissionKey => allowed.has(permission) && isAdminPermission(permission))
          : roleBasedPermissions,
      );
      for (const override of (overrides ?? []) as Array<{ permission_key?: string; mode?: string }>) {
        if (!override.permission_key || !allowed.has(override.permission_key) || !isAdminPermission(override.permission_key)) continue;
        if (override.mode === "grant") effectivePermissions.add(override.permission_key);
        if (override.mode === "revoke") effectivePermissions.delete(override.permission_key);
      }
      const assignedClientIds = (assignments ?? []).map((item) => item.client_id).filter(Boolean);
      const loadedClients: AssignedClient[] = (assignments ?? []).flatMap((item) => { const client = Array.isArray(item.client_accounts) ? item.client_accounts[0] : item.client_accounts; return client ? [{ id: client.id, name: client.legal_name, contact: "", location: "", shipments: 0, status: client.status === "active" ? "Active" : client.status, lastActivity: "Live assignment activity" }] : []; });
      let liveTickets: DemoTicket[] = []; let liveNotifications: DemoNotification[] = []; let liveShipments: DemoShipment[] = []; let liveTasks: EmployeeTask[] = []; let liveActivity: EmployeeActivity[] = [];
      let liveSettings: EmployeeSettings = initialSettings;
      try {
        const [ticketResult, notificationResult, shipmentResult, taskResult, activityResult, ticketMessageResult] = await Promise.all([
          pssApi<{ data: Array<Record<string, unknown>> }>("/v1/tickets"),
          pssApi<{ data: Array<Record<string, unknown>> }>("/v1/notifications"),
          pssApi<{ data: Array<Record<string, unknown>> }>("/v1/shipments"),
          pssApi<{ data: Array<Record<string, unknown>> }>("/v1/tasks"),
          pssApi<{ data: Array<Record<string, unknown>> }>("/v1/activity"),
          pssApi<{ data: Array<Record<string, unknown>> }>("/v1/tickets/messages"),
        ]);
        const messagesByTicket = new Map<string, Array<Record<string, unknown>>>();
        for (const message of ticketMessageResult.data) { const ticketId = String(message.ticket_id ?? ""); const messages = messagesByTicket.get(ticketId) ?? []; messages.push(message); messagesByTicket.set(ticketId, messages); }
        const ticketMessages = ticketResult.data.map((row) => ({ data: messagesByTicket.get(String(row.id)) ?? [] }));
        liveTickets = ticketResult.data.map((row, index) => ({ id: String(row.id), clientId: String(row.client_id), title: String(row.title ?? "Support ticket"), description: String(row.description ?? ""), status: String(row.status ?? "Open") as TicketStatus, priority: String(row.priority ?? "Normal") as DemoTicket["priority"], createdAt: String(row.created_at ?? new Date().toISOString()), messages: ticketMessages[index].data.map((message) => ({ id: String(message.id), author: String(message.author_user_id ?? "Production user"), body: String(message.message ?? ""), time: message.created_at ? new Date(String(message.created_at)).toLocaleString() : "" })) }));
        liveNotifications = notificationResult.data.map((row) => ({ id: String(row.id), title: String(row.title ?? "Notification"), detail: String(row.message ?? ""), tone: row.type === "warning" ? "warning" : "info", read: Boolean(row.is_read) } as DemoNotification));
        liveShipments = shipmentResult.data.map((row) => ({ id: String(row.id), route: `${String(row.origin ?? "")} → ${String(row.destination ?? "")}`, status: String(row.status ?? "Booked"), eta: String(row.edd ?? "Pending"), clientId: String(row.client_id) }));
        liveTasks = taskResult.data.map((row) => ({ id: String(row.id), title: String(row.title ?? "Task"), context: String(row.description ?? ""), due: row.due_at ? new Date(String(row.due_at)).toLocaleDateString() : "No due date", dueAt: row.due_at ? String(row.due_at) : undefined, status: String(row.status ?? "pending").toLowerCase() === "completed" ? "Completed" : String(row.status ?? "pending").toLowerCase() === "in_progress" ? "In progress" : "Pending", priority: String(row.priority ?? "medium").toLowerCase() === "high" ? "High" : String(row.priority ?? "medium").toLowerCase() === "low" ? "Low" : "Medium", clientId: row.client_id ? String(row.client_id) : undefined }));
        liveActivity = activityResult.data.map((row) => ({ id: String(row.id), title: String(row.action ?? "Activity"), detail: String(row.entity_type ?? "") + (row.entity_id ? ` · ${String(row.entity_id)}` : ""), time: row.created_at ? new Date(String(row.created_at)).toLocaleString() : "", tone: "blue" }));
        try {
          const preferences = await pssApi<{ data: { email_notifications?: boolean; task_reminders?: boolean; compact_layout?: boolean } }>("/v1/employee-preferences");
          liveSettings = { emailNotifications: preferences.data.email_notifications ?? true, taskReminders: preferences.data.task_reminders ?? true, compactLayout: preferences.data.compact_layout ?? false };
        } catch { /* first load uses secure defaults until preferences are available */ }
      } catch { /* the authenticated panel can still render identity while the API is unavailable */ }
      if (!cancelled) {
        const name = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || emptyProfile.name;
        setState((current) => ({ ...current, employeeId: user.id, profile: { id: user.id, name, initials: initials(name), role: roleNames.join(" · ") || "Employee", email: profile?.email || user.email || "", employeeId: employee?.employee_code || "", workspace: employee?.workspace_slug || "", assignedClientIds, permissions: [...effectivePermissions], panelRole: "admin", phone: profile?.phone || "", companyName: profile?.company_name || "" }, tickets: liveTickets, notifications: liveNotifications, shipments: liveShipments, tasks: liveTasks, activity: liveActivity, settings: liveSettings }));
        setClients(loadedClients.map((client) => ({ ...client, shipments: liveShipments.filter((shipment) => shipment.clientId === client.id).length }))); setHydrated(true);
      }
    }
    void loadEmployee().catch(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);
  const commit = useCallback((change: (current: EmployeeState) => EmployeeState) => setState((current) => change(current)), []);
  const addActivity = useCallback(async (_title: string, _detail: string, _tone: EmployeeActivity["tone"] = "blue") => { try { await pssApi("/v1/activity", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: _title, entity_type: "employee_workspace", details: { detail: _detail, tone: _tone } }) }); const result = await pssApi<{ data: Array<Record<string, unknown>> }>("/v1/activity"); commit((current) => ({ ...current, activity: result.data.map((row) => ({ id: String(row.id), title: String(row.action ?? "Activity"), detail: String(row.entity_type ?? "") + (row.entity_id ? ` · ${String(row.entity_id)}` : ""), time: row.created_at ? new Date(String(row.created_at)).toLocaleString() : "", tone: "blue" as EmployeeActivity["tone"] })) })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Activity could not be saved." }; } }, [commit]);
  const saveTask = useCallback(async (task: EmployeeTask) => { try { const result = await pssApi<{ data: { id: string } }>("/v1/tasks", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: task.title, description: task.context, client_id: task.clientId, due_at: task.dueAt ?? task.due, priority: task.priority.toLowerCase() }) }); commit((current) => ({ ...current, tasks: [{ ...task, id: result.data.id }, ...current.tasks] })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Task could not be saved." }; } }, [commit]);
  const updateTask = useCallback(async (id: string, patch: Partial<EmployeeTask>) => { try { const body = { ...(patch.status !== undefined ? { status: patch.status.toLowerCase().replaceAll(" ", "_") } : {}), ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.context !== undefined ? { description: patch.context } : {}), ...((patch.dueAt ?? patch.due) !== undefined ? { due_at: patch.dueAt ?? patch.due } : {}), ...(patch.priority !== undefined ? { priority: patch.priority.toLowerCase() } : {}), ...(patch.clientId !== undefined ? { client_id: patch.clientId } : {}) }; await pssApi(`/v1/tasks/${id}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) }); commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Task could not be updated." }; } }, [commit]);
  const saveTicket = useCallback(async (ticket: DemoTicket) => { try { const result = await pssApi<{ data: { id: string } }>("/v1/tickets", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: ticket.title, description: ticket.description, client_id: ticket.clientId, priority: ticket.priority.toLowerCase() }) }); commit((current) => ({ ...current, tickets: [{ ...ticket, id: result.data.id }, ...current.tickets] })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Ticket could not be saved." }; } }, [commit]);
  const updateTicket = useCallback(async (id: string, patch: Partial<DemoTicket>) => { try { await pssApi(`/v1/tickets/${id}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ status: patch.status?.toLowerCase().replaceAll(" ", "_") }) }); commit((current) => ({ ...current, tickets: current.tickets.map((ticket) => ticket.id === id ? { ...ticket, ...patch } : ticket) })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Ticket could not be updated." }; } }, [commit]);
  const replyToTicket = useCallback(async (id: string, body: string) => { try { const result = await pssApi<{ data: { id: string } }>(`/v1/tickets/${id}/messages`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ message: body }) }); commit((current) => ({ ...current, tickets: current.tickets.map((ticket) => ticket.id === id ? { ...ticket, status: "In progress", messages: [...ticket.messages, { id: result.data.id, author: current.profile.name, body, time: "Just now" }] } : ticket) })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Reply could not be sent." }; } }, [commit]);
  const markNotificationRead = useCallback(async (id: string) => { try { await pssApi(`/v1/notifications/${id}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ is_read: true }) }); commit((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === id ? { ...item, read: true } : item) })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Unable to mark notification read." }; } }, [commit]);
  const markAllNotificationsRead = useCallback(async () => { try { await Promise.all(state.notifications.filter((item) => !item.read).map((item) => pssApi(`/v1/notifications/${item.id}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ is_read: true }) }))); commit((current) => ({ ...current, notifications: current.notifications.map((item) => ({ ...item, read: true })) })); return {}; } catch (error) { return { error: error instanceof Error ? error.message : "Unable to mark notifications read." }; } }, [commit, state.notifications]);
  const updateSettings = useCallback(async (patch: Partial<EmployeeSettings>) => {
    const next = { ...state.settings, ...patch };
    try {
      await pssApi("/v1/employee-preferences", { method: "PUT", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ email_notifications: next.emailNotifications, task_reminders: next.taskReminders, compact_layout: next.compactLayout }) });
      commit((current) => ({ ...current, settings: next }));
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Workspace settings could not be saved." };
    }
  }, [commit, state.settings]);
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
  const value = useMemo<EmployeeContextValue>(() => ({ ...state, hydrated, employees: [], clients, can: (permission) => state.profile.permissions.includes(permission), saveTask, updateTask, saveTicket, updateTicket, replyToTicket, markNotificationRead, markAllNotificationsRead, addActivity, updateSettings, updateProfile, getVisibleClients: () => clients, getVisibleTickets: () => state.tickets.filter((ticket) => state.profile.assignedClientIds.includes(ticket.clientId)) }), [state, hydrated, clients, saveTask, updateTask, saveTicket, updateTicket, replyToTicket, markNotificationRead, markAllNotificationsRead, addActivity, updateSettings, updateProfile]);
  return <EmployeeContext.Provider value={value}>{children}</EmployeeContext.Provider>;
}
export function useEmployee() { const value = useContext(EmployeeContext); if (!value) throw new Error("useEmployee must be used inside EmployeeProvider"); return value; }
export function formatSla(ticket: DemoTicket, now = liveSlaNow ?? new Date(ticket.createdAt).getTime()) { const age = now - new Date(ticket.createdAt).getTime(); const remaining = Math.max(0, 24 * 60 * 60 * 1000 - age); const hours = Math.floor(remaining / 3600000); const minutes = Math.floor((remaining % 3600000) / 60000); const state = getSlaState(ticket, now); return { state, label: state === "Escalated" ? "Escalated to Super Admin" : `${hours}h ${minutes}m remaining` }; }
export type { AssignedClient, DemoEmployee, DemoNotification, DemoShipment, DemoTicket, EmployeeActivity, EmployeeSettings, EmployeeTask, PermissionKey, TaskPriority, TaskStatus, TicketStatus };
