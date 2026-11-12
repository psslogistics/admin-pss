import { NextResponse } from "next/server";
import { requireEmployeeAccess } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const permissionByAction = { create: "admin.couriers.create", edit: "admin.couriers.edit", enable: "admin.couriers.enable", disable: "admin.couriers.disable", assign: "admin.couriers.assign" } as const;
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
  let payload: { action?: unknown; clientId?: unknown; accountId?: unknown; provider?: unknown };
  try { payload = await request.json(); } catch { return errorResponse(400, "COURIER_ACTION_PAYLOAD_INVALID", "Provide a valid JSON courier action request."); }
  const action = typeof payload.action === "string" && actions.has(payload.action) ? payload.action as keyof typeof permissionByAction : null;
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const accountId = typeof payload.accountId === "string" ? payload.accountId.trim() : "";
  const provider = typeof payload.provider === "string" ? payload.provider.trim() : "";
  if (!action || !clientId || (action !== "create" && !accountId) || (action === "create" && !provider)) return errorResponse(400, "COURIER_ACTION_PAYLOAD_INVALID", "Provide an action, assigned client, and the required account or provider fields.");
  const { data: allowed, error } = await supabase.rpc("has_permission", { required_permission: permissionByAction[action] });
  if (error) return errorResponse(500, "COURIER_ACTION_PERMISSION_CHECK_FAILED", "The courier action permission could not be checked.", error.message);
  if (!allowed) return errorResponse(403, "COURIER_ACTION_PERMISSION_DENIED", "You do not have permission to preview this courier action.");
  if (!actor.assignedClientIds.includes(clientId)) return errorResponse(403, "COURIER_ACTION_CLIENT_SCOPE_DENIED", "This client is outside your assigned scope.");
  return NextResponse.json({ ok: true, dryRun: true, mutationSubmitted: false, providerCalled: false, secretsAccepted: false, auditEventCreated: false, validated: { action, clientId, accountId: accountId || null, provider: provider || null }, message: "Courier action validated. No courier account, provider, secret, or audit mutation was submitted." });
}
