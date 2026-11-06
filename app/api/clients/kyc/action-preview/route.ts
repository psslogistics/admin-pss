import { NextResponse } from "next/server";
import { requireEmployeeAccess } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const actions = new Set(["approve", "reject"]);
const permissionByAction = { approve: "admin.clients.kyc.approve", reject: "admin.clients.kyc.reject" } as const;

function response(status: number, code: string, message: string, technicalMessage = message) {
  const requestId = crypto.randomUUID();
  return NextResponse.json({ error: { category: status === 403 ? "permission" : "request", code, user_safe_message: message, technical_message: technicalMessage, retryable: false, stale_data: false, request_id: requestId } }, { status, headers: { "x-request-id": requestId } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  if (!claims.data?.claims?.sub) return response(401, "AUTHENTICATION_REQUIRED", "Your session is missing or expired.");
  const actor = await requireEmployeeAccess();
  let payload: { action?: unknown; clientId?: unknown; notes?: unknown };
  try { payload = await request.json(); } catch { return response(400, "KYC_ACTION_PAYLOAD_INVALID", "Provide a valid JSON KYC action request."); }
  const action = typeof payload.action === "string" && actions.has(payload.action) ? payload.action as "approve" | "reject" : null;
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  if (!action || !clientId || notes.length > 1000) return response(400, "KYC_ACTION_PAYLOAD_INVALID", "Choose approve or reject, provide an assigned client, and keep review notes within 1,000 characters.");
  const requiredPermission = permissionByAction[action];
  const { data: allowed, error: permissionError } = await supabase.rpc("has_permission", { required_permission: requiredPermission });
  if (permissionError) return response(500, "KYC_ACTION_PERMISSION_CHECK_FAILED", "The KYC action permission could not be checked.", permissionError.message);
  if (!allowed) return response(403, "KYC_ACTION_PERMISSION_DENIED", "You do not have permission to preview this KYC action.");
  if (!actor.assignedClientIds.includes(clientId)) return response(403, "KYC_ACTION_CLIENT_SCOPE_DENIED", "This client is outside your assigned scope.");
  return NextResponse.json({ ok: true, dryRun: true, mutationSubmitted: false, auditEventCreated: false, validated: { action, clientId, notesProvided: Boolean(notes) }, message: "KYC action validated. No approval, rejection, or audit mutation was submitted." });
}
