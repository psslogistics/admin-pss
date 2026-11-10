import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const documentation = await readFile(new URL("../FUJIYAMA_API.md", import.meta.url), "utf8");

const checks = [
  ["tracking route", source.includes('route === "/fujiyama/tracking"')],
  ["booking route", source.includes('route === "/fujiyama/bookings"')],
  ["tracking scope", source.includes('hasScope(auth, "tracking.read")')],
  ["booking scope", source.includes('hasScope(auth, "shipments.create")')],
  ["both Fujiyama client IDs", source.includes('FUJIYAMA_FORWARD_CLIENT_ID = "b8bd8184-1b90-4a33-b6bd-9e5dbbd88b10"') && source.includes('FUJIYAMA_REVERSE_CLIENT_ID = "9c0fd0b5-8b5a-4a66-a2cb-4c0f4b6a9c31"')],
  ["lane-neutral account handling", source.includes("clientId === FUJIYAMA_FORWARD_CLIENT_ID || clientId === FUJIYAMA_REVERSE_CLIENT_ID") && source.includes('fujiyamaLane !== "forward" && fujiyamaLane !== "reverse"')],
  ["booking route has no document-scope gate", source.includes('if (route === "/fujiyama/bookings" && request.method === "POST")') && source.includes('if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment creation scope required"')],
  ["API booking can auto-register a pickup address", source.includes('if (!selectedWarehouseId && operation === "warehouse_prepare")') && source.includes('ensureDelhiveryWarehouse(env, clientId, delhiveryB2bToken, origin')],
  ["booking can derive provider invoice reference from order id", source.includes('payload.invoice_reference ?? payload.invoice_number ?? orderId')],
  ["warehouse registration has a dedicated account token", source.includes("DELHIVERY_WAREHOUSE_TOKEN_PSSLOGISTICS10_B2BC") && source.includes("DELHIVERY_WAREHOUSE_CREDENTIAL_REQUIRED")],
  ["warehouse registration does not use the B2B JWT fallback", source.includes('const registrationAttempts = [{') && !source.includes('contract: "b2b"')],
  ["legacy Fujiyama ID removed", !source.includes("bb308dde-aae8-4503-ac7b-f91cd80ada78")],
  ["system API-key administration", source.includes("if (auth.system) return true;")],
  ["API-key tenant binding", source.includes("clientIds: new Set([row.client_id])")],
  ["canonical booking delegation", source.includes('route = "/shipments"')],
  ["persisted booking reference", source.includes("provider_reference FROM shipments WHERE id = ? AND client_id = ?")],
  ["tracking uses client-scoped database lookup", /FROM shipments WHERE client_id = \? AND \(tracking_number = \? OR lr_number = \? OR provider_reference = \?\)/.test(source)],
  ["tracking refreshes Delhivery", (() => { const start = source.indexOf('route === "/fujiyama/tracking"'); const end = source.indexOf('route === "/fujiyama/bookings"', start); return start >= 0 && end > start && source.slice(start, end).includes('safeProviderRequest(env, "delhivery", "tracking"'); })()],
  ["tracking falls back to assigned Delhivery accounts", source.includes("No shipment found in PSS or the client’s active Delhivery accounts") && source.includes("FROM provider_accounts pa")],
  ["API tracking cannot cross tenants through provider fallback", source.includes('if (auth.kind === "api") return json({ ok: true, data: { tracking_type: trackingType, awb, found: false, source: "pss"')],
  ["tracking returns provider status", source.includes("provider_status: providerResult.status")],
  ["tracking supports empty database", source.includes('found: false') && source.includes('events: []')],
  ["API-key KYC uses server-only credential", source.includes("SUPABASE_SERVICE_ROLE_KEY?: string") && source.includes("env.SUPABASE_SERVICE_ROLE_KEY")],
  ["booking KYC lookup is shared and tenant-scoped", source.includes("async function loadBookingKyc") && source.includes("client_kyc_profiles?client_id=eq.${encodeURIComponent(clientId)}")],
  ["KYC lookup fails closed", source.includes('KYC_LOOKUP_UNAVAILABLE') && source.includes(', 503, id, headers')],
  ["booking does not bypass production KYC", source.includes("bookingKycApproved(kyc)") && source.includes("!kycTestAccount")],
  ["documentation contains both contracts", documentation.includes("/v1/fujiyama/tracking") && documentation.includes("/v1/fujiyama/bookings")],
  ["documentation names the two required scopes", documentation.includes("tracking.read") && documentation.includes("shipments.create")],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Fujiyama contract checks failed: ${failed.join(", ")}`);
console.log(`Fujiyama contract checks passed (${checks.length} checks).`);
