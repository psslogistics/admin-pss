import { NextResponse } from "next/server";
import { requireEmployeeAccess } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const permissionByAction = {
  automation_manage: "admin.automation.manage", automation_run: "admin.automation.run", bulk_booking: "admin.bookings.bulk_create",
  employee_enable: "admin.employees.enable", employee_reset_password: "admin.employees.reset_password", employee_assign_role: "admin.employees.assign_role", employee_assign_client: "admin.employees.assign_client", employee_revoke_client: "admin.employees.revoke_client",
} as const;
const actions = new Set(Object.keys(permissionByAction));

function errorResponse(status: number, code: string, message: string, technicalMessage = message) {
  const requestId = crypto.randomUUID();
  return NextResponse.json({ error: { category: status === 403 ? "permission" : "request", code, user_safe_message: message, technical_message: technicalMessage, retryable: false, stale_data: false, request_id: requestId } }, { status, headers: { "x-request-id": requestId } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  if (!claims.data?.claims?.sub) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Your session is missing or expired.");
  const actor = await requireEmployeeAccess();
  let payload: { action?: unknown; clientId?: unknown; employeeId?: unknown; roleId?: unknown };
  try { payload = await request.json(); } catch { return errorResponse(400, "ADMIN_ACTION_PAYLOAD_INVALID", "Provide a valid JSON admin action request."); }
  const action = typeof payload.action === "string" && actions.has(payload.action) ? payload.action as keyof typeof permissionByAction : null;
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const employeeId = typeof payload.employeeId === "string" ? payload.employeeId.trim() : "";
  const roleId = typeof payload.roleId === "string" ? payload.roleId.trim() : "";
  if (!action) return errorResponse(400, "ADMIN_ACTION_PAYLOAD_INVALID", "Choose a supported admin action.");
  if (action === "bulk_booking" && (!clientId || !actor.assignedClientIds.includes(clientId))) return errorResponse(403, "ADMIN_ACTION_CLIENT_SCOPE_DENIED", "Bulk booking previews require an assigned client.");
  if (action.startsWith("employee_") && !employeeId) return errorResponse(400, "ADMIN_ACTION_PAYLOAD_INVALID", "Employee lifecycle previews require an employee target.");
  if (action === "employee_assign_role" && !roleId) return errorResponse(400, "ADMIN_ACTION_PAYLOAD_INVALID", "Role assignment previews require a role target.");
  const { data: allowed, error } = await supabase.rpc("has_permission", { required_permission: permissionByAction[action] });
  if (error) return errorResponse(500, "ADMIN_ACTION_PERMISSION_CHECK_FAILED", "The admin action permission could not be checked.", error.message);
  if (!allowed) return errorResponse(403, "ADMIN_ACTION_PERMISSION_DENIED", "You do not have permission to preview this admin action.");
  return NextResponse.json({ ok: true, dryRun: true, mutationSubmitted: false, providerCalled: false, passwordChanged: false, scheduleCreated: false, auditEventCreated: false, validated: { action, clientId: clientId || null, employeeId: employeeId || null, roleId: roleId || null }, message: "Admin action validated. No employee, booking, automation, password, or audit mutation was submitted." });
}
