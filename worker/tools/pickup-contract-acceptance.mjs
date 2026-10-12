import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/20261012_pickup_scheduling_contract.sql", import.meta.url), "utf8");
const adminWorkspace = await readFile(new URL("../../components/dashboard/operations-workspace.tsx", import.meta.url), "utf8");

const checks = [
  ["canonical pickup fields are selected", ["requested_date", "requested_time_slot", "pickup_address", "contact_name", "contact_phone"].every((field) => source.includes(field))],
  ["canonical lifecycle statuses are accepted", ["draft", "requested", "provider_pending", "scheduled", "driver_assigned", "en_route", "picked_up", "completed", "cancelled", "failed"].every((status) => source.includes(`\"${status}\"`))],
  ["provider account is required and scoped", source.includes("PROVIDER_ACCOUNT_UNAVAILABLE") && source.includes("pa.status = 'active'")],
  ["pickup idempotency is required", source.includes("IDEMPOTENCY_KEY_REQUIRED") && source.includes("POST /v1/pickups")],
  ["attempt history is recorded", source.includes("recordPickupAttempt") && schema.includes("CREATE TABLE IF NOT EXISTS pickup_request_attempts")],
  ["provider slot references are persisted", source.includes("providerSlotId") && source.includes("provider_slot_id = COALESCE")],
  ["standalone provider AWBs persist across retries", source.includes("provider_awb_numbers_json") && source.includes("normalizePickupAwbNumbers") && migration.includes("provider_awb_numbers_json")],
  ["phone/date/email validation exists", source.includes("normalizePickupPhone") && source.includes("validPickupDate") && source.includes("Pickup contact email is invalid")],
  ["Delhivery pickup slots use the provider endpoint", source.includes("/web/api/forward_orders/pickup_slots/") && source.includes("pickup_slots_for_today") && source.includes("pickup_slots_for_next_day")],
  ["structured provider date and slot responses are preserved", source.includes("row.slots") && source.includes("hasEmbeddedSlots")],
  ["Delhivery pickup creation uses the B2B pickup endpoint", source.includes("/v2/web/api/orders/pickup_request") && source.includes("expected_package_count") && source.includes("awb_number")],
  ["legacy pickup endpoint is not used for B2B", !source.includes("/pickup_requests/")],
  ["provider warehouse reuse is tracked", source.includes("provider_status === \"active\"") && source.includes("reused: true") && migration.includes("provider_status")],
  ["migration carries canonical fields", ["provider_account_id", "warehouse_id", "provider_slot_id", "idempotency_key"].every((field) => migration.includes(field))],
  ["admin does not post incomplete pickup payloads", !adminWorkspace.includes('scheduled_date: new Date().toISOString().slice(0, 10)') && adminWorkspace.includes("Open the full Pickup desk")],
  ["provider webhook persists accepted pickup date and slot", source.includes("requested_date = COALESCE(?, requested_date)") && source.includes("requestedTimeSlot")],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Pickup contract checks failed: ${failed.join(", ")}`);
console.log(`Pickup contract checks passed (${checks.length} checks).`);
