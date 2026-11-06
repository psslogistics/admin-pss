import { NextResponse } from "next/server";
import { requireEmployeeAccess } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const frequencies = new Set(["daily", "weekly", "monthly"]);
const deliveries = new Set(["download", "email"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(status: number, code: string, userMessage: string, technicalMessage = userMessage) {
  const requestId = crypto.randomUUID();
  return NextResponse.json({ error: { category: status === 403 ? "permission" : status >= 500 ? "server" : "request", code, user_safe_message: userMessage, technical_message: technicalMessage, retryable: false, stale_data: false, request_id: requestId } }, { status, headers: { "x-request-id": requestId } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  if (!claims.data?.claims?.sub) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Your session is missing or expired.");

  const actor = await requireEmployeeAccess();
  const { data: allowed, error: permissionError } = await supabase.rpc("has_permission", { required_permission: "admin.reports.schedule" });
  if (permissionError) return errorResponse(500, "REPORT_SCHEDULE_PERMISSION_CHECK_FAILED", "The report scheduling permission could not be checked.", permissionError.message);
  if (!allowed) return errorResponse(403, "REPORT_SCHEDULE_PERMISSION_DENIED", "You do not have permission to schedule reports.");

  let payload: { report?: unknown; frequency?: unknown; time?: unknown; timezone?: unknown; delivery?: unknown; recipientEmail?: unknown; clientId?: unknown };
  try { payload = await request.json(); } catch { return errorResponse(400, "REPORT_SCHEDULE_PAYLOAD_INVALID", "Provide a valid JSON scheduling request."); }
  const report = payload.report === "shipments" ? payload.report : null;
  const frequency = typeof payload.frequency === "string" && frequencies.has(payload.frequency) ? payload.frequency : null;
  const time = typeof payload.time === "string" && timePattern.test(payload.time) ? payload.time : null;
  const timezone = typeof payload.timezone === "string" && payload.timezone.length >= 1 && payload.timezone.length <= 64 ? payload.timezone : null;
  const delivery = typeof payload.delivery === "string" && deliveries.has(payload.delivery) ? payload.delivery : null;
  const recipientEmail = typeof payload.recipientEmail === "string" ? payload.recipientEmail.trim() : "";
  const clientId = typeof payload.clientId === "string" && payload.clientId.trim() ? payload.clientId.trim() : undefined;
  if (!report || !frequency || !time || !timezone || !delivery || (delivery === "email" && !emailPattern.test(recipientEmail))) {
    return errorResponse(400, "REPORT_SCHEDULE_PAYLOAD_INVALID", "Choose a shipment report, frequency, time, timezone, and delivery method. Email delivery requires a valid recipient.");
  }
  if (clientId && !actor.assignedClientIds.includes(clientId)) return errorResponse(403, "REPORT_SCHEDULE_CLIENT_SCOPE_DENIED", "This client is outside your assigned scope.");

  return NextResponse.json({ ok: true, dryRun: true, scheduleCreated: false, externalDeliveryStarted: false, validated: { report, frequency, time, timezone, delivery, recipientEmail: delivery === "email" ? recipientEmail : undefined, clientId: clientId ?? "all-assigned-clients" }, message: "Schedule validated. No recurring job, email, or external delivery was created." });
}
