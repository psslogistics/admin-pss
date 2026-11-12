import { NextResponse } from "next/server";
import { requireEmployeeAccess } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const permissionByAction = { activate: "admin.clients.activate", suspend: "admin.clients.suspend" } as const;
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
  let payload: { action?: unknown; clientId?: unknown; reason?: unknown };
  try { payload = await request.json(); } catch { return errorResponse(400, "CLIENT_ACTION_PAYLOAD_INVALID", "Provide a valid JSON client action request."); }
  const action = typeof payload.action === "string" && actions.has(payload.action) ? payload.action as keyof typeof permissionByAction : null;
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!action || !clientId || reason.length > 1000) return errorResponse(400, "CLIENT_ACTION_PAYLOAD_INVALID", "Choose activate or suspend, provide an assigned client, and keep the reason within 1,000 characters.");
  const { data: allowed, error } = await supabase.rpc("has_permission", { required_permission: permissionByAction[action] });
  if (error) return errorResponse(500, "CLIENT_ACTION_PERMISSION_CHECK_FAILED", "The client action permission could not be checked.", error.message);
  if (!allowed) return errorResponse(403, "CLIENT_ACTION_PERMISSION_DENIED", "You do not have permission to preview this client action.");
  if (!actor.assignedClientIds.includes(clientId)) return errorResponse(403, "CLIENT_ACTION_CLIENT_SCOPE_DENIED", "This client is outside your assigned scope.");
  return NextResponse.json({ ok: true, dryRun: true, mutationSubmitted: false, auditEventCreated: false, validated: { action, clientId, reasonProvided: Boolean(reason) }, message: "Client action validated. No account status or audit mutation was submitted." });
}
