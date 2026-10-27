import { calculatePssRate, defaultRateRows, type ChargeRule, type PricingAccount } from "./pricing-engine";
import { canonicalDelhiveryWarehouseName, delhiveryFacilityMatches } from "./warehouse-identity";
import { evaluateDelhiveryServiceability, serviceabilityCacheKey } from "./serviceability";

type DelhiveryTokenCache = {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export interface Env extends Omit<Cloudflare.Env, "SUPABASE_PUBLISHABLE_KEY" | "API_KEY_PEPPER" | "DELHIVERY_API_TOKEN" | "DELHIVERY_B2B_API_BASE_URL" | "DELHIVERY_WEBHOOK_SECRET" | "DELHIVERY_TOKEN_CACHE" | "EKART_API_KEY" | "EKART_API_SECRET" | "EKART_WEBHOOK_SECRET" | "EKART_ENABLE_PROVIDER_CALLS" | "TRACKON_API_BASE_URL" | "TRACKON_CREDENTIALS_JSON" | "TRACKON_WEBHOOK_SECRET" | "TRACKON_BOOKING_URL" | "TRACKON_TRACKING_URL" | "TRACKON_LABEL_URL" | "TRACKON_ENABLE_SHIPMENT_CREATION" | "TRACKON_ENABLE_PICKUP_CREATION" | "XPRESSBEES_API_BASE_URL" | "XPRESSBEES_CREDENTIALS_JSON" | "XPRESSBEES_ENABLE_SHIPMENT_CREATION" | "XPRESSBEES_ENABLE_PICKUP_CREATION" | "RIVIGO_API_BASE_URL" | "RIVIGO_AUTH_URL" | "RIVIGO_TRACKING_URL" | "RIVIGO_CREDENTIALS_JSON" | "RIVIGO_ENABLE_PROVIDER_CALLS"> {
  SUPABASE_PUBLISHABLE_KEY: string;
  API_KEY_PEPPER?: string;
  DELHIVERY_API_TOKEN?: string;
  DELHIVERY_B2B_API_BASE_URL?: string;
  DELHIVERY_WEBHOOK_SECRET?: string;
  DELHIVERY_TOKEN_CACHE?: DelhiveryTokenCache;
  EKART_API_KEY?: string;
  EKART_API_SECRET?: string;
  EKART_WEBHOOK_SECRET?: string;
  EKART_ENABLE_PROVIDER_CALLS?: string;
  TRACKON_API_BASE_URL?: string;
  TRACKON_CREDENTIALS_JSON?: string;
  TRACKON_WEBHOOK_SECRET?: string;
  TRACKON_BOOKING_URL?: string;
  TRACKON_TRACKING_URL?: string;
  TRACKON_LABEL_URL?: string;
  TRACKON_ENABLE_SHIPMENT_CREATION?: string;
  TRACKON_ENABLE_PICKUP_CREATION?: string;
  XPRESSBEES_API_BASE_URL?: string;
  XPRESSBEES_SERVICEABILITY_URL?: string;
  XPRESSBEES_CREDENTIALS_JSON?: string;
  XPRESSBEES_ENABLE_SHIPMENT_CREATION?: string;
  XPRESSBEES_ENABLE_PICKUP_CREATION?: string;
  RIVIGO_API_BASE_URL?: string;
  RIVIGO_AUTH_URL?: string;
  RIVIGO_TRACKING_URL?: string;
  RIVIGO_CREDENTIALS_JSON?: string;
  RIVIGO_WEBHOOK_SECRET?: string;
}

type CourierProvider = "delhivery" | "ekart" | "trackon" | "xpressbees" | "rivigo";

type Role = { role_code: string; scope: string };
type Auth = {
  kind: "user" | "api";
  userId?: string;
  clientId?: string;
  clientIds: Set<string>;
  roles: Set<string>;
  system: boolean;
  scopes: Set<string>;
  permissions: Set<string>;
  audience: "employee" | "client" | "system" | "unknown";
  apiKeyId?: string;
  accessToken?: string;
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const error = (code: string, message: string, status: number, requestId: string, headers: HeadersInit = {}, technicalMessage = message) => { const normalized = code.toUpperCase(); const category = status === 401 ? "auth" : status === 403 ? "permission" : normalized.includes("CONFIG") || normalized.includes("CREDENTIAL") ? "configuration" : normalized.includes("PROVIDER") || normalized.includes("DELHIVERY") ? "provider" : status >= 500 ? "server" : status === 408 || status === 429 ? "network" : "request"; const retryable = status === 408 || status === 409 || status === 429 || status >= 500 || category === "provider"; return json({ ok: false, error: { code, category, message, user_safe_message: message, technical_message: technicalMessage, provider_code: category === "provider" ? code : undefined, request_id: requestId, retryable, stale_data: false }, request_id: requestId }, status, headers); };
const isD1QuotaError = (message: string) => /D1_ERROR: Your account has exceeded D1's free tier daily row (read|write) limit/i.test(message);
const requestId = (request: Request) => request.headers.get("cf-ray") ?? crypto.randomUUID();
const userAuthInFlight = new Map<string, Promise<Auth | null>>();
const userAuthCache = new Map<string, { expiresAt: number; value: Auth | null }>();
const dashboardSummaryCache = new Map<string, { expiresAt: number; data: Record<string, unknown> }>();
const shipmentStatusCountsCache = new Map<string, { expiresAt: number; counts: Record<string, number> }>();
const AUTH_CACHE_TTL_MS = 5_000;
// Keep dashboard reads bounded and coalesce repeated panel loads. D1 bills by
// rows read, so an unbounded dashboard collection can exhaust the free daily
// quota even when the UI only needs the latest operational records.
const SUMMARY_CACHE_TTL_MS = 60_000;
const SHIPMENT_STATUS_COUNTS_CACHE_TTL_MS = 60_000;
const DELHIVERY_SERVICEABILITY_CACHE_TTL_MS = 10 * 60_000;
const delhiveryServiceabilityCache = new Map<string, { expiresAt: number; result: DelhiveryServiceabilityResult }>();
const KYC_TEST_ACCOUNT_EMAIL = "itismeoogway@gmail.com";

type DelhiveryServiceabilityResult = {
  ok: boolean;
  provenance: "live_provider" | "cached_provider" | "provider_unavailable";
  origin: Record<string, unknown>;
  destination: Record<string, unknown>;
  route?: Record<string, unknown>;
  reason?: string;
};

function allowedOrigins(env: Env) { return new Set((env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)); }
function originAllowed(request: Request, env: Env) { const origin = request.headers.get("Origin"); return !origin || allowedOrigins(env).has(origin); }
function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = { "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, X-Webhook-Signature, X-Delhivery-Webhook-Token", "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS", "access-control-max-age": "86400", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", vary: "Origin" };
  if (origin && allowedOrigins(env).has(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
function withCors(request: Request, env: Env, headers: HeadersInit = {}) { return { ...corsHeaders(request, env), ...headers }; }
function textBytes(value: string) { return new TextEncoder().encode(value); }
function hex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sha256(value: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", textBytes(value)))); }
function timingSafeEqual(left: string, right: string) { const a = textBytes(left); const b = textBytes(right); const length = Math.max(a.length, b.length); let result = a.length ^ b.length; for (let index = 0; index < length; index += 1) result |= (a[index] ?? 0) ^ (b[index] ?? 0); return result === 0; }
async function hmac(secret: string, payload: string) { const key = await crypto.subtle.importKey("raw", textBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, textBytes(payload)))); }
function documentSignatureMatches(contentType: string, bytes: Uint8Array) {
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (contentType === "application/pdf") {
    // PDF producers may emit a short whitespace/BOM preamble before the
    // %PDF header. The PDF specification permits the header within the first
    // 1024 bytes, so checking only byte 0 rejects otherwise valid documents
    // such as generated delivery challans.
    const header = [0x25, 0x50, 0x44, 0x46];
    const maxOffset = Math.min(1024, bytes.length - header.length);
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      if (header.every((value, index) => bytes[offset + index] === value)) return true;
    }
    return false;
  }
  if (contentType === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (contentType === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (contentType === "image/webp") return startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return startsWith(0x50, 0x4b, 0x03, 0x04);
  if (contentType === "application/msword" || contentType === "application/vnd.ms-excel") return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  if (contentType === "text/csv" || contentType === "application/csv") {
    const sample = new TextDecoder().decode(bytes.slice(0, 4096));
    return !sample.includes("\u0000");
  }
  return false;
}

async function supabaseGet<T>(env: Env, path: string, token: string): Promise<T[]> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) return [];
  const value = await response.json();
  return Array.isArray(value) ? value as T[] : [];
}

async function supabaseRpc<T>(env: Env, functionName: string, token: string): Promise<T | null> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) return null;
  return await response.json() as T;
}

async function isKycTestAccount(env: Env, auth: Auth): Promise<boolean> {
  if (auth.audience !== "client" || !auth.userId || !auth.accessToken) return false;
  const users = await supabaseGet<{ email: string | null }>(env, `profiles?id=eq.${encodeURIComponent(auth.userId)}&select=email&limit=1`, auth.accessToken);
  return users[0]?.email?.trim().toLowerCase() === KYC_TEST_ACCOUNT_EMAIL;
}

async function loadUserAuth(env: Env, token: string): Promise<Auth | null> {
  type AuthContext = {
    user_id?: string;
    profile_status?: string | null;
    employment_status?: string | null;
    roles?: Role[];
    permissions?: Array<{ permission_key?: string }>;
    permission_overrides?: Array<{ permission_key?: string; mode?: "grant" | "revoke" }>;
    assignments?: Array<{ client_id?: string }>;
    memberships?: Array<{ client_id?: string; membership_status?: string }>;
    active_client_ids?: string[];
    audience?: "employee" | "client" | "unknown";
  };
  const context = await supabaseRpc<AuthContext>(env, "get_auth_context", token);
  if (!context?.user_id) return null;
  if (context.profile_status && context.profile_status !== "active") return null;
  if (context.employment_status && context.employment_status !== "active") return null;
  const clientIds = new Set((context.active_client_ids ?? []).filter(Boolean));
  // Keep the concrete role codes for permission-specific checks, but also add
  // the canonical scope from Supabase. The production client role is
  // `client_user`, while Worker route checks use the shared `client` scope.
  const roles = context.roles ?? [];
  const roleSet = new Set(roles.flatMap((role) => [role.role_code, role.scope]));
  const system = roles.some((role) => role.scope === "system" || role.role_code === "super_admin");
  const permissions = new Set((context.permissions ?? []).map((row) => row.permission_key).filter((value): value is string => Boolean(value)));
  const permissionOverrides = context.permission_overrides ?? [];
  for (const override of permissionOverrides) if (override.mode === "grant" && override.permission_key) permissions.add(override.permission_key);
  // Match the Supabase `has_permission` policy: an explicit revoke wins over
  // a grant, independent of the order returned by PostgREST.
  for (const override of permissionOverrides) if (override.mode === "revoke" && override.permission_key) permissions.delete(override.permission_key);
  return { kind: "user", userId: context.user_id, clientIds, roles: roleSet, system, audience: system ? "system" : (context.audience ?? "unknown"), scopes: new Set(["authenticated"]), permissions, accessToken: token };
}

async function authenticate(request: Request, env: Env): Promise<Auth | null> {
  const header = request.headers.get("Authorization") ?? "";
  if (header.startsWith("ApiKey ")) {
    const raw = header.slice(7).trim();
    if (!raw || raw.length > 256) return null;
    const pepper = env.API_KEY_PEPPER ?? "";
    const hashes = pepper ? [await sha256(`${raw}${pepper}`), await sha256(raw)] : [await sha256(raw)];
    let row: { id: string; client_id: string; expires_at: string | null } | null = null;
    for (const hash of hashes) { row = await env.DB.prepare("SELECT id, client_id, expires_at FROM api_keys WHERE key_hash = ? AND status = 'active' LIMIT 1").bind(hash).first<{ id: string; client_id: string; expires_at: string | null }>(); if (row) break; }
    if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
    const scopes = await env.DB.prepare("SELECT scope FROM api_key_scopes WHERE api_key_id = ?").bind(row.id).all<{ scope: string }>();
    return { kind: "api", clientId: row.client_id, clientIds: new Set([row.client_id]), roles: new Set(), system: false, audience: "client", scopes: new Set(scopes.results.map((item) => item.scope)), permissions: new Set(), apiKeyId: row.id };
  }
  if (!header.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 8192) return null;
  const tokenKey = await sha256(token);
  const cached = userAuthCache.get(tokenKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = userAuthInFlight.get(tokenKey);
  if (pending) return pending;
  const validation = loadUserAuth(env, token);
  userAuthInFlight.set(tokenKey, validation);
  try {
    const value = await validation;
    userAuthCache.set(tokenKey, { expiresAt: Date.now() + AUTH_CACHE_TTL_MS, value });
    return value;
  } finally {
    if (userAuthInFlight.get(tokenKey) === validation) userAuthInFlight.delete(tokenKey);
  }
}

function hasScope(auth: Auth, scope: string) {
  if (auth.kind === "api") return auth.scopes.has(scope);
  // System identities (including Super Admin) are the organization-level
  // control plane and must be able to manage scoped integration credentials.
  // Keep API-key identities on their explicit scopes above; this branch only
  // applies to authenticated first-party system users.
  if (auth.system) return true;
  const permissionMap: Record<string, string[]> = {
    "shipments.read": ["shipments.read", "shipments.view", "admin.shipments.view", "admin.shipments.assigned.view", "admin.tracking.view"], "tracking.read": ["tracking.read", "tracking.view", "admin.tracking.view"],
    "shipments.sensitive.read": ["shipments.sensitive.read", "admin.shipments.sensitive.view"],
    "shipments.create": ["shipments.create", "admin.booking.create"], "pickups.read": ["pickups.read", "pickup.view", "admin.pickup.view"],
    "pickups.create": ["pickups.create", "pickup.create", "admin.pickup.create"], "pickups.manage": ["pickups.manage", "pickup.assign", "admin.pickup.assign"],
    "documents.read": ["documents.read", "admin.documents.pod.view", "admin.documents.pod.download"], "documents.manage": ["documents.manage", "admin.booking.create"],
    "reports.read": ["reports.read", "reports.view", "admin.reports.view"], "tickets.read": ["tickets.read", "tickets.view", "admin.support.view"],
    "tickets.create": ["tickets.create", "tickets.reply", "admin.tickets.create"], "notifications.read": ["notifications.read", "notifications.view", "admin.notifications.view"],
    "cases.read": ["cases.read", "exceptions.view", "admin.exceptions.view"], "cases.manage": ["cases.manage", "exceptions.manage", "admin.exceptions.manage", "admin.tracking.update"],
    "addresses.manage": ["addresses.manage", "admin.booking.create"], "quotes.create": ["quotes.create", "admin.booking.create"],
    "billing.read": ["billing.read", "billing.view"], "wallet.read": ["wallet.read", "transactions.view"],
    "billing.manage": ["billing.manage", "billing.create", "billing.approve"], "wallet.manage": ["wallet.manage", "transactions.manage"],
    "cod.read": ["cod.read", "transactions.view"], "cod.manage": ["cod.manage", "billing.approve"], "weight.read": ["weight.read", "billing.view", "admin.weight.view"], "weight.manage": ["weight.manage", "billing.approve", "admin.weight.manage"],
    "tasks.read": ["tasks.read", "tasks.view", "admin.tasks.view"], "tasks.manage": ["tasks.manage", "admin.tasks.manage"],
    "departments.read": ["departments.read", "departments.view", "admin.departments.view"], "departments.manage": ["departments.manage", "admin.departments.manage"],
    "activity.read": ["activity.read", "employee_activity.view", "admin.activity.view"],
    "integrations.read": ["integrations.view", "admin.integrations.view"], "webhooks.read": ["api_keys.view", "integrations.view", "admin.api_keys.view"],
    "provider_accounts.read": ["integrations.view", "admin.integrations.view"], "provider_accounts.manage": ["integrations.manage", "admin.integrations.manage"],
    "pricing.read": ["pricing.view", "admin.pricing.view", "rate_cards.manage", "admin.rate_cards.view", "admin.rate_cards.manage"],
    "pricing.manage": ["pricing.manage", "admin.pricing.manage", "rate_cards.manage", "admin.rate_cards.manage"],
    "pricing.publish": ["pricing.publish", "admin.pricing.publish", "rate_cards.manage", "admin.rate_cards.manage"],
    "pricing.override": ["pricing.override", "admin.pricing.override", "rate_cards.manage", "admin.rate_cards.manage"],
    "provider_cost.view": ["provider_cost.view", "admin.provider_cost.view"],
    "documents.pod.download": ["documents.pod.download", "admin.documents.pod.download"],
    "weight.view": ["weight.view", "admin.weight.view"], "weight.update": ["weight.update", "admin.weight.manage"], "weight.resolve": ["weight.resolve", "admin.weight.resolve"],
    "tickets.close": ["tickets.close", "admin.tickets.close"], "tickets.reassign": ["tickets.reassign", "admin.tickets.reassign"],
    "weight_dispute.resolve": ["weight_dispute.resolve", "admin.weight_dispute.resolve", "admin.weight.resolve"],
  };
  if (permissionMap[scope]?.some((permission) => auth.permissions.has(permission))) return true;
  if (auth.roles.has("employee")) return false;
  const roles = auth.roles;
  if (["shipments.read", "tracking.read", "pickups.read", "documents.read", "reports.read", "departments.read"].includes(scope)) return roles.has("client") || roles.has("employee") || roles.has("admin");
  if (["shipments.create", "pickups.create", "documents.manage", "tickets.create", "tickets.read", "notifications.read", "cases.read", "cases.manage", "addresses.manage", "quotes.create", "billing.read", "wallet.read", "cod.read", "weight.read", "tasks.read", "activity.read"].includes(scope)) return roles.has("client") || roles.has("employee") || roles.has("admin");
  if (scope === "pickups.manage") return roles.has("client") || roles.has("employee") || roles.has("admin");
  if (scope === "tasks.manage") return roles.has("employee") || roles.has("admin");
  if (scope === "departments.manage") return roles.has("admin") || roles.has("super_admin");
  if (scope === "provider_accounts.read") return roles.has("admin") || roles.has("super_admin");
  if (scope === "provider_accounts.manage") return roles.has("admin") || roles.has("super_admin");
  if (["billing.manage", "wallet.manage", "cod.manage", "weight.manage"].includes(scope)) return roles.has("admin") || roles.has("super_admin");
  if (scope === "weight_dispute.resolve") return roles.has("admin") || roles.has("super_admin");
  if (["api_keys.read", "api_keys.manage", "integrations.read", "webhooks.read"].includes(scope)) return roles.has("admin");
  return false;
}
const API_KEY_SCOPES = new Set(["shipments.read", "tracking.read", "shipments.create", "pickups.read", "pickups.create", "pickups.manage", "documents.read", "documents.manage", "reports.read", "tickets.read", "tickets.create", "notifications.read", "cases.read", "cases.manage", "addresses.manage", "quotes.create", "billing.read", "billing.manage", "wallet.read", "wallet.manage", "cod.read", "cod.manage", "weight.read", "weight.manage", "tasks.read", "tasks.manage", "activity.read"]);
const shipmentTransitions: Record<string, Set<string>> = {
  booked: new Set(["booked", "picked_up", "cancelled", "exception"]),
  picked_up: new Set(["picked_up", "in_transit", "exception"]),
  in_transit: new Set(["in_transit", "out_for_delivery", "exception", "rto"]),
  out_for_delivery: new Set(["out_for_delivery", "delivered", "exception"]),
  exception: new Set(["exception", "in_transit", "out_for_delivery", "rto", "cancelled"]),
  delivered: new Set(["delivered"]),
  rto: new Set(["rto", "delivered"]),
  cancelled: new Set(["cancelled"]),
};
const taskStatuses = new Set(["pending", "in_progress", "completed", "cancelled"]);
const taskPriorities = new Set(["low", "medium", "high", "urgent"]);
function validShipmentTransition(current: string, next: string) { return shipmentTransitions[current]?.has(next) ?? current === next; }
function validProviderShipmentTransition(current: string, next: string) {
  if (current === next) return true;
  if (current === "delivered" || current === "rto") return false;
  // Delhivery can report a previously failed/local-exception record as
  // "Not Picked". That is still a booked shipment, so allow the provider's
  // explicit booked state to reconcile the stale local exception.
  if (current === "exception" && next === "booked") return true;
  if (next === "cancelled" || next === "exception") return true;
  const order: Record<string, number> = { booked: 0, picked_up: 1, in_transit: 2, out_for_delivery: 3, delivered: 4, rto: 4 };
  return order[next] !== undefined && order[current] !== undefined && order[next] > order[current];
}
function normalizeProviderShipmentStatus(value: unknown) {
  const status = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  // An absent provider status is unknown, never in transit. Treating a
  // missing/unsupported response as transit creates false movement and can
  // overwrite a real booking failure across every panel.
  if (!status) return "unknown";
  if (["booked", "manifested", "pickup_scheduled", "order_created", "not_picked", "not_picked_up", "not_picked_yet", "not_pickup"].includes(status)) return "booked";
  if (["picked", "picked_up", "pickup_complete", "pickup_completed"].includes(status)) return "picked_up";
  if (["in_transit", "transit", "shipped", "dispatched", "out_for_pickup"].includes(status)) return "in_transit";
  if (["out_for_delivery", "out_for_del", "ofd"].includes(status)) return "out_for_delivery";
  if (["delivered", "delivery_complete", "delivered_successfully"].includes(status)) return "delivered";
  if (["rto", "returned", "return_to_origin", "return_to_sender"].includes(status)) return "rto";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["exception", "failed", "undelivered", "delivery_failed", "delivery_attempt_failed"].includes(status)) return "exception";
  return "exception";
}
function hasRole(auth: Auth, roles: string[]) { return auth.system || roles.some((role) => auth.roles.has(role)); }
function canAccessClient(auth: Auth, clientId: string) { return auth.system || auth.clientIds.has(clientId); }
function providerAccountId(payload: Record<string, unknown>) {
  const value = payload.provider_account_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function delhiveryPricingAccountFromName(accountName: string): PricingAccount {
  return /(^|\D)04(\D|$)/.test(accountName) ? "04" : /(^|\D)08(\D|$)/.test(accountName) ? "08" : "other";
}
function requireClient(auth: Auth, requested: unknown) {
  const requestedId = typeof requested === "string" ? requested.trim() : "";
  if (auth.kind === "api") return auth.clientId ?? null;
  if (auth.system) return requestedId || (auth.clientIds.size === 1 ? [...auth.clientIds][0] : null);
  if (requestedId && auth.clientIds.has(requestedId)) return requestedId;
  if (auth.clientId) return auth.clientId;
  if (auth.clientIds.size === 1) return [...auth.clientIds][0];
  return null;
}
async function shipmentBelongsToClient(env: Env, shipmentId: unknown, clientId: string) {
  if (typeof shipmentId !== "string" || !shipmentId.trim()) return false;
  const shipment = await env.DB.prepare("SELECT id FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(shipmentId.trim(), clientId).first<{ id: string }>();
  return Boolean(shipment);
}
async function employeeCanBeAssigned(env: Env, auth: Auth, employeeId: unknown, clientId: string) {
  if (employeeId === null || employeeId === undefined || employeeId === "") return true;
  if (typeof employeeId !== "string" || !auth.accessToken) return false;
  const employee = await supabaseGet<{ user_id: string; employment_status?: string }>(env, `employee_profiles?user_id=eq.${encodeURIComponent(employeeId)}&select=user_id,employment_status`, auth.accessToken);
  if (!employee.length || (employee[0].employment_status && employee[0].employment_status !== "active")) return false;
  if (auth.system) return true;
  const assignments = await supabaseGet<{ client_id: string }>(env, `employee_client_assignments?employee_user_id=eq.${encodeURIComponent(employeeId)}&client_id=eq.${encodeURIComponent(clientId)}&is_active=eq.true&select=client_id`, auth.accessToken);
  return assignments.length > 0;
}
async function refreshTicketEscalations(env: Env) {
  await env.DB.prepare("UPDATE support_tickets SET escalation_state = 'overdue', updated_at = CURRENT_TIMESTAMP WHERE escalation_state = 'normal' AND sla_due_at IS NOT NULL AND datetime(sla_due_at) < CURRENT_TIMESTAMP AND status NOT IN ('resolved', 'closed')").run();
}

async function bodyJson(request: Request, maxBytes = 1024 * 1024) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  try { return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; } catch { throw new Error("INVALID_JSON"); }
}
async function audit(env: Env, ctx: ExecutionContext, auth: Auth, requestIdValue: string, eventType: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  const clientId = typeof metadata.client_id === "string" ? metadata.client_id : auth.clientId ?? null;
  const shipmentId = typeof metadata.shipment_id === "string" ? metadata.shipment_id : entityType === "shipment" ? entityId : null;
  ctx.waitUntil(env.DB.prepare("INSERT INTO activity_events (id, actor_user_id, client_id, shipment_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), auth.userId ?? `api:${auth.clientId ?? "unknown"}`, clientId, shipmentId, eventType, entityType, entityId, JSON.stringify({ request_id: requestIdValue, ...metadata })).run());
}

async function recalculateWalletBalances(env: Env, clientId: string) {
  await env.DB.prepare(`UPDATE wallet_transactions AS current
    SET balance_after = (
      SELECT COALESCE(SUM(CASE
        WHEN lower(COALESCE(prior.type, '')) IN ('debit', 'charge', 'withdrawal') THEN -ABS(prior.amount)
        ELSE ABS(prior.amount)
      END), 0)
      FROM wallet_transactions AS prior
      WHERE prior.client_id = current.client_id
        AND prior.status IN ('posted', 'approved')
        AND (prior.created_at < current.created_at OR (prior.created_at = current.created_at AND prior.id <= current.id))
    )
    WHERE current.client_id = ?`).bind(clientId).run();
}
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
async function payloadFingerprint(payload: unknown) { return `sha256:${await sha256(stableSerialize(payload))}`; }

function normalizeWarehouseIdentityPart(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
async function idempotentResponse(env: Env, key: string | null, clientId: string, endpoint: string, requestHash?: string) {
  if (!key || key.length > 128) return null;
  const existing = await env.DB.prepare("SELECT response_status, response_body, request_hash FROM idempotency_keys WHERE idempotency_key = ? AND client_id = ? AND endpoint = ? AND expires_at > CURRENT_TIMESTAMP").bind(key, clientId, endpoint).first<{ response_status: number; response_body: string; request_hash: string | null }>();
  if (!existing) return null;
  if (requestHash && existing.request_hash?.startsWith("sha256:") && existing.request_hash !== requestHash) return { response_status: 409, response_body: JSON.stringify({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Idempotency-Key was already used with a different request payload" } }) };
  return existing;
}
async function saveIdempotent(env: Env, key: string, clientId: string, endpoint: string, responseStatus: number, body: string, requestHash: string) { await env.DB.prepare("INSERT INTO idempotency_keys (idempotency_key, client_id, endpoint, request_hash, response_status, response_body, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))").bind(key, clientId, endpoint, requestHash, responseStatus, body).run(); }
async function rateLimitExceeded(env: Env, key: string, limit: number) {
  const windowStart = Math.floor(Date.now() / 60000);
  await env.DB.prepare("INSERT INTO request_rate_limits (rate_key, window_start, request_count) VALUES (?, ?, 1) ON CONFLICT(rate_key) DO UPDATE SET window_start = CASE WHEN request_rate_limits.window_start = excluded.window_start THEN request_rate_limits.window_start ELSE excluded.window_start END, request_count = CASE WHEN request_rate_limits.window_start = excluded.window_start THEN request_rate_limits.request_count + 1 ELSE 1 END").bind(key, windowStart).run();
  const current = await env.DB.prepare("SELECT request_count FROM request_rate_limits WHERE rate_key = ? LIMIT 1").bind(key).first<{ request_count: number }>();
  return Number(current?.request_count ?? limit + 1) > limit;
}
async function rateLimited(env: Env, request: Request, auth: Auth, route: string) {
  const identity = auth.userId ?? auth.clientId ?? request.headers.get("CF-Connecting-IP") ?? "anonymous";
  const key = await sha256(`${identity}:${route}`);
  return rateLimitExceeded(env, key, 120);
}
const pricingPreviewBuckets = new Map<string, { windowStart: number; count: number }>();
function pricingPreviewRateLimited(request: Request, auth: Auth, limit = 30) {
  const identity = auth.userId ?? auth.clientId ?? request.headers.get("CF-Connecting-IP") ?? "anonymous";
  const windowStart = Math.floor(Date.now() / 60000);
  const bucket = pricingPreviewBuckets.get(identity);
  const next = !bucket || bucket.windowStart !== windowStart ? { windowStart, count: 1 } : { windowStart, count: bucket.count + 1 };
  pricingPreviewBuckets.set(identity, next);
  if (pricingPreviewBuckets.size > 10000) for (const [key, value] of pricingPreviewBuckets) if (value.windowStart !== windowStart) pricingPreviewBuckets.delete(key);
  return next.count > limit;
}
async function publicRateLimited(env: Env, request: Request, route: string, limit = 30) {
  const identity = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "anonymous";
  const key = await sha256(`public:${identity}:${route}`);
  return rateLimitExceeded(env, key, limit);
}

function ekartAddress(value: unknown, fallbackName: string) {
  const address = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pincode = String(address.pincode ?? "").trim();
  const line = String(address.line ?? address.address_line1 ?? "").trim();
  const city = String(address.city ?? "").trim();
  const state = String(address.state ?? "").trim();
  const name = String(address.name ?? fallbackName).trim();
  const phone = String(address.phone ?? address.primary_contact_number ?? "").trim();
  if (!name || !line || !city || !state || !/^\d{6}$/.test(pincode) || !/^\d{10}$/.test(phone)) return null;
  return { first_name: name, address_line1: line, pincode, city, state, primary_contact_number: phone };
}

function ekartCreatePayload(payload: Record<string, unknown>) {
  const origin = ekartAddress(payload.origin_address, String(payload.origin ?? "Origin"));
  const destination = ekartAddress(payload.destination_address, String(payload.consignee ?? "Consignee"));
  if (!origin || !destination) return null;
  const value = Math.max(Number(payload.declared_value ?? 0), 0);
  const weight = Math.max(Number(payload.total_weight_kg ?? 0), 0);
  const pieces = Math.max(Number(payload.pieces ?? 1), 1);
  if (!weight) return null;
  const paymentMode = String(payload.payment_mode ?? "prepaid").toLowerCase() === "cod" ? "C" : "P";
  const trackingId = typeof payload.tracking_number === "string" && payload.tracking_number.trim() ? payload.tracking_number.trim() : `PSS${paymentMode}${String(Date.now()).slice(-10)}`;
  const item = { product_id: String(payload.product_id ?? payload.shipment_id ?? trackingId), category: String(payload.category ?? "General goods"), product_title: String(payload.description ?? "Shipment"), quantity: String(pieces), cost: { totalSaleValue: value.toFixed(2), totalTaxValue: "0.00", tax_breakup: { cgst: "0.00", sgst: "0.00", igst: "0.00" } }, seller_details: { seller_reg_name: String(payload.seller_name ?? "PSS Logistics"), vat_id: "", cst_id: "", gstin_id: String(payload.gstin ?? "") }, hsn: String(payload.hsn ?? ""), item_attributes: [], handling_attributes: [] };
  return { request_Id: String(payload.request_id ?? crypto.randomUUID()), client_name: "PSS", services: [{ service_code: String(payload.service_code ?? "ECONOMY"), service_details: [{ service_leg: "FORWARD", service_data: { vendor_name: "Ekart", amount_to_collect: paymentMode === "C" ? value.toFixed(2) : "0.00", dispatch_date: new Date().toISOString().slice(0, 19).replace("T", " "), source: { address: origin }, destination: { address: destination }, return_location: { address: origin } }, shipment: { tracking_id: trackingId, shipment_value: value.toFixed(2), shipment_dimensions: { length: { value: Number(payload.length ?? 0) }, breadth: { value: Number(payload.width ?? 0) }, height: { value: Number(payload.height ?? 0) }, weight: { value: weight } }, shipment_items: [item] } }] }] };
}

function delhiveryAddress(value: unknown, fallbackName: string) {
  const address = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const line = String(address.line ?? address.address_line1 ?? address.address ?? "").trim();
  const city = String(address.city ?? "").trim();
  const state = String(address.state ?? "").trim();
  const pincode = String(address.pincode ?? address.pin ?? "").trim();
  const name = String(address.name ?? fallbackName).trim();
  const phone = String(address.phone ?? address.primary_contact_number ?? "").replace(/[^0-9]/g, "").slice(-10);
  if (!line || !city || !state || !/^\d{6}$/.test(pincode) || !/^\d{10}$/.test(phone)) return null;
  return { line, city, state, pincode, name, phone, email: String(address.email ?? "").trim(), country: String(address.country ?? "India").trim() || "India" };
}

function shipmentAddress(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Record<string, unknown>;
  const line = String(address.line ?? address.address_line1 ?? address.address ?? "").trim();
  const city = String(address.city ?? "").trim();
  const state = String(address.state ?? "").trim();
  const pincode = String(address.pincode ?? address.pin ?? "").trim();
  const phone = String(address.phone ?? address.primary_contact_number ?? "").replace(/\D/g, "").slice(-10);
  const name = String(address.name ?? "").trim();
  if (!name || !line || !city || !state || !/^\d{6}$/.test(pincode) || !/^\d{10}$/.test(phone)) return null;
  return { ...address, name, line, city, state, pincode, phone };
}

function providerAmount(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["amount", "shipping_charge", "freight", "total_amount", "billing_amount"]) { const amount = Number(record[key]); if (Number.isFinite(amount) && amount >= 0) return amount; }
  return null;
}

function volumetricWeightFromPayload(payload: Record<string, unknown>) {
  const explicit = Number(payload.volumetric_weight_kg);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const groups = Array.isArray(payload.dimensions) ? payload.dimensions : [];
  const calculated = groups.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const group = item as Record<string, unknown>; const length = Number(group.length); const width = Number(group.width); const height = Number(group.height); const quantity = Number(group.quantity ?? group.boxCount ?? group.box_count ?? 1);
    return Number.isFinite(length) && Number.isFinite(width) && Number.isFinite(height) && length > 0 && width > 0 && height > 0 && Number.isFinite(quantity) && quantity > 0 ? sum + (length * width * height * quantity) / 5000 : sum;
  }, 0);
  if (calculated > 0) return calculated;
  const length = Number(payload.length); const width = Number(payload.width); const height = Number(payload.height); const quantity = Number(payload.pieces ?? 1);
  return Number.isFinite(length) && Number.isFinite(width) && Number.isFinite(height) && length > 0 && width > 0 && height > 0 ? (length * width * height * Math.max(quantity, 1)) / 5000 : 0;
}

function normalizeShipmentDimensions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const group = item as Record<string, unknown>;
    const length = Number(group.length);
    const width = Number(group.width ?? group.breadth);
    const height = Number(group.height);
    const quantity = Number(group.quantity ?? group.boxCount ?? group.box_count ?? 1);
    if (![length, width, height, quantity].every((number) => Number.isFinite(number) && number > 0) || !Number.isInteger(quantity)) return [];
    return [{ length, width, height, quantity }];
  });
}

type PricingQuoteRecord = { id: string; version_id: string; account_scope: string; origin_zone: string; destination_zone: string; chargeable_weight_kg: number; client_breakdown_json: string };
function billingLineItemStatements(env: Env, billingId: string, shipmentId: string, clientId: string, breakdownJson: string) {
  let lines: Array<{ code?: unknown; label?: unknown; amount?: unknown; marker?: unknown }> = [];
  try {
    const parsed = JSON.parse(breakdownJson) as { lines?: unknown };
    lines = Array.isArray(parsed.lines) ? parsed.lines.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object")) : [];
  } catch {
    return [];
  }
  return lines.flatMap((line, displayOrder) => {
    const code = String(line.code ?? "").trim();
    const label = String(line.label ?? code).trim();
    const amount = Number(line.amount);
    if (!code || !label || !Number.isFinite(amount)) return [];
    return [env.DB.prepare("INSERT INTO billing_line_items (id, billing_id, shipment_id, client_id, code, label, amount, marker, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), billingId, shipmentId, clientId, code, label, amount, line.marker === "*" ? "*" : null, displayOrder)];
  });
}

async function completeShipmentBilling(env: Env, clientId: string, shipmentId: string) {
  const existing = await env.DB.prepare("SELECT id FROM billing_records WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(shipmentId, clientId).first<{ id: string }>();
  if (existing) return { ok: true as const, alreadyCompleted: true as const };
  const snapshot = await env.DB.prepare("SELECT client_breakdown_json FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(shipmentId, clientId).first<{ client_breakdown_json: string }>();
  if (!snapshot) return { ok: false as const, error: "Pricing snapshot was not found for the completed shipment" };
  let amount = 0;
  try { amount = Number((JSON.parse(snapshot.client_breakdown_json) as { total?: number }).total ?? 0); } catch { amount = 0; }
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, error: "The completed shipment has an invalid PSS amount" };
  const wallet = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN lower(COALESCE(type, '')) IN ('debit', 'charge', 'withdrawal') THEN -ABS(amount) ELSE ABS(amount) END), 0) AS balance FROM wallet_transactions WHERE client_id = ? AND status IN ('posted', 'approved')").bind(clientId).first<{ balance: number }>();
  if (Number(wallet?.balance ?? 0) < amount) return { ok: false as const, error: "The client wallet does not have enough balance for this completed PSS booking" };
  // Shipment-scoped identifiers make reconciliation idempotent even if the
  // provider-status poll and the scheduled reconciler observe the LR together.
  const billingId = `shipment-${shipmentId}`;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO billing_records (id, client_id, shipment_id, invoice_number, amount, status, paid_at) VALUES (?, ?, ?, ?, ?, 'paid', CURRENT_TIMESTAMP)").bind(billingId, clientId, shipmentId, `INV-${billingId.slice(0, 8).toUpperCase()}`, amount),
      env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, 'debit', ?, ?, 'posted', 0)").bind(`wallet-${shipmentId}`, clientId, amount, `SHIPMENT-${shipmentId}`),
      ...billingLineItemStatements(env, billingId, shipmentId, clientId, snapshot.client_breakdown_json),
    ]);
  } catch (caught) {
    // The synchronous booking response and the scheduled LR reconciler can
    // observe the same provider reference together. Treat a concurrent
    // winner as success instead of surfacing a false billing failure.
    const winner = await env.DB.prepare("SELECT id, status FROM billing_records WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(shipmentId, clientId).first<{ id: string; status: string }>();
    if (winner?.status === "paid") return { ok: true as const, alreadyCompleted: true as const };
    throw caught;
  }
  await recalculateWalletBalances(env, clientId);
  return { ok: true as const, alreadyCompleted: false as const, amount };
}
async function pricingPincode(env: Env, pincode: string) {
  if (!/^\d{6}$/.test(pincode)) return null;
  return env.DB.prepare("SELECT pincode, facility_city, facility_state, oda FROM delhivery_b2b_pincode_zones WHERE pincode = ? LIMIT 1").bind(pincode).first<{ pincode: string; facility_city: string; facility_state: string; oda: number }>();
}
/**
 * Provision the built-in PSS B2B card when a client has no published version.
 *
 * Client creation is owned by the Master app (Supabase), while pricing is
 * persisted in Worker D1. Keeping this operation idempotent at the Worker
 * boundary makes both new and already-created clients self-healing without
 * replacing a rate card that an administrator has explicitly published.
 */
async function ensureDefaultClientPricing(env: Env, clientId: string, actor = "system") {
  const existing = await env.DB.prepare("SELECT id, status, effective_at, minimum_weight_kg, volumetric_divisor, gst_percent FROM pricing_versions WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active' AND datetime(effective_at) <= CURRENT_TIMESTAMP ORDER BY datetime(effective_at) DESC LIMIT 1").bind(clientId).first<{ id: string; status: string; effective_at: string; minimum_weight_kg: number; volumetric_divisor: number; gst_percent: number }>();
  if (existing) return existing;

  const versionId = crypto.randomUUID();
  const effectiveAt = new Date().toISOString();
  const statements = [
    env.DB.prepare("INSERT OR IGNORE INTO pricing_versions (id, client_id, provider, service_level, status, effective_at, source_rate_card_id, minimum_weight_kg, volumetric_divisor, gst_percent, created_by_user_id, published_by_user_id) VALUES (?, ?, 'delhivery', 'b2b', 'active', ?, NULL, 20, 5000, 18, ?, ?)").bind(versionId, clientId, effectiveAt, actor, actor),
  ];
  for (const account of ["04", "08", "other"] as PricingAccount[]) {
    for (const row of defaultRateRows(account)) {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO pricing_rate_matrix (id, version_id, account_scope, origin_zone, destination_zone, rate_per_kg) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), versionId, account, row.origin_zone, row.destination_zone, row.rate_per_kg));
    }
  }
  const defaultRules: Array<{ code: string; label: string; kind: ChargeRule["kind"]; value: number; basis: ChargeRule["basis"]; minimum?: number; marker?: "*"; condition?: "oda_or_opa"; displayOrder: number }> = [
    { code: "docket", label: "Docket / LR charge", kind: "fixed", value: 50, basis: "freight", displayOrder: 10 },
    { code: "fuel", label: "Fuel surcharge", kind: "percent", value: 10, basis: "freight", displayOrder: 20 },
    { code: "oda", label: "ODA surcharge", kind: "per_kg", value: 3, basis: "chargeable_weight", minimum: 750, condition: "oda_or_opa", marker: "*", displayOrder: 40 },
    { code: "minimum_freight", label: "Minimum waybill freight", kind: "minimum", value: 500, basis: "subtotal", displayOrder: 60 },
  ];
  for (const rule of defaultRules) {
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO pricing_charge_rules (id, version_id, code, label, calculation_type, value, basis, minimum_value, enabled, marker, condition, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)").bind(crypto.randomUUID(), versionId, rule.code, rule.label, rule.kind, rule.value, rule.basis ?? "freight", rule.minimum ?? null, rule.marker ?? null, rule.condition ?? null, rule.displayOrder));
  }
  await env.DB.batch(statements);
  return env.DB.prepare("SELECT id, status, effective_at, minimum_weight_kg, volumetric_divisor, gst_percent FROM pricing_versions WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active' AND datetime(effective_at) <= CURRENT_TIMESTAMP ORDER BY datetime(effective_at) DESC LIMIT 1").bind(clientId).first<{ id: string; status: string; effective_at: string; minimum_weight_kg: number; volumetric_divisor: number; gst_percent: number }>();
}
async function ensureDefaultClientProviderPolicies(env: Env, clientId: string, actor = "system") {
  const accounts = await env.DB.prepare("SELECT id, credential_secret_name FROM provider_accounts WHERE provider = 'delhivery' AND status = 'active' AND account_name IN ('PSSLOGISTICS10 B2BC', 'PSSCHANDIGARHCARGO6 B2BC', 'PSSBOOKCFT10 B2BC')").all<{ id: string; credential_secret_name: string }>();
  const secretBag = env as unknown as Record<string, unknown>;
  const configured = accounts.results.filter((account) => typeof secretBag[account.credential_secret_name] === "string" && String(secretBag[account.credential_secret_name]).trim());
  if (!configured.length) return;
  await env.DB.batch(configured.map((account) => env.DB.prepare("INSERT OR IGNORE INTO provider_account_client_policies (provider_account_id, client_id, enabled, priority, confidence_score, rate_card_id, notes, updated_by_user_id, updated_at) VALUES (?, ?, 1, 100, 0, NULL, 'Default Delhivery B2B account assignment', ?, CURRENT_TIMESTAMP)").bind(account.id, clientId, actor)));
}
const FUJIYAMA_CLIENT_ID = "bb308dde-aae8-4503-ac7b-f91cd80ada78";
const FUJIYAMA_DELHIVERY_ACCOUNT_ID = "dlv-psslogistics10-b2bc";
const FUJIYAMA_FORWARD_RATES: Record<string, number> = { N1: 5.5, N2: 6.2, N3: 6.5, N4: 6.9, C1: 7.9, C2: 8.6, E1: 10.5, E2: 11.2, NE1: 15.9, NE2: 18.8, S1: 8.8, S2: 9.4, S3: 9.8, S4: 10.5, W1: 7.9, W2: 8.7 };
const FUJIYAMA_REVERSE_RATES: Record<string, number> = { North: 7.5, West: 11, South: 14.5, East: 14.5, Northeast: 18.5 };
const fujiyamaKey = (value: string | undefined) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
const FUJIYAMA_CITY_ZONES: Record<string, string> = { bhopal: "C1", indore: "C1", raipur: "C1", kolkata: "E1", patna: "E1", ranchi: "E1", bhubaneswar: "E1", siliguri: "E1", delhi: "N1", faridabad: "N1", gurgaon: "N1", gurugram: "N1", ghaziabad: "N1", noida: "N1", chandigarh: "N1", jaipur: "N1", dehradun: "N2", ludhiana: "N2", guwahati: "NE1", hyderabad: "S1", chennai: "S1", bengaluru: "S1", bangalore: "S1", mumbai: "W1", pune: "W1", thane: "W1", ahmedabad: "W1", surat: "W1" };
const FUJIYAMA_STATE_ZONES: Record<string, string> = { chhattisgarh: "C2", madhyapradesh: "C2", bihar: "E2", odisha: "E2", jharkhand: "E2", westbengal: "E2", haryana: "N3", punjab: "N3", rajasthan: "N3", uttarpradesh: "N3", himachalpradesh: "N4", jammuandkashmir: "N4", uttarakhand: "N4", assam: "NE2", arunachalpradesh: "NE2", manipur: "NE2", meghalaya: "NE2", mizoram: "NE2", nagaland: "NE2", sikkim: "NE2", tripura: "NE2", andhrapradesh: "S2", karnataka: "S2", telangana: "S2", tamilnadu: "S3", puducherry: "S3", kerala: "S4", maharashtra: "W2", gujarat: "W2", goa: "W2" };
const FUJIYAMA_REVERSE_ZONE_BY_STATE: Record<string, string> = { punjab: "North", delhi: "North", haryana: "North", himachalpradesh: "North", jammuandkashmir: "North", rajasthan: "North", uttarpradesh: "North", uttarakhand: "North", chhattisgarh: "West", goa: "West", gujarat: "West", madhyapradesh: "West", maharashtra: "West", andhrapradesh: "South", karnataka: "South", puducherry: "South", tamilnadu: "South", telangana: "South", kerala: "South", bihar: "East", jharkhand: "East", odisha: "East", westbengal: "East", arunachalpradesh: "Northeast", assam: "Northeast", manipur: "Northeast", meghalaya: "Northeast", sikkim: "Northeast", nagaland: "Northeast" };
function fujiyamaForwardZone(city: string, state: string) { return FUJIYAMA_CITY_ZONES[fujiyamaKey(city)] ?? FUJIYAMA_STATE_ZONES[fujiyamaKey(state)] ?? null; }
function fujiyamaReverseZone(city: string, state: string) { return FUJIYAMA_REVERSE_ZONE_BY_STATE[fujiyamaKey(state)] ?? (fujiyamaKey(city) === "guwahati" ? "Northeast" : null); }
async function createShipmentPricingQuote(env: Env, clientId: string, payload: Record<string, unknown>, createdByUserId: string, versionIdOverride?: string): Promise<PricingQuoteRecord> {
  const origin = shipmentAddress(payload.origin_address); const destination = shipmentAddress(payload.destination_address);
  if (!origin || !destination) throw new Error("PRICING_ADDRESS_REQUIRED");
  const fujiyamaLane = clientId === FUJIYAMA_CLIENT_ID ? String(payload.lane ?? "").trim().toLowerCase() : "";
  if (clientId === FUJIYAMA_CLIENT_ID && fujiyamaLane !== "forward" && fujiyamaLane !== "reverse") throw new Error("FUJIYAMA_LANE_REQUIRED");
  let accountValue = String(payload.account_code ?? "").trim().toLowerCase();
  if (!accountValue && typeof payload.provider_account_id === "string") {
    const providerAccount = await env.DB.prepare("SELECT account_name FROM provider_accounts WHERE id = ? AND provider = 'delhivery' LIMIT 1").bind(payload.provider_account_id).first<{ account_name: string }>();
    const accountName = String(providerAccount?.account_name ?? ""); accountValue = delhiveryPricingAccountFromName(accountName);
  }
  if (!accountValue) accountValue = "other";
  // Only the supplied 04 and 08 cards have dedicated matrices. Every other
  // Delhivery B2B account code intentionally uses the Namo B2B matrix.
  if (accountValue !== "04" && accountValue !== "08" && accountValue !== "other") accountValue = "other";
  const rto = payload.rto === true;
  const rtoSourceId = typeof payload.rto_of_shipment_id === "string" ? payload.rto_of_shipment_id.trim() : typeof payload.original_shipment_id === "string" ? payload.original_shipment_id.trim() : "";
  const rtoSource = rto ? await env.DB.prepare("SELECT account_scope, origin_zone, destination_zone, chargeable_weight_kg, client_breakdown_json FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(rtoSourceId, clientId).first<{ account_scope: PricingAccount; origin_zone: string; destination_zone: string; chargeable_weight_kg: number; client_breakdown_json: string }>() : null;
  if (rto && !rtoSourceId) throw new Error("RTO_SOURCE_REQUIRED");
  if (rto && !rtoSource) throw new Error("RTO_SOURCE_NOT_FOUND");
  const account = (rtoSource?.account_scope ?? accountValue) as PricingAccount;
  const actualWeightKg = Number(payload.total_weight_kg); const volumetricWeightKg = volumetricWeightFromPayload(payload); const invoiceValue = Number(payload.declared_value ?? 0);
  if (!Number.isFinite(actualWeightKg) || actualWeightKg <= 0 || !Number.isFinite(volumetricWeightKg) || volumetricWeightKg < 0 || !Number.isFinite(invoiceValue) || invoiceValue < 0) throw new Error("PRICING_WEIGHT_INVALID");
  const version = versionIdOverride
    ? await env.DB.prepare("SELECT id, minimum_weight_kg, gst_percent FROM pricing_versions WHERE id = ? AND client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' LIMIT 1").bind(versionIdOverride, clientId).first<{ id: string; minimum_weight_kg: number; gst_percent: number }>()
    : await env.DB.prepare("SELECT id, minimum_weight_kg, gst_percent FROM pricing_versions WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active' AND datetime(effective_at) <= CURRENT_TIMESTAMP ORDER BY datetime(effective_at) DESC LIMIT 1").bind(clientId).first<{ id: string; minimum_weight_kg: number; gst_percent: number }>();
  const activeVersion = version ?? await ensureDefaultClientPricing(env, clientId, createdByUserId);
  if (!activeVersion) throw new Error("PRICING_NOT_CONFIGURED");
  const rules = await env.DB.prepare("SELECT code, label, calculation_type, value, basis, minimum_value, maximum_value, enabled, marker, condition, display_order FROM pricing_charge_rules WHERE version_id = ? ORDER BY display_order ASC, code ASC").bind(activeVersion.id).all<{ code: string; label: string; calculation_type: ChargeRule["kind"]; value: number; basis: ChargeRule["basis"]; minimum_value: number | null; maximum_value: number | null; enabled: number; marker: "*" | null; condition: "oda_or_opa" | null; display_order: number }>();
  const matrixRows = await env.DB.prepare("SELECT origin_zone, destination_zone, rate_per_kg FROM pricing_rate_matrix WHERE version_id = ? AND account_scope = ?").bind(activeVersion.id, account).all<{ origin_zone: string; destination_zone: string; rate_per_kg: number }>();
  const [originPin, destinationPin] = await Promise.all([pricingPincode(env, origin.pincode), pricingPincode(env, destination.pincode)]);
  const originCity = originPin?.facility_city ?? origin.city; const destinationCity = destinationPin?.facility_city ?? destination.city;
  const originState = originPin?.facility_state ?? origin.state; const destinationState = destinationPin?.facility_state ?? destination.state;
  const fujiyamaOriginZone = fujiyamaLane === "forward" ? "N1" : fujiyamaLane === "reverse" ? fujiyamaReverseZone(originCity, originState) : null;
  const fujiyamaDestinationZone = fujiyamaLane === "forward" ? fujiyamaForwardZone(destinationCity, destinationState) : fujiyamaLane === "reverse" ? "North" : null;
  if (fujiyamaLane && (!fujiyamaOriginZone || !fujiyamaDestinationZone)) throw new Error("FUJIYAMA_ZONE_NOT_CONFIGURED");
  let forwardRatePerKg: number | undefined;
  if (rtoSource) {
    try {
      const originalBreakdown = JSON.parse(rtoSource.client_breakdown_json) as { lines?: Array<{ code?: string; amount?: number }> };
      const originalFreight = originalBreakdown.lines?.find((line) => line.code === "freight")?.amount;
      if (Number.isFinite(Number(originalFreight)) && Number(rtoSource.chargeable_weight_kg) > 0) forwardRatePerKg = Number(originalFreight) / Number(rtoSource.chargeable_weight_kg);
    } catch { throw new Error("RTO_SOURCE_INVALID"); }
    if (forwardRatePerKg === undefined) throw new Error("RTO_SOURCE_INVALID");
  }
  const oda = Boolean(originPin?.oda || destinationPin?.oda);
  const fujiyamaRules: ChargeRule[] = fujiyamaLane === "forward"
    ? [
        { code: "docket", label: "Docket / LR charge", kind: "fixed", value: 50, basis: "freight", displayOrder: 10 },
        { code: "fuel", label: "Fuel surcharge", kind: "percent", value: 15, basis: "freight", displayOrder: 20 },
        { code: "fm", label: "FM charge", kind: "per_kg", value: 1, basis: "chargeable_weight", displayOrder: 30 },
        { code: "oda", label: "ODA surcharge", kind: "per_kg", value: 2, basis: "chargeable_weight", minimum: 450, condition: "oda_or_opa", marker: "*", displayOrder: 40 },
        { code: "minimum_freight", label: "Minimum waybill freight", kind: "minimum", value: 500, basis: "subtotal", displayOrder: 60 },
      ]
    : fujiyamaLane === "reverse"
      ? [
          { code: "docket", label: "Docket / LR charge", kind: "fixed", value: 50, basis: "freight", displayOrder: 10 },
          { code: "fuel", label: "Fuel surcharge", kind: "percent", value: 10, basis: "freight", displayOrder: 20 },
          { code: "oda", label: "ODA surcharge", kind: "per_kg", value: 3, basis: "chargeable_weight", minimum: 550, condition: "oda_or_opa", marker: "*", displayOrder: 40 },
          { code: "minimum_freight", label: "Minimum waybill freight", kind: "minimum", value: 450, basis: "subtotal", displayOrder: 60 },
        ]
      : rules.results.map((rule) => ({ code: rule.code, label: rule.label, kind: rule.calculation_type, value: Number(rule.value), basis: rule.basis, minimum: rule.minimum_value === null ? undefined : Number(rule.minimum_value), maximum: rule.maximum_value === null ? undefined : Number(rule.maximum_value), enabled: Boolean(rule.enabled), marker: rule.marker ?? undefined, condition: rule.condition ?? undefined, displayOrder: Number(rule.display_order ?? 0) }));
  const laneMatrix = fujiyamaLane === "forward"
    ? Object.fromEntries(Object.entries(FUJIYAMA_FORWARD_RATES).map(([zone, rate]) => [`N1->${zone}`, rate]))
    : fujiyamaLane === "reverse"
      ? Object.fromEntries(Object.entries(FUJIYAMA_REVERSE_RATES).map(([zone, rate]) => [`${zone}->North`, rate]))
      : Object.fromEntries(matrixRows.results.map((row) => [`${row.origin_zone}->${row.destination_zone}`, Number(row.rate_per_kg)]));
  const result = calculatePssRate({ account, originCity, destinationCity, originState, destinationState, actualWeightKg, volumetricWeightKg, invoiceValue, rto: fujiyamaLane ? false : rto, forwardRatePerKg: fujiyamaLane ? undefined : forwardRatePerKg, forwardOriginZoneOverride: rtoSource?.origin_zone, forwardDestinationZoneOverride: rtoSource?.destination_zone, originZoneOverride: fujiyamaOriginZone ?? undefined, destinationZoneOverride: fujiyamaDestinationZone ?? undefined, minimumWeightKg: Number(activeVersion.minimum_weight_kg ?? 20), gstPercent: Number(activeVersion.gst_percent ?? 18), versionId: activeVersion.id, oda, opa: false, rateMatrix: laneMatrix, chargeRules: fujiyamaRules, riskCharges: fujiyamaLane === "forward" ? [{ code: "rov", label: "ROV", percent: 0.3, minimum: 80 }] : fujiyamaLane === "reverse" ? [{ code: "rov", label: "ROV", percent: 0.2, minimum: 65 }, { code: "owner_risk", label: "Owner risk", percent: 0.1, minimum: 100 }] : [] });
  if (!fujiyamaLane) {
    const carrierRisk = payload.risk_type === "carrier";
    const riskFee = carrierRisk ? Math.max(80, Math.round(invoiceValue * 0.003 * 100) / 100) : Math.max(50, Math.round(invoiceValue * 0.001 * 100) / 100);
    result.lines.push({ code: carrierRisk ? "carrier_risk" : "owner_risk", label: carrierRisk ? "Carrier risk fee" : "Owner risk fee", amount: riskFee });
    result.total = Number(result.total) + riskFee;
  }
  const quoteId = crypto.randomUUID(); const breakdown = JSON.stringify(result);
  await env.DB.prepare("INSERT INTO pricing_quotes (id, client_id, version_id, account_scope, origin_zone, destination_zone, chargeable_weight_kg, client_breakdown_json, expires_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+15 minutes'), ?)").bind(quoteId, clientId, activeVersion.id, account, result.originZone, result.destinationZone, result.chargeableWeightKg, breakdown, createdByUserId).run();
  return { id: quoteId, version_id: activeVersion.id, account_scope: account, origin_zone: result.originZone, destination_zone: result.destinationZone, chargeable_weight_kg: result.chargeableWeightKg, client_breakdown_json: breakdown };
}

type DelhiveryB2bCredential = { username?: string; password?: string; token?: string; jwt?: string };

function normalizeDelhiveryJwt(value: unknown) {
  if (typeof value !== "string") return undefined;
  const token = value.trim().replace(/^Bearer\s+/i, "");
  return /^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(token) ? token : undefined;
}

function normalizeDelhiveryToken(value: unknown) {
  if (typeof value !== "string") return undefined;
  const token = value.trim().replace(/^Bearer\s+/i, "");
  return token && !/[\r\n]/.test(token) ? token : undefined;
}

function delhiveryB2bCredential(value: string | undefined): DelhiveryB2bCredential | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed === "string") return normalizeDelhiveryToken(parsed) ? { token: normalizeDelhiveryToken(parsed) } : null;
    if (parsed && typeof parsed === "object") return {
      username: typeof (parsed.username ?? parsed.user_name ?? parsed.email ?? parsed.client_email) === "string" ? String(parsed.username ?? parsed.user_name ?? parsed.email ?? parsed.client_email).trim() : undefined,
      password: typeof (parsed.password ?? parsed.pass ?? parsed.secret) === "string" ? String(parsed.password ?? parsed.pass ?? parsed.secret) : undefined,
      // Delhivery credentials have existed in several operator-managed JSON
      // shapes. Keep the token account-scoped, but accept the documented API
      // token aliases so warehouse registration is actually automated when
      // the production token was stored under a descriptive key.
      token: normalizeDelhiveryToken(
        parsed.token
        ?? parsed.api_token
        ?? parsed.apiKey
        ?? parsed.api_key
        ?? parsed.warehouse_api_token
        ?? parsed.warehouse_token
        ?? parsed.production_api_token
        ?? parsed.client_token
        ?? parsed.auth_token
        ?? parsed.access_token
        ?? parsed.bearer_token,
      ),
      jwt: normalizeDelhiveryJwt(parsed.jwt),
    };
  } catch { /* A raw value may be a previously issued bearer token. */ }
  const token = normalizeDelhiveryToken(raw);
  return token ? { token, jwt: normalizeDelhiveryJwt(token) } : null;
}

function delhiveryWarehouseApiToken(env: Env, accountName: string, primaryCredential: DelhiveryB2bCredential | null) {
  const primaryToken = primaryCredential?.token;
  if (primaryToken && !delhiveryLooksLikeJwt(primaryToken)) return primaryToken;

  // This is an account-specific compatibility alias retained from the prior
  // production credential setup. It is intentionally not a provider-global
  // fallback: only this exact account may use it.
  const normalizedAccount = accountName.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalizedAccount !== "PSSLOGISTICS10 B2BC") return null;
  const secretBag = env as unknown as Record<string, unknown>;
  // Keep the account boundary explicit while accepting both the legacy alias
  // and the current account-token secret name used in production.
  const accountSecret = typeof secretBag.DELHIVERY_TOKEN_PSSLOGISTICS10_B2BC === "string"
    ? String(secretBag.DELHIVERY_TOKEN_PSSLOGISTICS10_B2BC)
    : typeof secretBag.DELHIVERY_PSSLOGISTICS10B2BC === "string"
      ? String(secretBag.DELHIVERY_PSSLOGISTICS10B2BC)
      : undefined;
  const aliasToken = delhiveryB2bCredential(accountSecret)?.token;
  if (aliasToken && !delhiveryLooksLikeJwt(aliasToken)) return aliasToken;

  // The original production setup stored this account's warehouse token in
  // DELHIVERY_API_TOKEN before account-scoped credentials were introduced.
  // Keep this compatibility path explicitly restricted to PSSLOGISTICS10;
  // never use a provider-global token for another Delhivery account.
  const legacyToken = delhiveryB2bCredential(env.DELHIVERY_API_TOKEN)?.token;
  return legacyToken && !delhiveryLooksLikeJwt(legacyToken) ? legacyToken : null;
}

function delhiveryAccountIsB2b(accountName: string) {
  return /(^|[^a-z])b2b(c)?([^a-z]|$)/i.test(accountName) || /^PSS\s+B2B$/i.test(accountName.trim());
}

function delhiveryWarehouseLog(requestIdValue: string, phase: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event: "delhivery_warehouse_sync", request_id: requestIdValue, phase, ...fields }));
}

async function delhiveryWarehouseProviderContext(env: Env, clientId: string, requestedAccountId: string | null, requestIdValue: string, timeoutMs: number) {
  const defaultAccountName = String((env as unknown as Record<string, unknown>).DELHIVERY_DEFAULT_ACCOUNT_NAME ?? "").trim();
  const account = requestedAccountId
    ? await env.DB.prepare(`SELECT pa.id, pa.account_name, pa.credential_secret_name FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.id = ? AND pa.provider = 'delhivery' AND pa.status = 'active' AND (pa.client_id = ? OR (pa.client_id IS NULL AND p.client_id = ? AND p.enabled = 1)) LIMIT 1`).bind(clientId, requestedAccountId, clientId, clientId).first<{ id: string; account_name: string; credential_secret_name: string }>()
    : await env.DB.prepare(`SELECT pa.id, pa.account_name, pa.credential_secret_name FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.provider = 'delhivery' AND pa.status = 'active' AND pa.account_name = ? AND (pa.client_id = ? OR (pa.client_id IS NULL AND p.client_id = ? AND p.enabled = 1)) LIMIT 1`).bind(clientId, defaultAccountName, clientId, clientId).first<{ id: string; account_name: string; credential_secret_name: string }>();
  if (!account) return { ok: false as const, error: requestedAccountId ? "The selected Delhivery account is not enabled for this client" : "A default Delhivery account must be configured before creating a warehouse" };
  if (!delhiveryAccountIsB2b(account.account_name)) return { ok: false as const, error: "The selected Delhivery account is not configured for B2B warehouse registration" };
  const secretBag = env as unknown as Record<string, unknown>;
  const credential = typeof secretBag[account.credential_secret_name] === "string" ? String(secretBag[account.credential_secret_name]) : undefined;
  if (!credential) return { ok: false as const, error: "The selected Delhivery account credential is not configured" };
  const token = await delhiveryB2bBearer(env, credential, account.account_name, requestIdValue, timeoutMs);
  if (!token) return { ok: false as const, error: "Delhivery B2B authentication failed" };
  const warehouseApiToken = delhiveryWarehouseApiToken(env, account.account_name, delhiveryB2bCredential(credential));
  if (!warehouseApiToken) return { ok: false as const, error: "Delhivery warehouse registration requires the production API token for this account" };
  return { ok: true as const, accountId: account.id, accountName: account.account_name, token, warehouseApiToken, base: env.DELHIVERY_B2B_API_BASE_URL ?? "https://ltl-clients-api.delhivery.com" };
}

function delhiveryJwtExpiry(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(normalized)) as { exp?: unknown };
    const exp = Number(parsed.exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch { return null; }
}

function delhiveryLooksLikeJwt(token: string | undefined) {
  return Boolean(token && token.split(".").length === 3 && token.split(".").every((part) => part.trim()));
}

function delhiveryJwtClaim(token: string | undefined, claim: string) {
  if (!token) return "";
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(normalized)) as Record<string, unknown>;
    return typeof parsed[claim] === "string" ? parsed[claim].trim() : "";
  } catch { return ""; }
}

function delhiveryTokenCacheKey(accountName: string, authBase?: string) {
  const host = authBase ? new URL(authBase).hostname.replace(/[^A-Z0-9]+/gi, "_").toUpperCase() : "DEFAULT";
  return `delhivery:b2b:${host}:${accountName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

const delhiveryTokenRefreshes = new Map<string, Promise<string | null>>();

async function delhiveryB2bBearer(env: Env, credentialValue: string | undefined, accountName: string, requestIdValue: string, timeoutMs: number, forceRefresh = false, preferredAuthBase?: string) {
  const credential = delhiveryB2bCredential(credentialValue);
  if (!credential) return null;
  const configuredToken = credential.jwt ?? credential.token;
  if (configuredToken && (!credential.username || !credential.password)) {
    if (!delhiveryLooksLikeJwt(configuredToken)) return null;
    const now = Math.floor(Date.now() / 1000);
    return (delhiveryJwtExpiry(configuredToken) ?? now + 86400) > now + 30 ? configuredToken : null;
  }
  if (!credential.username || !credential.password) return configuredToken ?? null;
  const cacheKey = delhiveryTokenCacheKey(accountName, preferredAuthBase);
  const now = Math.floor(Date.now() / 1000);
  const usable = (token: string | null | undefined, expiresAt?: number | null) => Boolean(delhiveryLooksLikeJwt(token ?? undefined) && (expiresAt ?? delhiveryJwtExpiry(token ?? "") ?? 0) > now + 300);
  if (!forceRefresh && env.DELHIVERY_TOKEN_CACHE) {
    const cached = await env.DELHIVERY_TOKEN_CACHE.get<{ token?: string; expiresAt?: number }>(cacheKey, "json");
    if (usable(cached?.token, cached?.expiresAt)) return cached!.token!;
  }
  const existing = delhiveryTokenRefreshes.get(cacheKey);
  if (existing) return existing;
  const refresh = (async () => {
    try {
      if (env.DELHIVERY_TOKEN_CACHE) await env.DELHIVERY_TOKEN_CACHE.delete(cacheKey);
      const configuredBase = String(env.DELHIVERY_B2B_API_BASE_URL ?? "https://ltl-clients-api.delhivery.com").replace(/\/$/, "");
      const loginBases = preferredAuthBase
        ? [preferredAuthBase.replace(/\/$/, "")]
        : [...new Set([configuredBase, "https://btob.api.delhivery.com"])];
      for (const base of loginBases) {
        try {
          const response = await providerFetch(`${base}/ums/login`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-request-id": requestIdValue },
            body: JSON.stringify({ username: credential.username, password: credential.password }),
          }, timeoutMs);
          const responseText = await providerResponseText(response, timeoutMs);
          if (!response.ok) continue;
          const body = JSON.parse(responseText) as Record<string, unknown>;
          const token = findProviderToken(body, new Set(["jwt", "token", "access_token", "bearer_token"]));
          if (!delhiveryLooksLikeJwt(token ?? undefined)) continue;
          const expiresAt = delhiveryJwtExpiry(token ?? "") ?? now + 86400;
          if (env.DELHIVERY_TOKEN_CACHE) {
            await env.DELHIVERY_TOKEN_CACHE.put(cacheKey, JSON.stringify({ token, expiresAt }), { expirationTtl: Math.max(60, expiresAt - now) });
          }
          return token;
        } catch { /* Try the alternate Delhivery B2B auth host. */ }
      }
      return null;
    } catch { return null; }
    finally { delhiveryTokenRefreshes.delete(cacheKey); }
  })();
  delhiveryTokenRefreshes.set(cacheKey, refresh);
  return refresh;
}

function delhiveryWarehouseName(origin: { name: string; city?: string; state?: string; pincode: string }) {
  // Delhivery identifies B2B pickup locations by the provider warehouse name,
  // not by an address-only lookup. Keep the Client-selected name as the base,
  // then append the complete location identity used by Delhivery's registry.
  // This also normalizes Client labels that already contain ` · city · state · pin`.
  return canonicalDelhiveryWarehouseName(origin.name, origin.city, origin.state, origin.pincode);
}

async function delhiveryWarehouseHasConfirmedBooking(
  env: Env,
  clientId: string,
  providerAccountId: string | null | undefined,
  origin: { name: string; line: string; city: string; state: string; pincode: string; phone: string },
) {
  const rows = await env.DB.prepare("SELECT origin_address_json, provider_account_id, provider_reference FROM shipments WHERE client_id = ? AND provider = 'delhivery' AND provider_sync_status = 'confirmed' AND provider_reference IS NOT NULL AND TRIM(provider_reference) <> ''")
    .bind(clientId)
    .all<{ origin_address_json: string | null; provider_account_id: string | null; provider_reference: string | null }>();
  return (rows.results ?? []).some((row) => {
    if (providerAccountId && row.provider_account_id !== providerAccountId) return false;
    if (!row.origin_address_json || !row.provider_reference?.trim()) return false;
    try {
      const bookedOrigin = delhiveryAddress(JSON.parse(row.origin_address_json), origin.name);
      return Boolean(bookedOrigin
        && bookedOrigin.line === origin.line
        && bookedOrigin.city === origin.city
        && bookedOrigin.state === origin.state
        && bookedOrigin.pincode === origin.pincode
        && bookedOrigin.phone === origin.phone);
    } catch {
      return false;
    }
  });
}

async function ensureDelhiveryWarehouse(env: Env, clientId: string, token: string, origin: { name: string; line: string; city: string; state: string; pincode: string; phone: string }, requestIdValue: string, timeoutMs: number, b2bBaseUrl = env.DELHIVERY_B2B_API_BASE_URL ?? "https://ltl-clients-api.delhivery.com", providerAccountId?: string | null, selectedWarehouseId?: string | null, warehouseApiToken?: string | null) {
  const warehouseRow = "id, name, address, city, state, pincode, contact, contact_name, provider, provider_status, provider_account_id, provider_reference, provider_name";
  const existing = selectedWarehouseId
    ? await env.DB.prepare(`SELECT ${warehouseRow} FROM warehouses WHERE client_id = ? AND id = ? LIMIT 1`)
      .bind(clientId, selectedWarehouseId)
      .first<{ id: string; name: string; address: string | null; city: string | null; state: string | null; pincode: string | null; contact: string | null; contact_name: string | null; provider: string | null; provider_status: string | null; provider_account_id: string | null; provider_reference: string | null; provider_name: string | null }>()
    : await env.DB.prepare(`SELECT ${warehouseRow} FROM warehouses WHERE client_id = ? AND provider = 'delhivery' AND lower(trim(COALESCE(provider_account_id, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(address, ''))) = lower(trim(?)) AND lower(trim(COALESCE(city, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(state, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(pincode, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(contact, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(contact_name, ''))) = lower(trim(COALESCE(?, ''))) ORDER BY updated_at DESC LIMIT 1`)
      .bind(clientId, providerAccountId ?? null, origin.line, origin.city, origin.state, origin.pincode, origin.phone, origin.name)
      .first<{ id: string; name: string; address: string | null; city: string | null; state: string | null; pincode: string | null; contact: string | null; contact_name: string | null; provider: string | null; provider_status: string | null; provider_account_id: string | null; provider_reference: string | null; provider_name: string | null }>();
  if (selectedWarehouseId && !existing) {
    return { ok: false as const, code: "WAREHOUSE_NOT_FOUND" as const, error: "The selected pickup warehouse no longer exists for this client. Select it again before booking." };
  }
  if (existing?.provider && existing.provider !== "delhivery") {
    return { ok: false as const, code: "WAREHOUSE_PROVIDER_MISMATCH" as const, error: "The selected pickup warehouse is mapped to a different courier provider." };
  }
  if (existing?.provider_account_id && providerAccountId && existing.provider_account_id !== providerAccountId) {
    return { ok: false as const, code: "WAREHOUSE_ACCOUNT_MISMATCH" as const, error: "The selected pickup warehouse is mapped to a different Delhivery account. Select a warehouse assigned to this account." };
  }
  // A selected saved warehouse is the canonical pickup identity. Never let
  // editable booking fields overwrite it or combine it with another address.
  // The unsaved-address path has no `existing` row and remains unchanged.
  const resolvedOrigin = existing ? {
    name: existing.contact_name?.trim() || origin.name,
    line: existing.address?.trim() || origin.line,
    city: existing.city?.trim() || origin.city,
    state: existing.state?.trim() || origin.state,
    pincode: existing.pincode?.trim() || origin.pincode,
    phone: existing.contact?.trim() || origin.phone,
  } : origin;
  const generatedLocalName = delhiveryWarehouseName(resolvedOrigin);
  // Older retries could persist one or more ` - PSS-xxxxxxxx` suffixes on
  // the same saved warehouse. Treat those names as migration artefacts and
  // always converge back to the deterministic provider identity. Otherwise a
  // retry can keep manifesting against a facility that Delhivery never
  // configured, even though the canonical facility is available.
  // Older rows may contain punctuation variants or retry suffixes that were
  // never registered with the manifestation service. Rebuild the provider
  // identity from the canonical saved address on every attempt so stale local
  // names cannot keep a shipment pointed at an unconfigured facility.
  const baseLocalName = generatedLocalName;
  const existingHasConfirmedBooking = existing
    ? await delhiveryWarehouseHasConfirmedBooking(env, clientId, providerAccountId, resolvedOrigin)
    : false;
  // A saved/previously registered provider location is reusable even when the
  // first shipment has not published an LR yet. Waiting for a confirmed LR
  // here caused every retry to create another PSS-suffixed warehouse, which
  // made repeat bookings intermittent and could make Delhivery reject them.
  // A local active flag alone is not proof that Delhivery's manifestation
  // service can use the warehouse. Older rows can be marked active without a
  // provider facility reference, which produces the provider error
  // "warehouse ... has not been configured". Re-register those rows; the
  // provider's idempotent/already-configured response is the authority.
  const existingProviderLocation = existing && (existing.provider_status === "active" || existing.provider_status === "pending")
    && Boolean((existing.provider_name?.trim() || existing.name?.trim()) && (existing.provider_reference?.trim() || existingHasConfirmedBooking));
  const warehouseIdentityHash = await sha256(`${baseLocalName}|${resolvedOrigin.pincode}`);
  // Keep one stable provider facility name for an address. Generating a new
  // PSS-suffixed name on every activation retry creates duplicate Delhivery
  // facilities and can leave the manifest service rejecting the newest name
  // as not configured. Re-registration must be idempotent on the canonical
  // name; the provider's duplicate/already-configured response is the source
  // of truth, followed by the manifest attempt.
  const localName = baseLocalName;
  const providerName = localName;
  delhiveryWarehouseLog(requestIdValue, "start", { account_id: providerAccountId ?? null, identity_hash: warehouseIdentityHash });
  // Reuse is deliberately evidence-based. A local row alone is not proof that
  // Delhivery accepted and displayed a booking for that pickup location.
  if (existing && existingHasConfirmedBooking) {
    return { ok: true as const, name: existing.provider_name?.trim() || providerName, reused: true as const, origin: resolvedOrigin };
  }
  // Do not trust a locally active provider flag for an unconfirmed booking.
  // Existing rows may have a provider name while Delhivery's manifestation
  // service still rejects the facility as unconfigured. Re-run the provider's
  // idempotent registration and let that response establish readiness.
  // Do not search Delhivery before registration. The create API is the source
  // of truth for this path; facility-list propagation is asynchronous and its
  // lookup adds latency without proving that a booking can be manifested.
  const warehouseCreateIdempotencyKey = `pss-warehouse-${await sha256(`${clientId}|${providerAccountId ?? ""}|${providerName}|${resolvedOrigin.pincode}`)}`;
  // Delhivery's warehouse registry is the authority used by manifestation.
  // The documented production warehouse API accepts a flat payload; the
  // newer LTL facility lookup endpoint is not a substitute for registration
  // and can leave a location looking registered locally but unconfigured to
  // the manifest service.
  const email = delhiveryJwtClaim(token, "client_email") || delhiveryJwtClaim(token, "email") || "support@psslogistics.in";
  const warehousePayload = {
    phone: resolvedOrigin.phone,
    city: resolvedOrigin.city,
    name: providerName,
    pin: resolvedOrigin.pincode,
    address: resolvedOrigin.line,
    country: "India",
    email,
    registered_name: resolvedOrigin.name || providerName,
    return_address: resolvedOrigin.line,
    return_pin: resolvedOrigin.pincode,
    return_city: resolvedOrigin.city,
    return_state: resolvedOrigin.state,
    return_country: "India",
  };
  const registrationToken = warehouseApiToken && !delhiveryLooksLikeJwt(warehouseApiToken) ? warehouseApiToken : null;
  const b2bWarehousePayload = {
    name: providerName,
    pin_code: resolvedOrigin.pincode,
    city: resolvedOrigin.city,
    state: resolvedOrigin.state,
    country: "India",
    address_details: {
      address: resolvedOrigin.line,
      contact_person: resolvedOrigin.name || providerName,
      phone_number: resolvedOrigin.phone,
    },
    same_as_fwd_add: true,
    ret_address: { pin: resolvedOrigin.pincode, address: resolvedOrigin.line },
  };
  // The manifest service is backed by Delhivery's legacy client-warehouse
  // registry. Prefer the account-scoped production API token for that
  // registry; the B2B JWT endpoint can show an Active facility in the console
  // while the manifest service still reports it as unconfigured. Keep the B2B
  // endpoint as a fallback for accounts that do not expose the legacy token.
  const registrationAttempts = [
    ...(registrationToken ? [{
      contract: "legacy",
      endpoint: "https://track.delhivery.com/api/backend/clientwarehouse/create/",
      authorization: `Token ${registrationToken}`,
      payload: warehousePayload,
    }] : []),
    {
      contract: "b2b",
      endpoint: `${String(b2bBaseUrl).replace(/\/$/, "")}/client-warehouse/create/`,
      authorization: `Bearer ${token}`,
      payload: b2bWarehousePayload,
    },
  ];
  let response: Response | null = null;
  let responseText = "";
  let registrationContract = "";
  let lastRegistrationError = "";
  for (const attempt of registrationAttempts) {
    try {
      const candidate = await providerFetch(attempt.endpoint, {
        method: "POST",
        headers: {
          authorization: attempt.authorization,
          "content-type": "application/json",
          accept: "application/json",
          "x-request-id": requestIdValue,
          "Idempotency-Key": warehouseCreateIdempotencyKey,
          "X-Idempotency-Key": warehouseCreateIdempotencyKey,
        },
        body: JSON.stringify(attempt.payload),
      }, timeoutMs);
      const candidateText = await providerResponseText(candidate, timeoutMs);
      const alreadyRegistered = !candidate.ok && (() => {
        const lower = candidateText.toLowerCase();
        return lower.includes("already exists") || lower.includes("already configured") || lower.includes("duplicate") || lower.includes("warehouse exists");
      })();
      delhiveryWarehouseLog(requestIdValue, "registration_attempt", {
        account_id: providerAccountId ?? null,
        identity_hash: warehouseIdentityHash,
        contract: attempt.contract,
        http_status: candidate.status,
        accepted_http: candidate.ok,
        already_registered: alreadyRegistered,
      });
      response = candidate;
      responseText = candidateText;
      registrationContract = attempt.contract;
      if (candidate.ok || alreadyRegistered) break;
      lastRegistrationError = `Delhivery warehouse creation failed (${candidate.status}): ${candidateText.slice(0, 240)}`;
    } catch (caught) {
      lastRegistrationError = caught instanceof Error ? caught.message : "Delhivery warehouse creation failed";
      delhiveryWarehouseLog(requestIdValue, "registration_exception", { account_id: providerAccountId ?? null, identity_hash: warehouseIdentityHash, contract: attempt.contract, error: lastRegistrationError.slice(0, 240) });
    }
  }
  if (!response) return { ok: false as const, error: lastRegistrationError || "Delhivery warehouse creation failed" };
  let createdProviderReference: string | null = null;
  let createdProviderName: string | null = null;
  let registrationAccepted = false;
  const providerAlreadyRegistered = !response.ok && (() => {
    const lower = responseText.toLowerCase();
    return lower.includes("already exists") || lower.includes("already configured") || lower.includes("duplicate") || lower.includes("warehouse exists");
  })();
  delhiveryWarehouseLog(requestIdValue, "registration_response", { account_id: providerAccountId ?? null, identity_hash: warehouseIdentityHash, contract: registrationContract, http_status: response.status, accepted_http: response.ok, already_registered: providerAlreadyRegistered });
  try {
    const parsedCreateBody = JSON.parse(responseText) as unknown;
    createdProviderReference = findProviderReference(parsedCreateBody, new Set(["facility_id", "warehouse_id", "client_warehouse_uuid", "warehouse_uuid", "facility_uuid"]));
    createdProviderName = findProviderReference(parsedCreateBody, new Set(["facility_name", "client_warehouse_name", "warehouse_name"]));
  } catch {
    // Delhivery can acknowledge registration with an empty or text response.
  }
  if (response.ok) {
    try {
      const providerBody = JSON.parse(responseText) as Record<string, unknown>;
      const explicitFailure = providerBody.ok === false || providerBody.success === false || providerBody.error === true;
      const embeddedError = typeof providerBody.error === "string" ? providerBody.error : typeof providerBody.message === "string" && /error|fail|invalid|inactive/i.test(providerBody.message) ? providerBody.message : "";
      if (explicitFailure || embeddedError) {
        delhiveryWarehouseLog(requestIdValue, "registration_rejected", { account_id: providerAccountId ?? null, identity_hash: warehouseIdentityHash, error: (embeddedError || "provider returned success=false").slice(0, 240) });
        return { ok: false as const, error: `Delhivery warehouse registration was rejected: ${(embeddedError || "provider returned success=false").slice(0, 240)}` };
      }
      registrationAccepted = true;
    } catch {
      // Some Delhivery deployments return an empty/text success response.
      // HTTP success remains sufficient when there is no structured failure.
      registrationAccepted = true;
    }
  }
  if (!response.ok) {
    if (!providerAlreadyRegistered) {
      delhiveryWarehouseLog(requestIdValue, "registration_failed", { account_id: providerAccountId ?? null, identity_hash: warehouseIdentityHash, error: responseText.slice(0, 240) });
      return { ok: false as const, error: lastRegistrationError || `Delhivery warehouse creation failed (${response.status}): ${responseText.slice(0, 240)}` };
    }
    // A duplicate/already-configured response is also registration evidence.
    // The facility-list endpoint can lag or use a different projection than
    // the manifestation API, so let manifestation be the final authority.
    registrationAccepted = true;
  }
  // HTTP success from the warehouse-create endpoint is not sufficient: the
  // manifest service can still reject the facility while Delhivery's
  // activation/indexing job is pending. Confirm the exact facility on the
  // provider-side inventory before allowing a booking to be submitted.
  let facility = await resolveDelhiveryFacility(env, token, b2bBaseUrl, clientId, {
    warehouse_id: existing?.id,
    delhivery_pickup_location: providerName,
    pincode: resolvedOrigin.pincode,
  }, requestIdValue, timeoutMs);
  for (let attempt = 1; !facility.ok && attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    facility = await resolveDelhiveryFacility(env, token, b2bBaseUrl, clientId, {
      warehouse_id: existing?.id,
      delhivery_pickup_location: providerName,
      pincode: resolvedOrigin.pincode,
    }, requestIdValue, timeoutMs);
  }
  if (!facility.ok) {
    if (!delhiveryFacilityNotFound(facility.error)) return { ok: false as const, error: facility.error };
    if (existing) {
      await env.DB.prepare("UPDATE warehouses SET provider = 'delhivery', provider_account_id = ?, provider_reference = COALESCE(?, provider_reference), provider_name = COALESCE(?, provider_name), provider_status = 'pending', provider_error = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
        .bind(providerAccountId ?? null, createdProviderReference, createdProviderName || providerName, "Delhivery warehouse was created but is awaiting provider activation", existing.id, clientId).run();
    }
    return { ok: false as const, code: "WAREHOUSE_ACTIVATION_PENDING" as const, error: "Delhivery accepted the warehouse request, but the pickup facility is not active yet. Retry after Delhivery activates it." };
  }
  if (existing) {
    await env.DB.prepare("UPDATE warehouses SET provider = 'delhivery', provider_account_id = ?, provider_status = 'active', provider_reference = COALESCE(provider_reference, ?), provider_name = ?, provider_error = NULL, provider_activated_at = CURRENT_TIMESTAMP, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(providerAccountId ?? null, facility.facility.id, facility.facility.name || providerName, existing.id, clientId).run();
  } else {
    await env.DB.prepare("INSERT INTO warehouses (id, client_id, name, address, city, state, pincode, contact, contact_name, provider, provider_account_id, provider_status, provider_reference, provider_name, provider_activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delhivery', ?, 'active', ?, ?, CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), clientId, localName, resolvedOrigin.line, resolvedOrigin.city, resolvedOrigin.state, resolvedOrigin.pincode, resolvedOrigin.phone, resolvedOrigin.name, providerAccountId ?? null, facility.facility.id, facility.facility.name || providerName)
      .run();
  }
  return { ok: true as const, name: facility.facility.name || providerName, reused: false as const, origin: resolvedOrigin };
}

type DelhiveryFacility = { id: string; code: string; name: string; pincode: string };

function delhiveryFacilityNotFound(error: string) {
  return /not active or could not be resolved|facility lookup failed \(404\)/i.test(error);
}

function delhiveryFacilityRows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const body = value as Record<string, unknown>;
  const nestedData = body.data;
  const data = nestedData && typeof nestedData === "object" && !Array.isArray(nestedData) ? nestedData as Record<string, unknown> : body;
  const rows = Array.isArray(nestedData)
    ? nestedData
    : data.results ?? data.facilities ?? data.items ?? data.rows ?? data.records ?? data.data ?? body.results;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function delhiveryFacilityField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return "";
}

async function resolveDelhiveryFacility(
  env: Env,
  token: string,
  baseUrl: string,
  clientId: string,
  payload: Record<string, unknown>,
  requestIdValue: string,
  timeoutMs: number,
): Promise<{ ok: true; facility: DelhiveryFacility } | { ok: false; error: string }> {
  const warehouseId = typeof payload.warehouse_id === "string" ? payload.warehouse_id.trim() : "";
  const warehouseSelect = "SELECT id, name, address, city, pincode, provider_reference, provider_status FROM warehouses WHERE client_id = ?";
  const localWarehouse = warehouseId
    ? await env.DB.prepare(`${warehouseSelect} AND id = ? LIMIT 1`).bind(clientId, warehouseId).first<{ id: string; name: string; address: string; city: string; pincode: string; provider_reference: string | null; provider_status: string | null }>()
    : await env.DB.prepare(`${warehouseSelect} AND provider = 'delhivery' AND lower(trim(COALESCE(address, ''))) = lower(trim(?)) AND lower(trim(COALESCE(city, ''))) = lower(trim(?)) AND lower(trim(COALESCE(pincode, ''))) = lower(trim(?)) ORDER BY updated_at DESC LIMIT 1`)
      .bind(clientId, String((payload.origin_address as Record<string, unknown> | null)?.line ?? ""), String((payload.origin_address as Record<string, unknown> | null)?.city ?? ""), String(payload.pincode ?? (payload.origin_address as Record<string, unknown> | null)?.pincode ?? ""))
      .first<{ id: string; name: string; address: string; city: string; pincode: string; provider_reference: string | null; provider_status: string | null }>();
  const name = String(payload.delhivery_pickup_location ?? payload.pickup_location ?? localWarehouse?.name ?? "").trim();
  const pincode = String(payload.pincode ?? localWarehouse?.pincode ?? "").trim();
  if (!name && !localWarehouse?.provider_reference) return { ok: false, error: "A Delhivery pickup facility is required before scheduling this pickup" };

  // The B2B booking JWT is valid only on the configured B2B host. The
  // Delhivery web console uses a separate gateway/authentication contract, so
  // never send the B2B token to that console endpoint as a fallback.
  const lookupBases = [String(baseUrl).replace(/\/$/, "")];
  const findMatch = (rows: Record<string, unknown>[]) => rows.find((row) => delhiveryFacilityMatches(row, name, pincode, localWarehouse?.provider_reference, localWarehouse?.name));
  const lookupNames = [...new Set([localWarehouse?.name?.trim(), name].filter((value): value is string => Boolean(value)))];
  const lookupBodies = lookupNames.flatMap((lookupName) => [
    { page: 1, page_size: 50, search_term: lookupName, search_on: ["facility_name"], filter_facility_name: [lookupName] },
    // Delhivery may reject an exact facility filter when the registered name
    // contains an account suffix such as "B2B". Retry broadly for both the
    // saved Client name and the canonical name sent during registration.
    { page: 1, page_size: 100, search_term: lookupName, search_on: ["facility_name"] },
  ]);
  let match: Record<string, unknown> | undefined;
  let lastLookupError = "";
  for (const lookupBase of lookupBases) {
    const endpoint = `${lookupBase}/web/api/company/configurations/facilities_and_addresses_v3/list`;
    for (const body of lookupBodies) {
      let response: Response;
      try {
        response = await providerFetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json", "x-request-id": requestIdValue },
          body: JSON.stringify(body),
        }, timeoutMs);
      } catch (caught) {
        lastLookupError = caught instanceof Error ? caught.message : "Delhivery facility lookup failed";
        continue;
      }
      const responseText = await providerResponseText(response, timeoutMs);
      if (!response.ok) {
        lastLookupError = `Delhivery facility lookup failed (${response.status}): ${responseText.slice(0, 240)}`;
        continue;
      }
      let parsed: unknown = null;
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      const rows = delhiveryFacilityRows(parsed);
      match = findMatch(rows);
      // A create response can contain a registration/reference ID that is
      // different from the ID returned by Delhivery's active-facility list.
      // Once the selected local warehouse name and PIN identify the active
      // row, refresh that provider mapping instead of preserving a stale ID.
      if (!match && localWarehouse?.name) {
        match = rows.find((row) => delhiveryFacilityMatches(row, name, pincode, localWarehouse.provider_reference, localWarehouse.name, true));
      }
      if (match) break;
    }
    if (match) break;
  }
  if (!match) return { ok: false, error: lastLookupError || `Delhivery pickup facility '${name || pincode}' is not active or could not be resolved` };
  const facility = {
    id: delhiveryFacilityField(match, ["facility_id", "id", "client_warehouse_uuid", "uuid"]),
    code: delhiveryFacilityField(match, ["facility_code", "code", "facility_name", "name"]),
    name: delhiveryFacilityField(match, ["facility_name", "name", "client_warehouse_name", "warehouse_name"]) || name,
    pincode: delhiveryFacilityField(match, ["pincode", "pin_code", "postal_code"]) || pincode,
  };
  if (!facility.id || !facility.code) return { ok: false, error: "Delhivery returned an incomplete pickup facility record" };
  if (localWarehouse) {
    await env.DB.prepare("UPDATE warehouses SET provider = 'delhivery', provider_reference = ?, provider_name = ?, provider_error = NULL, provider_activated_at = CURRENT_TIMESTAMP, provider_status = 'active', status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(facility.id, facility.name, localWarehouse.id, clientId).run();
  }
  return { ok: true, facility };
}

function normalizeDelhiveryPickupSlots(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : body;
  const toSlots = (candidate: unknown) => {
    if (!Array.isArray(candidate)) return [] as string[];
    return candidate.map((slot) => {
      if (typeof slot === "string") return slot.trim();
      if (!slot || typeof slot !== "object") return "";
      const item = slot as Record<string, unknown>;
      const start = String(item.start_time ?? item.start ?? item.from ?? "").trim();
      const end = String(item.end_time ?? item.end ?? item.to ?? "").trim();
      return start && end ? `${start} - ${end}` : start;
    }).filter(Boolean);
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const tomorrowDate = new Date(`${today}T12:00:00+05:30`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(tomorrowDate);
  const rawDates = data.pickup_dates ?? data.available_dates ?? data.dates;
  const dateEntries = Array.isArray(rawDates) ? rawDates.map((item) => {
    if (typeof item === "string") return { date: item, slots: [] as string[] };
    if (!item || typeof item !== "object") return { date: "", slots: [] as string[] };
    const row = item as Record<string, unknown>;
    return { date: String(row.date ?? row.pickup_date ?? ""), slots: toSlots(row.slots ?? row.pickup_slots ?? row.time_slots ?? row.windows ?? row.available_slots) };
  }).filter((item) => validPickupDate(item.date)) : [];
  const todaySlots = toSlots(data.pickup_slots_for_today ?? data.slots_for_today ?? data.today_slots);
  const nextSlots = toSlots(data.pickup_slots_for_next_day ?? data.slots_for_next_day ?? data.next_day_slots);
  const orderedDates = Array.from(new Set(dateEntries.length ? dateEntries.map((item) => item.date) : [today, tomorrow]));
  const hasEmbeddedSlots = dateEntries.some((item) => item.slots.length > 0);
  return orderedDates.map((date, index) => {
    const embedded = dateEntries.find((item) => item.date === date)?.slots ?? [];
    const slots = hasEmbeddedSlots ? embedded : index === 0 ? todaySlots : nextSlots;
    return { date, slots };
  }).filter((item) => item.slots.length > 0);
}

/**
 * Delhivery's public B2B contract accepts a pickup date and start time when a
 * pickup request is created, but does not expose a public first-mile slot
 * availability endpoint. Keep the booking flow usable by offering request
 * windows; Delhivery remains authoritative when the request is submitted.
 */
function delhiveryRequestedPickupSlots() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const current = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${current.year}-${current.month}-${current.day}`;
  const nextDate = new Date(`${today}T12:00:00+05:30`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(nextDate);
  const windows = ["09:00 AM - 11:00 AM", "11:00 AM - 01:00 PM", "02:00 PM - 04:00 PM", "04:00 PM - 06:00 PM"];
  const minutes = Number(current.hour ?? 0) * 60 + Number(current.minute ?? 0);
  const starts = [540, 660, 840, 960];
  const todayWindows = windows.filter((_, index) => minutes < starts[index]);
  return {
    dates: [...(todayWindows.length ? [{ date: today, slots: todayWindows }] : []), { date: tomorrow, slots: windows }],
    source: "request_windows",
    note: "These are request windows. Delhivery confirms or reschedules the pickup when the booking is submitted.",
    timezone: "Asia/Kolkata",
  };
}

function delhiveryB2bManifestPayload(env: Env, payload: Record<string, unknown>) {
  const origin = delhiveryAddress(payload.origin_address, String(payload.origin ?? "PSS Logistics"));
  const destination = delhiveryAddress(payload.destination_address, String(payload.consignee ?? "Consignee"));
  // The Delhivery account label and the registered pickup warehouse are
  // separate provider values. Never use the account label as the warehouse.
  const pickupLocation = String(payload.delhivery_pickup_location ?? payload.pickup_location ?? env.DELHIVERY_DEFAULT_PICKUP_LOCATION ?? "").trim();
  const orderId = String(payload.order_id ?? payload.invoice_reference ?? payload.invoice_number ?? "").trim().slice(0, 50);
  const invoiceNumber = String(payload.invoice_reference ?? payload.invoice_number ?? "").trim();
  const providerInvoiceNumber = invoiceNumber.replace(/[^A-Za-z0-9\/-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const declaredValue = Number(payload.declared_value ?? 0);
  const weightKg = Number(payload.total_weight_kg ?? 0);
  const pieces = Number(payload.pieces ?? 1);
  if (!origin || !destination || !pickupLocation || !providerInvoiceNumber || !Number.isFinite(declaredValue) || declaredValue < 0 || !Number.isFinite(weightKg) || weightKg <= 0 || !Number.isInteger(pieces) || pieces < 1) return null;
  const paymentMode = String(payload.payment_mode ?? "prepaid").trim().toLowerCase() === "cod" ? "CoD" : "Prepaid";
  const dimensions = Array.isArray(payload.dimensions)
    ? payload.dimensions
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        length: Number(item.length ?? 0),
        width: Number(item.width ?? item.breadth ?? 0),
        height: Number(item.height ?? 0),
        count: Math.max(1, Math.trunc(Number(item.quantity ?? item.count ?? item.box_count ?? 1))),
      }))
      .filter((item) => item.length > 0 && item.width > 0 && item.height > 0)
    : [];
  return {
    // These names and nesting follow Delhivery's documented B2B ManifestPayload.
    pickup_location: pickupLocation,
    d_mode: paymentMode,
    amount: paymentMode === "CoD" ? Number(payload.cod_amount ?? declaredValue) : 0,
    invoices: [{ ident: providerInvoiceNumber, n_value: declaredValue }],
    weight: Math.max(1, Math.round(weightKg * 1000)),
    dropoff_location: {
      consignee: destination.name,
      address: destination.line,
      city: destination.city,
      region: destination.state,
      zip: destination.pincode,
      phone: destination.phone,
      email: destination.email ?? "",
    },
    suborders: [{
      ident: orderId,
      count: Math.max(1, Math.trunc(pieces)),
      description: String(payload.description ?? "Shipment").trim().slice(0, 200) || "Shipment",
      // Delhivery requires exactly one waybill slot on the master suborder.
      // An empty slot preserves Delhivery's server-side waybill allocation;
      // sending no array at all is rejected before the order can be queued.
      waybills: [""],
      master: true,
    }],
    ...(dimensions.length ? { dimensions } : {}),
    ...(String(payload.client_gst_tin ?? payload.seller_gst_tin ?? "").trim()
      ? { seller_gst_tin: String(payload.client_gst_tin ?? payload.seller_gst_tin).trim() }
      : {}),
    ...(String(payload.consignee_gst_tin ?? "").trim()
      ? { consignee_gst_tin: String(payload.consignee_gst_tin).trim() }
      : {}),
  };
}

function delhiveryB2bManifestForm(payload: Record<string, unknown>, invoiceDocuments: unknown) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
    // Delhivery's B2B form parser follows the representation used by its
    // documented curl example for list fields (Python-style booleans).
    form.append(key, typeof value === "object" ? serialized.replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None") : serialized);
  }
  const documents = Array.isArray(invoiceDocuments) ? invoiceDocuments.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  if (documents.length) {
    const invoices = Array.isArray(payload.invoices) ? payload.invoices as Array<Record<string, unknown>> : [];
    form.append("doc_data", JSON.stringify(documents.map((document, index) => ({
      doc_type: "INVOICE_COPY",
      doc_meta: { invoice_num: [String(document.invoice_number ?? invoices[index]?.inv_num ?? "")] },
    }))));
    for (const document of documents) {
      const encoded = String(document.body_base64 ?? "").replace(/^data:[^,]+,/, "");
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const blob = new Blob([bytes], { type: String(document.content_type ?? "application/pdf") });
      form.append("doc_file", blob, String(document.name ?? "invoice.pdf"));
    }
  }
  return form;
}

async function persistShipmentDocuments(env: Env, clientId: string, shipmentId: string, documents: unknown, uploadedBy: string) {
  const items = Array.isArray(documents) ? documents.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  if (!items.length) return { ok: false as const, error: "An invoice document is required for Delhivery B2B booking" };
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  let totalBytes = 0;
  for (const item of items) {
    const name = String(item.name ?? "").trim();
    const contentType = String(item.content_type ?? "").split(";", 1)[0].trim().toLowerCase();
    const encoded = String(item.body_base64 ?? "").replace(/^data:[^,]+,/, "");
    if (!name || name.length > 200 || !allowed.has(contentType) || !encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) return { ok: false as const, error: "Invoice files must be valid PDF, JPG, or PNG documents" };
    let binary: string;
    try { binary = atob(encoded); } catch { return { ok: false as const, error: "Invoice file content is not valid base64" }; }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    totalBytes += bytes.byteLength;
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024 || totalBytes > 20 * 1024 * 1024 || !documentSignatureMatches(contentType, bytes)) return { ok: false as const, error: "Invoice files must be valid documents up to 10 MB each and 20 MB total" };
    const documentId = crypto.randomUUID();
    const objectKey = `clients/${clientId}/shipments/${shipmentId}/${documentId}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType } });
    try {
      await env.DB.prepare("INSERT INTO shipment_documents (id, shipment_id, client_id, object_key, original_filename, content_type, file_size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(documentId, shipmentId, clientId, objectKey, name, contentType, bytes.byteLength, uploadedBy).run();
    } catch (caught) {
      await env.FILES.delete(objectKey).catch(() => undefined);
      throw caught;
    }
  }
  return { ok: true as const };
}

type StagedInvoiceDocument = { object_key: string; name: string; content_type: string; body_base64: string };

async function loadStagedInvoiceDocuments(env: Env, clientId: string, references: unknown) {
  const refs = Array.isArray(references) ? references.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  if (!refs.length) return { ok: false as const, error: "At least one staged invoice document is required" };
  const documents: StagedInvoiceDocument[] = [];
  const objectKeys: string[] = [];
  let totalBytes = 0;
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  for (const ref of refs) {
    const objectKey = String(ref.object_key ?? "").trim();
    if (!objectKey.startsWith(`staged/clients/${clientId}/`)) return { ok: false as const, error: "The staged invoice reference is not valid for this client" };
    const object = await env.FILES.get(objectKey);
    const metadata = object?.customMetadata ?? {};
    const name = String(metadata.original_filename ?? ref.name ?? "").trim();
    const contentType = String(metadata.content_type ?? ref.content_type ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!object || String(metadata.client_id ?? "") !== clientId || !name || name.length > 200 || !allowed.has(contentType)) return { ok: false as const, error: "The staged invoice document is missing or invalid" };
    const bytes = new Uint8Array(await object.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024 || totalBytes > 20 * 1024 * 1024 || !documentSignatureMatches(contentType, bytes)) return { ok: false as const, error: "Invoice files must be valid documents up to 10 MB each and 20 MB total" };
    documents.push({ object_key: objectKey, name, content_type: contentType, body_base64: providerBytesToBase64(bytes) });
    objectKeys.push(objectKey);
  }
  return { ok: true as const, documents, objectKeys };
}

function delhiveryCreatePayload(env: Env, payload: Record<string, unknown>) {
  const origin = delhiveryAddress(payload.origin_address, String(payload.origin ?? "PSS Logistics"));
  const destination = delhiveryAddress(payload.destination_address, String(payload.consignee ?? "Consignee"));
  const client = String(payload.delhivery_client_name ?? env.DELHIVERY_CLIENT_NAME ?? "").trim();
  const pickupLocation = String(payload.delhivery_pickup_location ?? payload.pickup_location ?? env.DELHIVERY_DEFAULT_PICKUP_LOCATION ?? "").trim();
  const weightKg = Number(payload.total_weight_kg ?? 0);
  const pieces = Number(payload.pieces ?? 1);
  const declaredValue = Math.max(Number(payload.declared_value ?? 0), 0);
  if (!origin || !destination || !client || !pickupLocation || !Number.isFinite(weightKg) || weightKg <= 0 || !Number.isInteger(pieces) || pieces < 1) return null;
  const paymentMode = String(payload.payment_mode ?? "prepaid").trim().toLowerCase() === "cod" ? "COD" : "Pre-paid";
  const orderId = String(payload.order_id ?? payload.invoice_reference ?? payload.invoice_number ?? "").trim().slice(0, 50);
  const shipment: Record<string, unknown> = {
    client,
    order: orderId,
    order_date: String(payload.order_date ?? new Date().toISOString().slice(0, 10)),
    product_type: String(payload.product_type ?? "B2B"),
    name: destination.name,
    add: destination.line,
    city: destination.city,
    state: destination.state,
    country: destination.country,
    pin: destination.pincode,
    phone: destination.phone,
    payment_mode: paymentMode,
    total_amount: declaredValue.toFixed(2),
    cod_amount: paymentMode === "COD" ? String(payload.cod_amount ?? declaredValue.toFixed(2)) : "0",
    weight: Math.max(1, Math.round(weightKg * 1000)),
    quantity: pieces,
    products_desc: String(payload.description ?? "Shipment").replace(/[&#%;\\]/g, " ").slice(0, 500),
    pickup_location: pickupLocation,
    seller_name: origin.name,
    seller_add: origin.line,
    seller_city: origin.city,
    seller_state: origin.state,
    seller_pin: origin.pincode,
    seller_phone: origin.phone,
    return_add: origin.line,
    return_city: origin.city,
    return_state: origin.state,
    return_pin: origin.pincode,
    return_country: origin.country,
    return_phone: origin.phone,
  };
  const optional: Record<string, unknown> = {
    waybill: payload.waybill,
    shipment_length: payload.length,
    shipment_width: payload.width,
    shipment_height: payload.height,
    seller_gst_tin: payload.seller_gst_tin,
    client_gst_tin: payload.client_gst_tin,
    consignee_gst_tin: payload.consignee_gst_tin,
    hsn_code: payload.hsn_code,
    invoice_reference: payload.invoice_reference,
    e_waybill_no: payload.e_waybill_no,
    fragile_shipment: payload.fragile_shipment,
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined && value !== null && String(value).trim() !== "") shipment[key] = value;
  return { shipments: [shipment] };
}

function normalizePickupAwbNumbers(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value ?? "").trim();
  return text ? text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizePickupStartTime(value: string) {
  const match = value.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toUpperCase();
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (meridiem === "PM" && hour !== 12) hour += 12;
  }
  return [hour, minute, second].map((part) => String(part).padStart(2, "0")).join(":");
}

function delhiveryPickupPayload(env: Env, payload: Record<string, unknown>, useDelhiveryB2b = false) {
  const pickupLocation = String(payload.delhivery_pickup_location ?? payload.pickup_location ?? env.DELHIVERY_DEFAULT_PICKUP_LOCATION ?? "").trim();
  const pickupDate = String(payload.scheduled_date ?? payload.pickup_date ?? "").trim();
  const rawWindow = String(payload.window ?? payload.pickup_time ?? "").trim();
  const startTime = normalizePickupStartTime(rawWindow);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  if (useDelhiveryB2b) {
    if (!pickupLocation || !startTime) return null;
    return {
      client_warehouse: pickupLocation,
      pickup_date: pickupDate,
      start_time: startTime,
      expected_package_count: Math.max(1, Number(payload.expected_package_count ?? payload.package_count ?? payload.pieces ?? 1)),
    };
  }
  if (!pickupLocation) return null;
  return { pickup_time: startTime ?? "00:00:00", pickup_date: pickupDate, pickup_location: pickupLocation, expected_package_count: Math.max(1, Number(payload.expected_package_count ?? payload.package_count ?? 1)) };
}

function providerSafePickupDate(dateValue: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const current = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${current.year}-${current.month}-${current.day}`;
  // Keep today's date while the booking flow tries the remaining windows.
  // Delhivery decides whether a particular window is still bookable; moving
  // directly to tomorrow here would skip valid later slots today.
  const isPast = !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || dateValue < today;
  if (!isPast) return dateValue;
  const next = new Date(`${today}T12:00:00+05:30`);
  next.setUTCDate(next.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(next);
}

function normalizePickupPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

function validPickupDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function findProviderReference(value: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  const normalizedKeys = new Set([...keys].map((key) => key.toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) { const found = findProviderReference(item, keys, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(object)) {
    if (normalizedKeys.has(key.toLowerCase()) && (typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) return String(candidate).trim().slice(0, 160);
  }
  for (const candidate of Object.values(object)) { const found = findProviderReference(candidate, keys, depth + 1); if (found) return found; }
  return null;
}

function validDelhiveryPickupReference(value: unknown) {
  const reference = String(value ?? "").trim();
  return /^\d{6,20}$/.test(reference) ? reference : null;
}

function findProviderUrl(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
  if (Array.isArray(value)) { for (const item of value) { const found = findProviderUrl(item, depth + 1); if (found) return found; } return null; }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of ["download_url", "downloadUrl", "file_url", "fileUrl", "url", "link"]) { const found = findProviderUrl(object[key], depth + 1); if (found) return found; }
  for (const item of Object.values(object)) { const found = findProviderUrl(item, depth + 1); if (found) return found; }
  return null;
}

function findProviderUrls(value: unknown, result: string[] = [], depth = 0, parentKey = "", baseUrl?: string): string[] {
  if (depth > 8 || value === null || value === undefined) return result;
  if (typeof value === "string") {
    const text = value.trim();
    const candidates = /^https?:\/\//i.test(text)
      ? [text]
      : [...text.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => match[0].replace(/[),.;]+$/, ""));
    for (const url of candidates) {
      if (!result.includes(url)) result.push(url);
    }
    const relativeAsset = /(?:url|uri|link|path|file|document|label|mps)/i.test(parentKey) && (/^(?:\/\/|\/)/.test(text) || /^[^\s]+\.(?:pdf|png|jpe?g|webp)(?:[?#].*)?$/i.test(text));
    const resolved = relativeAsset && baseUrl ? new URL(text, baseUrl).toString() : null;
    if (resolved && !result.includes(resolved)) result.push(resolved);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) findProviderUrls(item, result, depth + 1, parentKey, baseUrl);
    return result;
  }
  if (typeof value !== "object") return result;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) findProviderUrls(item, result, depth + 1, key, baseUrl);
  return result;
}

function findProviderContentBase64(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined || typeof value !== "object") return null;
  if (Array.isArray(value)) { for (const item of value) { const found = findProviderContentBase64(item, depth + 1); if (found) return found; } return null; }
  const object = value as Record<string, unknown>;
  for (const key of ["content_base64", "pdf_base64", "base64", "content", "pdf", "label", "file", "document", "data"]) {
    const candidate = object[key];
    if (typeof candidate === "string") {
      const normalized = candidate.trim().replace(/^data:[^;]+;base64,/, "");
      if (normalized.length > 100 && /^[A-Za-z0-9+/=\r\n]+$/.test(normalized)) return normalized;
    }
  }
  for (const item of Object.values(object)) { const found = findProviderContentBase64(item, depth + 1); if (found) return found; }
  return null;
}

function findProviderContentType(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProviderContentType(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["content_type", "contentType", "mime_type", "mimeType", "type"]) {
    const candidate = object[key];
    if (typeof candidate === "string" && candidate.includes("/")) return candidate.split(";", 1)[0].trim().toLowerCase();
  }
  for (const item of Object.values(object)) {
    const found = findProviderContentType(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function providerContentTypeFromBase64(value: string, fallback: string) {
  const normalized = value.replace(/^data:[^;]+;base64,/, "").trim();
  if (normalized.startsWith("JVBERi0")) return "application/pdf";
  if (normalized.startsWith("iVBORw0KGgo")) return "image/png";
  if (normalized.startsWith("/9j/")) return "image/jpeg";
  return fallback;
}

function isProviderPdfArtifact(value: unknown) {
  const base64 = findProviderContentBase64(value);
  if (!base64) return false;
  return providerContentTypeFromBase64(base64, findProviderContentType(value) ?? "application/octet-stream") === "application/pdf";
}

function providerContentTypeFromBytes(bytes: Uint8Array, declared: string) {
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (header === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return declared.split(";", 1)[0].trim().toLowerCase() || "application/octet-stream";
}

// Delhivery's UI exposes physical sizes, while the documented B2B API accepts
// only sm, md, and a4. Keep this translation server-side so the client stays
// on the physical-size contract shown to users.
function delhiveryLabelApiSize(size: string) {
  return ({
    a4: "a4",
    "4x2": "sm",
    "4x2.5": "md",
    "3x2": "sm",
  } as Record<string, string>)[size] ?? size;
}

function delhiveryB2bDocsBase() {
  return "https://btob.api.delhivery.com";
}

function delhiveryLabelApiBase() {
  return "https://ltl-clients-api.delhivery.com";
}

function delhiveryUcpLabelSize(size: string) {
  return ({ a4: "a4", "4x2": "sm", "4x2.5": "md", "3x2": "sm" } as Record<string, string>)[size] ?? "a4";
}

function findProviderToken(value: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  const normalizedKeys = new Set([...keys].map((key) => key.toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) { const found = findProviderToken(item, keys, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(object)) {
    if (normalizedKeys.has(key.toLowerCase()) && typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const candidate of Object.values(object)) { const found = findProviderToken(candidate, keys, depth + 1); if (found) return found; }
  return null;
}
function delhiveryB2bNumber(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return /^\d{6,20}$/.test(normalized) ? normalized : null;
}
function findProviderAmount(value: unknown, keys = new Set(["amount", "total_amount", "total", "freight", "grand_total", "shipping_charge"]), depth = 0): number | null {
  if (depth > 5 || value === null || value === undefined) return null;
  if (Array.isArray(value)) { for (const item of value) { const found = findProviderAmount(item, keys, depth + 1); if (found !== null) return found; } return null; }
  if (typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key.toLowerCase())) { const numeric = typeof item === "number" ? item : Number(String(item).replace(/[^0-9.-]/g, "")); if (Number.isFinite(numeric)) return numeric; }
  }
  for (const item of Object.values(value as Record<string, unknown>)) { const found = findProviderAmount(item, keys, depth + 1); if (found !== null) return found; }
  return null;
}

function findDelhiveryCost(value: unknown, depth = 0): number | null {
  const preferredKeys = [
    "delhivery_cost", "provider_cost", "provider_amount", "shipping_charge", "freight_charge",
    "freight", "total_freight", "total_charge", "total_charges", "billing_amount", "billing_total",
    "amount",
  ];
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findDelhiveryCost(item, depth + 1); if (found !== null) return found; }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of preferredKeys) {
    const candidate = object[key] ?? object[Object.keys(object).find((item) => item.toLowerCase() === key) ?? ""];
    const numeric = typeof candidate === "number" ? candidate : Number(String(candidate ?? "").replace(/[^0-9.-]/g, ""));
    if (candidate !== undefined && Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  for (const [key, child] of Object.entries(object)) {
    if (/(?:charge|cost|freight|billing)/i.test(key)) {
      const numeric = typeof child === "number" ? child : Number(String(child ?? "").replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
  }
  for (const child of Object.values(object)) { const found = findDelhiveryCost(child, depth + 1); if (found !== null) return found; }
  return null;
}

function normalizeProviderEdd(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : 0;
    if (milliseconds) return new Date(milliseconds).toISOString().slice(0, 10);
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw || raw.length > 80) return null;
  const isoDate = raw.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  const dmy = raw.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}
function normalizeProviderEddFromText(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!/(?:edd|estimated|expected|promised|delivery|deliver by|arrival)/i.test(text)) return null;
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return normalizeProviderEdd(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const dmy = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (dmy) return normalizeProviderEdd(`${dmy[1]}-${dmy[2]}-${dmy[3]}`);
  const named = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})[, ]+\s*(20\d{2})\b/);
  if (named) return normalizeProviderEdd(`${named[1]} ${named[2]} ${named[3]}`);
  return null;
}
function findProviderEdd(value: unknown, depth = 0): string | null {
  if (depth > 12 || value === null || value === undefined) return null;
  const expectedKeys = new Set([
    "edd", "estimateddeliverydate", "estimateddelivery", "estimateddeliverydatetime",
    "estimateddeliverydatetime", "expecteddeliverydate", "expecteddelivery", "expecteddeliverydatetime",
    "expecteddate", "expecteddateofdelivery", "promiseddeliverydate", "deliveryestimate", "deliverydate", "estimateddate",
    "eta", "estimatedtimeofarrival", "arrivaldate", "deliveryeta",
  ].map((key) => key.toLowerCase().replace(/[^a-z]/g, "")));
  if (Array.isArray(value)) {
    for (const item of value) { const found = findProviderEdd(item, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value === "string") return normalizeProviderEddFromText(value);
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(object)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (expectedKeys.has(normalizedKey) || /(?:edd|estimateddelivery|expecteddelivery|deliveryestimate|deliveryeta|arrivaldate)/.test(normalizedKey)) {
      const found = normalizeProviderEdd(candidate);
      if (found) return found;
      if (candidate && typeof candidate === "object") {
        const nested = candidate as Record<string, unknown>;
        for (const dateKey of ["date", "value", "datetime", "timestamp", "delivery_date", "deliveryDate"]) {
          const nestedFound = normalizeProviderEdd(nested[dateKey]);
          if (nestedFound) return nestedFound;
        }
      }
    }
  }
  for (const candidate of Object.values(object)) { const found = findProviderEdd(candidate, depth + 1); if (found) return found; }
  return null;
}

type NormalizedProviderTracking = { status: string; location: string; description: string; eventTime: string | null };
function normalizeProviderTrackingEvents(value: unknown, depth = 0): NormalizedProviderTracking[] {
  if (depth > 8 || value === null || value === undefined) return [];
  const candidates: NormalizedProviderTracking[] = [];
  const knownStatuses = new Set(["booked", "picked_up", "in_transit", "out_for_delivery", "delivered", "cancelled", "exception", "rto"]);
  const statusFromScanText = (description: string, fallback: string) => {
    const text = description.toLowerCase();
    if (/cancel/.test(text)) return "cancelled";
    if (/deliver(?:ed|y complete)/.test(text)) return "delivered";
    if (/out for delivery|ofd/.test(text)) return "out_for_delivery";
    if (/return to origin|returned|rto/.test(text)) return "rto";
    if (/not picked|pickup failed|failed pickup/.test(text)) return "booked";
    if (/out for pickup|driver assigned|en route/.test(text)) return "booked";
    if (/picked up|pickup complete|collected/.test(text)) return "picked_up";
    if (/manifest|uploaded|created|booked/.test(text)) return "booked";
    if (/transit|departed|bag added|trip arrived|received at|arrived at|weight captured|dispatched|shipped/.test(text)) return "in_transit";
    return fallback;
  };
  const scanDetails: Array<Record<string, unknown>> = [];
  const collectScans = (node: unknown, level: number) => {
    if (level > 8 || node === null || node === undefined) return;
    if (Array.isArray(node)) { for (const item of node) collectScans(item, level + 1); return; }
    if (typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    const normalizedKeys = Object.keys(object).map((key) => key.toLowerCase().replace(/[^a-z]/g, ""));
    const hasScanTime = normalizedKeys.some((key) => /scan.*date|date.*scan|status.*date|event.*time/.test(key));
    const hasScanText = normalizedKeys.some((key) => /scan|instruction|description|statusmessage/.test(key));
    if (hasScanTime && hasScanText) scanDetails.push(object);
    for (const [key, child] of Object.entries(object)) {
      if (key.toLowerCase() === "scans") {
        const scanItems = Array.isArray(child) ? child : child && typeof child === "object" ? [child] : [];
        for (const item of scanItems) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const detail = record.ScanDetail ?? record.scan_detail ?? record.scanDetail;
          const details = Array.isArray(detail) ? detail : detail && typeof detail === "object" ? [detail] : [];
          if (details.length) for (const entry of details) if (entry && typeof entry === "object") scanDetails.push(entry as Record<string, unknown>);
          else scanDetails.push(record);
        }
      } else collectScans(child, level + 1);
    }
  };
  collectScans(value, depth);
  const currentStatus = (() => {
    let found = "unknown";
    const walk = (node: unknown, level: number) => {
      if (level > 8 || node === null || node === undefined || typeof node !== "object") return;
      if (Array.isArray(node)) { for (const item of node) walk(item, level + 1); return; }
      const object = node as Record<string, unknown>;
      const statusObject = object.Status && typeof object.Status === "object" ? object.Status as Record<string, unknown> : null;
      const raw = object.current_status ?? object.currentStatus ?? object.shipment_status ?? object.ShipmentStatus ??
        statusObject?.Status ?? (typeof object.Status === "string" ? object.Status : undefined);
      if (typeof raw === "string" && knownStatuses.has(normalizeProviderShipmentStatus(raw))) found = normalizeProviderShipmentStatus(raw);
      for (const child of Object.values(object)) walk(child, level + 1);
    };
    walk(value, depth);
    return found;
  })();
  // Some Delhivery responses expose the pickup lifecycle only as the current
  // status (without a matching Scans[] description). Preserve that provider
  // state as a synthetic event so pickup reconciliation can consume it.
  const currentPickupStatus = (() => {
    let found = "";
    const walk = (node: unknown, level: number) => {
      if (level > 8 || node === null || node === undefined || typeof node !== "object" || found) return;
      if (Array.isArray(node)) { for (const item of node) walk(item, level + 1); return; }
      const object = node as Record<string, unknown>;
      for (const key of ["current_status", "currentStatus", "shipment_status", "ShipmentStatus", "status", "Status", "state", "pickup_status"]) {
        const value = object[key];
        if (typeof value === "string" && /out[ _-]+for[ _-]+pickup|driver[ _-]+assigned|en[ _-]+route/i.test(value)) { found = value; return; }
      }
      for (const child of Object.values(object)) walk(child, level + 1);
    };
    walk(value, depth);
    return found;
  })();
  if (currentPickupStatus && !candidates.some((candidate) => /out for pickup|driver assigned|en route/i.test(candidate.description))) {
    candidates.push({ status: "booked", location: "", description: currentPickupStatus.replaceAll("_", " "), eventTime: null });
  }
  for (const scan of scanDetails) {
    const description = String(scan.Instructions ?? scan.instructions ?? scan.Scan ?? scan.scan ?? scan.Description ?? scan.description ?? "Provider scan").trim().slice(0, 500);
    const eventTimeValue = scan.ScanDateTime ?? scan.scan_date_time ?? scan.StatusDateTime ?? scan.status_date_time ?? scan.event_time ?? scan.eventTime ?? scan.timestamp;
    const location = String(scan.ScannedLocation ?? scan.scanned_location ?? scan.StatusLocation ?? scan.status_location ?? scan.Location ?? scan.location ?? scan.City ?? scan.city ?? "").trim().slice(0, 200);
    const status = statusFromScanText(description, currentStatus);
    if (knownStatuses.has(status)) candidates.push({ status, location, description, eventTime: typeof eventTimeValue === "string" ? eventTimeValue : null });
  }
  // If the provider supplied its canonical scan array, use it as the source
  // of truth. The recursive fallback below is only for older/provider-specific
  // response shapes that do not expose Scans[].
  if (scanDetails.length) {
    const unique = new Map<string, NormalizedProviderTracking>();
    for (const candidate of candidates) unique.set(`${candidate.status}|${candidate.location}|${candidate.description}|${candidate.eventTime ?? ""}`, candidate);
    const order: Record<string, number> = { booked: 0, picked_up: 1, in_transit: 2, out_for_delivery: 3, delivered: 4, rto: 4, cancelled: 4, exception: -1 };
    return [...unique.values()].sort((left, right) => {
      const leftTime = left.eventTime ? Date.parse(left.eventTime) : Number.NaN;
      const rightTime = right.eventTime ? Date.parse(right.eventTime) : Number.NaN;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
      return (order[left.status] ?? -1) - (order[right.status] ?? -1);
    });
  }
  const collect = (node: unknown, level: number) => {
    if (level > 8 || node === null || node === undefined) return;
    if (Array.isArray(node)) { for (const item of node) collect(item, level + 1); return; }
    if (typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    const nestedStatus = object.Status && typeof object.Status === "object" ? object.Status as Record<string, unknown> : null;
    const rawStatus = object.status ?? object.current_status ?? object.currentStatus ??
      (typeof object.Status === "string" ? object.Status : undefined) ??
      object.shipment_status ?? object.ShipmentStatus ?? object.scan_status ??
      object.status_text ?? object.status_name ?? object.state ?? object.event ?? object.scan_type ??
      object.Scan ?? object.scan ?? object.ScanType ?? object.scanType ??
      nestedStatus?.Status ?? nestedStatus?.status;
    const normalized = normalizeProviderShipmentStatus(rawStatus);
    if (typeof rawStatus === "string" && knownStatuses.has(normalized)) {
      const eventTimeValue = object.event_time ?? object.eventTime ?? object.timestamp ??
        object.status_date_time ?? object.StatusDateTime ?? object.scan_time ?? object.scan_date ??
        object.ScanDateTime ?? object.scan_date_time ?? object.eventDateTime ??
        nestedStatus?.StatusDateTime ?? nestedStatus?.status_date_time;
      candidates.push({
        status: normalized,
        location: String(object.location ?? object.city ?? object.status_location ?? object.StatusLocation ?? object.ScannedLocation ?? object.scanned_location ?? object.ScanLocation ?? object.scan_location ?? nestedStatus?.StatusLocation ?? nestedStatus?.location ?? "").trim().slice(0, 200),
        description: String(object.description ?? object.message ?? object.instructions ?? object.Instructions ?? object.Scan ?? object.scan ?? object.status_description ?? nestedStatus?.Instructions ?? nestedStatus?.description ?? `Provider status: ${normalized}`).trim().slice(0, 500),
        eventTime: typeof eventTimeValue === "string" ? eventTimeValue : null,
      });
    }
    for (const child of Object.values(object)) collect(child, level + 1);
  };
  collect(value, depth);
  // Delhivery may repeat the same scan in a wrapper and in its nested scan list.
  const unique = new Map<string, NormalizedProviderTracking>();
  for (const candidate of candidates) unique.set(`${candidate.status}|${candidate.location}|${candidate.description}|${candidate.eventTime ?? ""}`, candidate);
  const deduped = [...unique.values()];
  if (!deduped.length) return [];
  // Delhivery responses can include an exception-like wrapper alongside the
  // actual scan state. When an authenticated active scan is present, expose
  // that operational state instead of letting the wrapper hide transit.
  const activeCandidates = deduped.filter((candidate) => ["picked_up", "in_transit", "out_for_delivery", "delivered"].includes(candidate.status));
  const effectiveCandidates = activeCandidates.length ? activeCandidates : deduped;
  const order: Record<string, number> = { booked: 0, picked_up: 1, in_transit: 2, out_for_delivery: 3, delivered: 4, rto: 4, cancelled: 4, exception: -1 };
  return effectiveCandidates.sort((left, right) => {
    const leftTime = left.eventTime ? Date.parse(left.eventTime) : Number.NaN;
    const rightTime = right.eventTime ? Date.parse(right.eventTime) : Number.NaN;
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
    return (order[left.status] ?? -1) - (order[right.status] ?? -1);
  });
}
function normalizeProviderTracking(value: unknown): NormalizedProviderTracking | null {
  const events = normalizeProviderTrackingEvents(value);
  return events.at(-1) ?? null;
}

type ProviderWeightSnapshot = { measuredKg: number | null; chargeableKg: number | null };
const minimumShipmentWeightKg = 20;
function effectiveShipmentWeightKg(declaredKg: number, providerKg: number | null) {
  const declared = Number.isFinite(declaredKg) && declaredKg > 0 ? declaredKg : 0;
  const provider = providerKg !== null && Number.isFinite(providerKg) && providerKg > 0 ? providerKg : 0;
  return Number(Math.max(minimumShipmentWeightKg, declared, provider).toFixed(3));
}
const providerWeightKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const providerWeightNumber = (value: unknown, key = "", unit?: unknown): number | null => {
  let raw: unknown = value;
  let explicitUnit = typeof unit === "string" ? unit.toLowerCase() : "";
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const object = raw as Record<string, unknown>;
    raw = object.value ?? object.amount ?? object.weight ?? object.value_kg ?? object.kg ?? object.grams ?? object.g;
    explicitUnit = String(object.unit ?? object.uom ?? explicitUnit).toLowerCase();
  }
  const number = Number(typeof raw === "string" ? raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] : raw);
  if (!Number.isFinite(number) || number <= 0) return null;
  const normalizedKey = providerWeightKey(key);
  const grams = /gram|grams|gramme|gm|gms/.test(explicitUnit) || /gram|grams|gramme|gm|gms/.test(normalizedKey) || (normalizedKey.endsWith("g") && !normalizedKey.endsWith("kg"));
  const kg = /kg|kilogram/.test(explicitUnit) || /kg|kilogram/.test(normalizedKey);
  const normalized = grams ? number / 1000 : kg ? number : number > 1000 ? number / 1000 : number;
  return normalized > 0 && normalized < 100000 ? Number(normalized.toFixed(3)) : null;
};
function findProviderWeight(value: unknown, depth = 0): ProviderWeightSnapshot {
  if (depth > 10 || value === null || value === undefined) return { measuredKg: null, chargeableKg: null };
  const measuredKeys = new Set(["actualweight", "actualweightkg", "capturedweight", "capturedweightkg", "measuredweight", "measuredweightkg", "shipmentweight", "shipmentweightkg", "weightcaptured", "weightcapturedkg"]);
  const chargeableKeys = new Set(["chargeableweight", "chargeableweightkg", "billableweight", "billableweightkg", "courierbilledweight", "courierbilledweightkg"]);
  let measuredKg: number | null = null;
  let chargeableKg: number | null = null;
  const walk = (node: unknown, level: number) => {
    if (level > 10 || node === null || node === undefined || (measuredKg !== null && chargeableKg !== null)) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, level + 1); return; }
    if (typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    for (const [key, candidate] of Object.entries(object)) {
      const normalized = providerWeightKey(key);
      if (chargeableKg === null && (chargeableKeys.has(normalized) || /chargeable.*weight|billable.*weight|courier.*billed.*weight/.test(normalized))) chargeableKg = providerWeightNumber(candidate, key);
      if (measuredKg === null && (measuredKeys.has(normalized) || /actual.*weight|captured.*weight|measured.*weight|shipment.*weight/.test(normalized))) measuredKg = providerWeightNumber(candidate, key);
      // Delhivery scan/detail responses sometimes expose only `Weight`; accept
      // it as measured weight, but never let it overwrite an explicit value.
      if (measuredKg === null && normalized === "weight") measuredKg = providerWeightNumber(candidate, key);
      if (candidate && typeof candidate === "object") walk(candidate, level + 1);
    }
  };
  walk(value, depth);
  return { measuredKg, chargeableKg };
}

async function persistProviderWeight(env: Env, shipmentId: string, clientId: string, snapshot: ProviderWeightSnapshot) {
  const shipment = await env.DB.prepare("SELECT total_weight_kg, weight_source FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(shipmentId, clientId).first<{ total_weight_kg: number | null; weight_source: string | null }>();
  const providerKg = snapshot.chargeableKg ?? snapshot.measuredKg;
  if (!shipment || providerKg === null) return;
  const effectiveKg = effectiveShipmentWeightKg(Number(shipment.total_weight_kg ?? 0), providerKg);
  // Keep the declared booking weight intact. The operational/billable value is
  // the greater of the 20 kg minimum, client declaration, and provider weight.
  // A manual reconciliation override remains authoritative.
  await env.DB.batch([
    env.DB.prepare("UPDATE shipments SET weight_override_kg = ?, weight_source = 'reconciled', weight_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ? AND COALESCE(weight_source, 'booking') <> 'manual'").bind(effectiveKg, shipmentId, clientId),
    env.DB.prepare("UPDATE weight_reconciliations SET measured_weight_kg = COALESCE(?, measured_weight_kg), courier_billed_weight_kg = COALESCE(?, courier_billed_weight_kg), billable_weight_kg = ?, provider_weight_received_at = CURRENT_TIMESTAMP, client_dispute_deadline_at = COALESCE(client_dispute_deadline_at, datetime(CURRENT_TIMESTAMP, '+24 hours')), provider_dispute_status = CASE WHEN provider_dispute_status IN ('dispute_pending', 'recovered') THEN provider_dispute_status ELSE 'received' END, status = CASE WHEN status = 'resolved' THEN status ELSE 'measured' END, updated_at = CURRENT_TIMESTAMP WHERE shipment_id = ? AND client_id = ?").bind(snapshot.measuredKg ?? providerKg, snapshot.chargeableKg ?? providerKg, effectiveKg, shipmentId, clientId),
  ]);
}

function trackonCredentials(env: Env, accountCredential?: string) {
  const raw = accountCredential ?? (env as unknown as Record<string, unknown>).TRACKON_CREDENTIALS_JSON;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const userId = String(parsed.userId ?? parsed.UserID ?? "").trim();
    const password = String(parsed.password ?? parsed.Pass ?? "").trim();
    const appKey = String(parsed.appKey ?? parsed.AppKey ?? "").trim();
    return userId && password && appKey ? { userId, password, appKey } : null;
  } catch { return null; }
}

function trackonTrackingUrl(endpoint: string, trackingNumber: string, credentials: { userId: string; password: string; appKey: string }) {
  const url = new URL(endpoint);
  url.searchParams.set("AWBNo", trackingNumber);
  url.searchParams.set("AppKey", credentials.appKey);
  url.searchParams.set("userID", credentials.userId);
  url.searchParams.set("Password", credentials.password);
  return url.toString();
}

function trackonLabelUrl(endpoint: string, trackingNumber: string, credentials: { userId: string; password: string; appKey: string }) {
  const url = new URL(endpoint);
  url.searchParams.set("AWBNo", trackingNumber);
  url.searchParams.set("Appkey", credentials.appKey);
  url.searchParams.set("userId", credentials.userId);
  url.searchParams.set("password", credentials.password);
  return url.toString();
}

function trackonPayload(payload: Record<string, unknown>, credentials: { userId: string; password: string; appKey: string }) {
  const origin = payload.origin_address && typeof payload.origin_address === "object" ? payload.origin_address as Record<string, unknown> : {};
  const destination = payload.destination_address && typeof payload.destination_address === "object" ? payload.destination_address as Record<string, unknown> : {};
  return {
    Appkey: credentials.appKey,
    userId: credentials.userId,
    password: credentials.password,
    SerialNo: String(payload.serial_no ?? payload.serialNo ?? "1"),
    RefNo: String(payload.ref_no ?? payload.order_id ?? payload.invoice_reference ?? payload.invoice_number ?? ""),
    ActionType: "Book",
    CustomerCode: String(payload.customer_code ?? ""),
    ClientName: String(payload.consignee ?? destination.name ?? "Consignee"),
    AddressLine1: String(destination.address_line1 ?? destination.address ?? payload.destination ?? ""),
    AddressLine2: String(destination.address_line2 ?? ""),
    City: String(destination.city ?? ""),
    PinCode: String(destination.pincode ?? destination.pin_code ?? payload.destination_pincode ?? ""),
    MobileNo: String(destination.phone ?? payload.consignee_phone ?? ""),
    Email: String(destination.email ?? ""),
    DocType: String(payload.doc_type ?? "N"),
    TypeOfService: String(payload.service_type ?? "Surface"),
    Weight: String(payload.total_weight_kg ?? payload.weight ?? ""),
    InvoiceValue: String(payload.declared_value ?? payload.invoice_value ?? "0"),
    NoOfPieces: String(payload.pieces ?? "1"),
    Remark: String(payload.remark ?? ""),
    PickupCustCode: String(payload.pickup_customer_code ?? ""),
    PickupCustName: String(origin.name ?? payload.origin ?? "PSS Logistics"),
    PickupAddr: String(origin.address_line1 ?? origin.address ?? payload.origin ?? ""),
    PickupCity: String(origin.city ?? ""),
    PickupState: String(origin.state ?? ""),
    PickupPincode: String(origin.pincode ?? origin.pin_code ?? payload.origin_pincode ?? ""),
    PickupPhone: String(origin.phone ?? payload.pickup_phone ?? ""),
    ServiceType: String(payload.service_type ?? "Standard"),
  };
}

function xpressbeesCredentials(raw?: string) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = String(parsed.email ?? parsed.userEmail ?? "").trim();
    const password = String(parsed.password ?? "").trim();
    return email && password ? { email, password } : null;
  } catch { return null; }
}

async function xpressbeesToken(env: Env, credential: string, requestIdValue: string, timeoutMs = 10000) {
  const account = xpressbeesCredentials(credential);
  if (!account || !env.XPRESSBEES_API_BASE_URL) return null;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${env.XPRESSBEES_API_BASE_URL.replace(/\/$/, "")}/users/franchise_login`, {
      method: "POST", headers: { "content-type": "application/json", "x-request-id": requestIdValue },
      body: JSON.stringify({ email: account.email, password: account.password }), signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json() as { status?: boolean; data?: unknown };
    return body.status && typeof body.data === "string" && body.data.trim() ? body.data.trim() : null;
  } catch { return null; } finally { clearTimeout(timeout); }
}

function xpressbeesTrackingUrl(endpoint: string) { return `${endpoint.replace(/\/$/, "")}/franchise/shipments/track_shipment`; }
function xpressbeesTrackingBody(trackingNumber: string) { return JSON.stringify({ awb_number: trackingNumber }); }
function xpressbeesServiceabilityBody(payload: Record<string, unknown>) {
  const cod = Boolean(payload.cod ?? String(payload.payment_mode ?? "").toLowerCase() === "cod");
  return JSON.stringify({
    Origin: String(payload.origin_pincode ?? payload.origin ?? ""),
    Destination: String(payload.destination_pincode ?? payload.destination ?? ""),
    Cod: cod ? "cod" : "prepaid",
    "Order amount": Number(payload.order_amount ?? payload.declared_value ?? payload.invoice_value ?? 0),
  });
}

function xpressbeesBookingPayload(payload: Record<string, unknown>) {
  const origin = payload.origin_address && typeof payload.origin_address === "object" ? payload.origin_address as Record<string, unknown> : {};
  const destination = payload.destination_address && typeof payload.destination_address === "object" ? payload.destination_address as Record<string, unknown> : {};
  const paymentMethod = String(payload.payment_mode ?? payload.payment_method ?? "prepaid").trim().toUpperCase() === "COD" ? "COD" : "prepaid";
  const declaredValue = Number(payload.declared_value ?? payload.invoice_value ?? 0);
  const pieces = Math.max(1, Number(payload.pieces ?? 1));
  const dimensions = Array.isArray(payload.dimensions) && payload.dimensions.length ? payload.dimensions[0] as Record<string, unknown> : {};
  const date = new Date().toISOString().slice(0, 10);
  return {
    id: String(payload.order_id ?? payload.invoice_reference ?? payload.invoice_number ?? "").slice(0, 20),
    payment_method: paymentMethod,
    consigner_name: String(origin.name ?? payload.consignor ?? "PSS Logistics"),
    consigner_phone: String(origin.phone ?? payload.consignor_phone ?? ""),
    consigner_pincode: String(origin.pincode ?? origin.pin_code ?? payload.origin_pincode ?? ""),
    consigner_city: String(origin.city ?? ""),
    consigner_state: String(origin.state ?? ""),
    consigner_address: String(origin.line ?? origin.address_line1 ?? origin.address ?? payload.origin ?? ""),
    consignee_name: String(destination.name ?? payload.consignee ?? "Consignee"),
    consignee_phone: String(destination.phone ?? payload.consignee_phone ?? ""),
    consignee_pincode: String(destination.pincode ?? destination.pin_code ?? payload.destination_pincode ?? ""),
    consignee_city: String(destination.city ?? ""),
    consignee_state: String(destination.state ?? ""),
    consignee_address: String(destination.line ?? destination.address_line1 ?? destination.address ?? payload.destination ?? ""),
    products: [{ product_name: String(payload.description ?? "Shipment").slice(0, 40), product_qty: String(pieces), product_price: String(declaredValue) }],
    invoice: [{ invoice_number: String(payload.invoice_number ?? `PSS-${payload.shipment_id ?? "SHIPMENT"}`).slice(0, 40), invoice_date: date }],
    weight: String(Math.max(1, Math.round(Number(payload.total_weight_kg ?? payload.weight ?? 0) * 1000))),
    length: String(Number(dimensions.length ?? payload.length ?? 1)),
    breadth: String(Number(dimensions.width ?? dimensions.breadth ?? payload.breadth ?? 1)),
    height: String(Number(dimensions.height ?? payload.height ?? 1)),
    courier_id: String(payload.xpressbees_courier_id ?? payload.courier_id ?? "01"),
    pickup_location: String(payload.pickup_location ?? "franchise"),
    shipping_charges: String(Number(payload.shipping_charges ?? 0)),
    cod_charges: String(paymentMethod === "COD" ? Number(payload.cod_charges ?? 0) : 0),
    discount: String(Number(payload.discount ?? 0)),
    order_amount: String(declaredValue),
  };
}

type RivigoCredentials = { appUuid: string; appSecret: string; clientCode?: string };

function rivigoCredentials(env: Env, credential?: string) {
  const raw = credential ?? env.RIVIGO_CREDENTIALS_JSON;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const appUuid = String(parsed.appUuid ?? parsed.app_uuid ?? parsed.uuid ?? "").trim();
    const appSecret = String(parsed.appSecret ?? parsed.app_secret ?? parsed.secret ?? "").trim();
    const clientCode = String(parsed.clientCode ?? parsed.client_code ?? "").trim();
    return appUuid && appSecret ? { appUuid, appSecret, ...(clientCode ? { clientCode } : {}) } : null;
  } catch { return null; }
}

function rivigoAddress(value: unknown, fallbackName: string) {
  const address = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const line = String(address.line ?? address.address_line1 ?? address.address ?? "").trim();
  const city = String(address.city ?? "").trim();
  const pincode = String(address.pincode ?? address.pin ?? "").trim();
  const name = String(address.name ?? fallbackName).trim();
  const phone = String(address.phone ?? address.primary_contact_number ?? "").replace(/\D/g, "").slice(-10);
  const email = String(address.email ?? "").trim();
  if (!line || !city || !/^\d{6}$/.test(pincode) || !name || !/^\d{10}$/.test(phone)) return null;
  return { addressDetails: { detailedAddress: line, city, pincode }, callDetails: { name, phone, ...(email ? { email } : {}) } };
}

function rivigoBookingPayload(payload: Record<string, unknown>, credentials: RivigoCredentials) {
  const origin = rivigoAddress(payload.origin_address, String(payload.origin ?? "PSS Logistics"));
  const destination = rivigoAddress(payload.destination_address, String(payload.consignee ?? "Consignee"));
  const weight = Number(payload.total_weight_kg ?? payload.weight ?? 0);
  const boxes = Math.max(1, Number(payload.pieces ?? payload.boxes ?? 1));
  const invoiceNo = String(payload.invoice_reference ?? payload.invoice_number ?? payload.order_id ?? payload.shipment_id ?? "PSS").trim();
  const invoiceValue = Math.max(0, Number(payload.declared_value ?? payload.invoice_value ?? 0));
  if (!origin || !destination || !Number.isFinite(weight) || weight <= 0 || !Number.isInteger(boxes) || boxes < 1) return null;
  const dimensions = ["length", "width", "height"].map((key) => Number(payload[key] ?? 0));
  const hasDimensions = dimensions.every((value) => Number.isFinite(value) && value > 0);
  const loadDetails: Record<string, unknown> = {
    totalBoxes: boxes,
    weight,
    paymentMode: String(payload.payment_mode ?? "prepaid").toLowerCase() === "to_pay" ? "TO_PAY" : "PAID",
    contents: String(payload.description ?? "Shipment"),
    invoicesList: [{ invoiceNo, invoiceValue }],
  };
  if (hasDimensions) loadDetails.boxTypesList = [{ length: dimensions[0], breadth: dimensions[1], height: dimensions[2], boxTypeCount: boxes }];
  return {
    scheduledBookingDateTime: typeof payload.scheduled_booking_datetime === "number" ? payload.scheduled_booking_datetime : Date.now(),
    fromAddress: { ...origin, companyDetails: { companyName: String(payload.origin_company ?? origin.callDetails.name), ...(payload.origin_gstin ? { GSTIN: String(payload.origin_gstin) } : {}) } },
    individualBookingList: [{
      ...(payload.cnote ? { cnote: String(payload.cnote) } : {}),
      toAddressList: [{ ...destination, companyDetails: { companyName: String(payload.destination_company ?? destination.callDetails.name), ...(payload.destination_gstin ? { GSTIN: String(payload.destination_gstin) } : {}) } }],
      loadDetails,
      ...(payload.order_id || payload.invoice_reference || payload.invoice_number ? { clientReferenceNumbers: [String(payload.order_id ?? payload.invoice_reference ?? payload.invoice_number)] } : {}),
    }],
    ...(credentials.clientCode ? { clientCode: credentials.clientCode } : payload.client_code ? { clientCode: String(payload.client_code) } : {}),
  };
}

async function rivigoAccessToken(env: Env, credentials: RivigoCredentials, requestIdValue: string, timeoutMs: number) {
  const authUrl = String(env.RIVIGO_AUTH_URL ?? `${env.RIVIGO_API_BASE_URL?.replace(/\/$/, "") ?? "https://client-integration-api.rivigo.com"}/oauth/token`).trim();
  const basic = btoa(`${credentials.appUuid}:${credentials.appSecret}`);
  const response = await providerFetch(authUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Basic ${basic}`, "x-request-id": requestIdValue }, body: "{}" }, timeoutMs);
  const text = await providerResponseText(response, timeoutMs);
  if (!response.ok) return null;
  let body: unknown = null; try { body = JSON.parse(text); } catch { return null; }
  return findProviderReference(body, new Set(["access_token", "accesstoken", "token", "jwt"])) ?? null;
}

async function providerFetch(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("provider_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function providerResponseText(response: Response, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("provider_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([response.text(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function providerBytesToBase64(bytes: Uint8Array) {
  let value = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    value += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(value);
}

async function providerResponseBytes(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("provider_response_too_large");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("provider_response_too_large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("provider_response_too_large");
        throw new Error("provider_response_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function providerBooleanFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["y", "yes", "true", "1", "oda"].includes(normalized)) return true;
  if (["n", "no", "false", "0", "non-oda", "non_oda"].includes(normalized)) return false;
  return null;
}

function providerOdaFlag(value: Record<string, unknown> | null | undefined): boolean | null {
  if (!value) return null;
  for (const key of ["is_oda", "oda", "oda_available", "oda_flag", "isODA", "odaApplicable", "oda_applicable"]) {
    const parsed = providerBooleanFlag(value[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function providerPaymentFlags(value: Record<string, unknown> | null | undefined) {
  const flags: { prepaid: boolean | null; cod: boolean | null } = { prepaid: null, cod: null };
  const positive: { prepaid: boolean; cod: boolean } = { prepaid: false, cod: false };
  const authoritativePaymentTypes: unknown[] = [];
  if (!value) return flags;
  const visit = (candidate: unknown, depth = 0) => {
    // B2B responses nest payment_type under data -> serviceability rows.
    // Keep recursion bounded, but reach the documented row-level value.
    if (depth > 5 || candidate == null) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (typeof candidate !== "object") {
      const tokens = String(candidate).toLowerCase().replace(/[\[\]{}\"]+/g, "").split(/[,|;/]+/).map((item) => item.trim().replace(/[-_ ]/g, "")).filter(Boolean);
      if (tokens.some((token) => token === "prepaid" || token === "prepaidallowed" || token === "prepaidserviceable")) { flags.prepaid = true; positive.prepaid = true; }
      if (tokens.some((token) => ["cod", "cash", "cashondelivery", "codallowed", "codserviceable"].includes(token))) { flags.cod = true; positive.cod = true; }
      return;
    }
    const record = candidate as Record<string, unknown>;
    for (const [key, raw] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().replace(/[-_ ]/g, "");
      const parsed = providerBooleanFlag(raw);
      if (parsed !== null) {
        if (["prepaid", "prepaidallowed", "prepaidserviceable", "prepaidavailable", "prepaidenabled", "prepaidflag"].includes(normalizedKey)) {
          if (parsed || !positive.prepaid) flags.prepaid = parsed;
          if (parsed) positive.prepaid = true;
        }
        if (["cod", "cash", "cashondelivery", "codallowed", "codserviceable", "codavailable", "codenabled", "codflag"].includes(normalizedKey)) {
          if (parsed || !positive.cod) flags.cod = parsed;
          if (parsed) positive.cod = true;
        }
      }
      if (["paymenttype", "paymenttypes", "paymentmode", "paymentmodes", "paymentmethod", "paymentmethods"].includes(normalizedKey)) authoritativePaymentTypes.push(raw);
      if (raw && typeof raw === "object") visit(raw, depth + 1);
      else if (["paymenttype", "paymenttypes", "paymentmode", "paymentmodes", "paymentmethod", "paymentmethods"].includes(normalizedKey)) visit(raw, depth + 1);
    }
  };
  visit(value);
  if (authoritativePaymentTypes.length) {
    const tokens = authoritativePaymentTypes.flatMap((entry) => String(entry).toLowerCase().replace(/[\[\]{}\"]+/g, "").split(/[,|;/]+/)).map((item) => item.trim().replace(/[-_ ]/g, "")).filter(Boolean);
    flags.prepaid = tokens.some((token) => token === "prepaid" || token === "prepaidallowed" || token === "prepaidserviceable");
    flags.cod = tokens.some((token) => ["cod", "cash", "cashondelivery", "codallowed", "codserviceable"].includes(token));
  }
  return flags;
}

async function providerRequest(env: Env, provider: CourierProvider, operation: string, payload: Record<string, unknown>, requestIdValue: string, clientId?: string, idempotencyKey?: string, timeoutMsOverride?: number) {
  if (String(env.ENABLE_PROVIDER_CALLS) !== "true") return { enabled: false, status: "disabled" as const };
  // B2B Delhivery tracks by LR number. Historical Fujiyama imports stored the
  // same value in tracking_number, but new bookings can also have a provider
  // reference or master AWB. Prefer the explicit LR whenever one is present.
  const trackingNumber = String(payload.lr_number ?? payload.tracking_number ?? payload.provider_reference ?? "").trim();
  if (["tracking", "freight_charges", "labels", "lr_copy", "document"].includes(operation) && !trackingNumber) return { enabled: false, status: "invalid_request" as const, reason: "A provider tracking reference is required" };
  if (provider === "delhivery" && operation === "shipments" && String(env.DELHIVERY_ENABLE_SHIPMENT_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Delhivery shipment creation is safety-disabled until live billing approval" };
  if (provider === "delhivery" && operation === "pickups" && String(env.DELHIVERY_ENABLE_PICKUP_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Delhivery pickup creation is safety-disabled until live operations approval" };
  if (provider === "delhivery" && !new Set(["tracking", "freight_charges", "shipment_status", "shipments", "warehouse_prepare", "pickups", "pickup_status", "pickup_slots", "serviceability", "serviceability_route", "labels", "lr_copy", "document"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "Delhivery operation is not supported" };
  if (provider === "ekart" && operation === "pickups") return { enabled: false, status: "unsupported" as const, reason: "Ekart pickup contract is not verified" };
  if (provider === "ekart" && String(env.EKART_ENABLE_PROVIDER_CALLS) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Ekart is configured but disabled until the agreed provider scope is approved" };
  if (provider === "ekart" && operation !== "tracking" && operation !== "shipments") return { enabled: false, status: "unsupported" as const, reason: "Ekart operation is not supported" };
  if (provider === "trackon" && operation === "shipments" && String(env.TRACKON_ENABLE_SHIPMENT_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Trackon shipment creation is safety-disabled until live billing approval" };
  if (provider === "trackon" && operation === "pickups") return { enabled: false, status: "unsupported" as const, reason: "Trackon pickup contract is not verified; use the provider portal until Trackon confirms the endpoint" };
  if (provider === "trackon" && !new Set(["tracking", "shipments", "labels"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "Trackon operation is not supported" };
  if (provider === "xpressbees" && operation === "shipments" && String(env.XPRESSBEES_ENABLE_SHIPMENT_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "XpressBees shipment creation is safety-disabled until live billing approval" };
  if (provider === "xpressbees" && operation === "pickups" && String(env.XPRESSBEES_ENABLE_PICKUP_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "XpressBees pickup creation is safety-disabled until live operations approval" };
  if (provider === "xpressbees" && operation === "serviceability" && !env.XPRESSBEES_SERVICEABILITY_URL) return { enabled: false, status: "not_configured" as const, reason: "XpressBees serviceability endpoint is not configured" };
  if (provider === "xpressbees" && !new Set(["tracking", "shipments", "pickups", "quotes", "serviceability"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "XpressBees operation is not enabled" };
  if (provider === "rivigo" && String((env as unknown as Record<string, unknown>).RIVIGO_ENABLE_PROVIDER_CALLS) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Rivigo provider calls are disabled until the developer-portal app and go-live approval are verified" };
  if (provider === "rivigo" && !new Set(["tracking", "shipments", "serviceability", "updates", "cancellations"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "Rivigo operation is not supported" };
  const requestedAccountId = providerAccountId(payload);
  // Delhivery has multiple registered account names. Never fall back to the
  // first row in creation order: that can route a shipment through the wrong
  // billing/account configuration. The panel's explicit account id wins; if
  // it is omitted, only the configured safe default account is eligible.
  const defaultDelhiveryAccountName = String((env as unknown as Record<string, unknown>).DELHIVERY_DEFAULT_ACCOUNT_NAME ?? "").trim();
  const accountConstraint = provider === "delhivery"
    ? requestedAccountId ? "AND pa.id = ?" : "AND pa.account_name = ?"
    : "AND (? IS NULL OR pa.id = ?)";
  const accountConstraintBinds = provider === "delhivery"
    ? [requestedAccountId ?? defaultDelhiveryAccountName]
    : [requestedAccountId, requestedAccountId];
  const account = clientId
    ? await env.DB.prepare(`
        SELECT pa.id, pa.provider, pa.account_name, pa.credential_secret_name,
               COALESCE(p.enabled, 1) AS client_enabled,
               COALESCE(p.priority, 100) AS priority,
               COALESCE(p.confidence_score, 0) AS confidence_score,
               p.rate_card_id
        FROM provider_accounts pa
        LEFT JOIN provider_account_client_policies p
          ON p.provider_account_id = pa.id AND p.client_id = ?
        WHERE pa.provider = ? AND pa.status = 'active'
          AND (pa.client_id = ? OR pa.client_id IS NULL)
          ${accountConstraint}
          AND p.provider_account_id IS NOT NULL AND p.enabled = 1
        ORDER BY CASE WHEN p.provider_account_id IS NOT NULL THEN 0 ELSE 1 END,
                 COALESCE(p.priority, 100) ASC,
                 COALESCE(p.confidence_score, 0) DESC,
                 pa.created_at ASC
         LIMIT 1`).bind(clientId, provider, clientId, ...accountConstraintBinds).first<{
          id: string; provider: CourierProvider; account_name: string; credential_secret_name: string;
          client_enabled: number; priority: number; confidence_score: number; rate_card_id: string | null;
        }>()
    : await env.DB.prepare(`
        SELECT pa.id, pa.provider, pa.account_name, pa.credential_secret_name,
               1 AS client_enabled,
               100 AS priority,
               0 AS confidence_score,
               NULL AS rate_card_id
        FROM provider_accounts pa
        WHERE pa.provider = ? AND pa.status = 'active' AND pa.client_id IS NULL
          ${accountConstraint}
        ORDER BY pa.created_at ASC
        LIMIT 1`).bind(provider, ...accountConstraintBinds).first<{
          id: string; provider: CourierProvider; account_name: string; credential_secret_name: string;
          client_enabled: number; priority: number; confidence_score: number; rate_card_id: string | null;
        }>();
  const resolvedDelhiveryB2b = provider === "delhivery" && Boolean(account && delhiveryAccountIsB2b(account.account_name));
  const defaultAccountIsB2b = provider === "delhivery" && delhiveryAccountIsB2b(defaultDelhiveryAccountName);
  const useDelhiveryB2b = resolvedDelhiveryB2b || defaultAccountIsB2b;
  const base = provider === "delhivery"
    ? useDelhiveryB2b ? String(env.DELHIVERY_B2B_API_BASE_URL ?? "https://ltl-clients-api.delhivery.com") : env.DELHIVERY_API_BASE_URL
    : provider === "ekart" ? env.EKART_API_BASE_URL : provider === "trackon" ? env.TRACKON_API_BASE_URL : provider === "xpressbees" ? env.XPRESSBEES_API_BASE_URL : env.RIVIGO_API_BASE_URL;
  if (clientId && requestedAccountId && !account) return { enabled: false, status: "disabled" as const, reason: "The selected courier account is not enabled for this client" };
  if (provider === "delhivery" && !account) return { enabled: false, status: "not_configured" as const, reason: defaultDelhiveryAccountName ? `The configured Delhivery account '${defaultDelhiveryAccountName}' is not active` : "A Delhivery account must be selected before booking" };
  const secretBag = env as unknown as Record<string, unknown>;
  const configuredCredential = provider === "delhivery" ? env.DELHIVERY_API_TOKEN : provider === "ekart" ? env.EKART_API_KEY : provider === "xpressbees" ? env.XPRESSBEES_CREDENTIALS_JSON : provider === "rivigo" ? env.RIVIGO_CREDENTIALS_JSON : undefined;
  const credential = account ? (typeof secretBag[account.credential_secret_name] === "string" ? String(secretBag[account.credential_secret_name]) : undefined) : configuredCredential;
  const parsedDelhiveryCredential = provider === "delhivery" ? delhiveryB2bCredential(credential) : null;
  const trackon = provider === "trackon" ? trackonCredentials(env, credential) : null;
  const rivigo = provider === "rivigo" ? rivigoCredentials(env, credential) : null;
  if (!base || (provider === "trackon" ? !trackon : provider === "rivigo" ? !rivigo : !credential)) return { enabled: false, status: "not_configured" as const };
  const providerTimeoutMs = Math.min(timeoutMsOverride ?? (provider === "delhivery" && operation === "shipments" ? 30000 : 10000), provider === "delhivery" && operation === "shipments" ? 30000 : 10000);
  const delhiveryB2bAccountName = account?.account_name ?? defaultDelhiveryAccountName;
    const delhiveryLabelAuthBase = provider === "delhivery" && operation === "labels" ? delhiveryLabelApiBase() : undefined;
  let delhiveryB2bToken = useDelhiveryB2b ? await delhiveryB2bBearer(env, credential, delhiveryB2bAccountName, requestIdValue, providerTimeoutMs, false, delhiveryLabelAuthBase) : null;
  if (provider === "delhivery" && useDelhiveryB2b && !delhiveryB2bToken) return { enabled: true, status: "failed" as const, error: "Delhivery B2B authentication failed" };
  let delhiveryPickupLocation = "";
  let delhiveryCanonicalOrigin: Record<string, unknown> | null = null;
  if (provider === "delhivery" && ["shipments", "warehouse_prepare"].includes(operation) && useDelhiveryB2b && clientId && delhiveryB2bToken) {
    const origin = delhiveryAddress(payload.origin_address, String(payload.origin ?? "PSS Logistics"));
    if (!origin) return { enabled: true, status: "invalid_request" as const, reason: "A complete consignor address is required to create or select the pickup warehouse" };
    const selectedWarehouseId = typeof payload.warehouse_id === "string" && payload.warehouse_id.trim() ? payload.warehouse_id.trim() : null;
    const warehouseApiToken = delhiveryWarehouseApiToken(env, delhiveryB2bAccountName, parsedDelhiveryCredential);
    let warehouse = await ensureDelhiveryWarehouse(env, clientId, delhiveryB2bToken, origin, requestIdValue, providerTimeoutMs, base, account?.id ?? requestedAccountId, selectedWarehouseId, warehouseApiToken);
    if (!warehouse.ok && /\b401\b|invalid token|unauthorized|token decode|not enough segments/i.test(warehouse.error)) {
      const refreshedToken = await delhiveryB2bBearer(env, credential, delhiveryB2bAccountName, requestIdValue, providerTimeoutMs, true, delhiveryLabelAuthBase);
      if (refreshedToken) {
        delhiveryB2bToken = refreshedToken;
        warehouse = await ensureDelhiveryWarehouse(env, clientId, delhiveryB2bToken, origin, requestIdValue, providerTimeoutMs, base, account?.id ?? requestedAccountId, selectedWarehouseId, warehouseApiToken);
      }
    }
    if (!warehouse.ok) return { enabled: true, status: "failed" as const, code: warehouse.code, error: warehouse.error };
    delhiveryPickupLocation = warehouse.name;
    delhiveryCanonicalOrigin = warehouse.origin;
    if (operation === "warehouse_prepare") return { enabled: true, status: "accepted" as const, providerStatus: 200, providerPending: false, warehouseName: delhiveryPickupLocation, warehouseId: selectedWarehouseId };
  }
  const xpressToken = provider === "xpressbees" ? await xpressbeesToken(env, credential!, requestIdValue, providerTimeoutMs) : null;
  if (provider === "xpressbees" && !xpressToken) return { enabled: true, status: "failed" as const, error: "XpressBees authentication failed" };
  const rivigoToken = provider === "rivigo" ? await rivigoAccessToken(env, rivigo!, requestIdValue, providerTimeoutMs) : null;
  if (provider === "rivigo" && !rivigoToken) return { enabled: true, status: "failed" as const, error: "Rivigo authentication failed" };
  const authorization = provider === "delhivery"
    ? useDelhiveryB2b ? `Bearer ${delhiveryB2bToken}` : `Token ${credential}`
    : provider === "ekart"
      ? credential!.trim().startsWith("Basic ") ? credential!.trim() : `Basic ${credential!.trim()}`
      : undefined;
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": requestIdValue };
  if (authorization) headers.Authorization = authorization;
  if (provider === "trackon") headers["x-trackon-app-key"] = trackon!.appKey;
  if (provider === "xpressbees") headers.Authorization = `Bearer ${xpressToken}`;
  if (provider === "rivigo") { headers.Authorization = `Bearer ${rivigoToken}`; headers.appUuid = rivigo!.appUuid; }
  const ekartCreate = provider === "ekart" && operation === "shipments" ? ekartCreatePayload(payload) : null;
  if (provider === "ekart" && operation === "shipments" && !ekartCreate) return { enabled: false, status: "invalid_request" as const, reason: "Origin and destination addresses require valid six-digit pincodes and ten-digit phone numbers" };
  let providerPayload: Record<string, unknown> = account?.provider === "delhivery" ? { ...payload, delhivery_client_name: account.account_name } : payload;
  if (delhiveryPickupLocation) providerPayload = { ...providerPayload, delhivery_pickup_location: delhiveryPickupLocation, ...(delhiveryCanonicalOrigin ? { origin_address: delhiveryCanonicalOrigin } : {}) };
  if (provider === "delhivery" && operation === "pickups" && useDelhiveryB2b && clientId && delhiveryB2bToken) {
    const shipmentOrigin = typeof payload.shipment_id === "string"
      ? await env.DB.prepare("SELECT origin_address_json FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(payload.shipment_id, clientId).first<{ origin_address_json: string | null }>()
      : null;
    let origin: ReturnType<typeof delhiveryAddress> = null;
    if (shipmentOrigin?.origin_address_json) {
      try { origin = delhiveryAddress(JSON.parse(shipmentOrigin.origin_address_json), "PSS Logistics"); } catch { origin = null; }
    }
    if (!origin && typeof payload.location === "string" && typeof payload.pincode === "string") {
      origin = delhiveryAddress({ name: payload.contact_name, line: payload.location, city: payload.city, state: payload.state, pincode: payload.pincode, phone: payload.contact_phone }, "PSS Logistics");
    }
    if (!origin) return { enabled: true, status: "invalid_request" as const, reason: "A complete pickup address is required before Delhivery can register the warehouse" };
    if (origin) {
      const selectedWarehouseId = typeof payload.warehouse_id === "string" && payload.warehouse_id.trim() ? payload.warehouse_id.trim() : null;
      const warehouseApiToken = delhiveryWarehouseApiToken(env, delhiveryB2bAccountName, parsedDelhiveryCredential);
      let warehouse = await ensureDelhiveryWarehouse(env, clientId, delhiveryB2bToken, origin, requestIdValue, providerTimeoutMs, base, account?.id ?? requestedAccountId, selectedWarehouseId, warehouseApiToken);
      if (!warehouse.ok && /\b401\b|invalid token|unauthorized|token decode|not enough segments/i.test(warehouse.error)) {
        const refreshedToken = await delhiveryB2bBearer(env, credential, delhiveryB2bAccountName, requestIdValue, providerTimeoutMs, true, delhiveryLabelAuthBase);
      if (refreshedToken) {
        delhiveryB2bToken = refreshedToken;
        warehouse = await ensureDelhiveryWarehouse(env, clientId, delhiveryB2bToken, origin, requestIdValue, providerTimeoutMs, base, account?.id ?? requestedAccountId, selectedWarehouseId, warehouseApiToken);
      }
      }
      if (!warehouse.ok) return { enabled: true, status: "failed" as const, code: warehouse.code, error: warehouse.error };
      providerPayload = { ...providerPayload, origin_address: warehouse.origin, delhivery_pickup_location: warehouse.name };
    }
  }
  if (provider === "delhivery" && operation === "shipments" && clientId) {
    const preferenceRow = await env.DB.prepare("SELECT preferences_json FROM client_preferences WHERE client_id = ? LIMIT 1")
      .bind(clientId)
      .first<{ preferences_json: string }>();
    if (preferenceRow?.preferences_json) {
      try {
        const preferences = JSON.parse(preferenceRow.preferences_json) as { kyc?: { pan?: unknown; gstin?: unknown; gst_number?: unknown } };
        const storedGstin = String(preferences.kyc?.gstin ?? preferences.kyc?.gst_number ?? "").trim();
        const storedPan = String(preferences.kyc?.pan ?? "").trim();
        if (!String(providerPayload.client_gst_tin ?? providerPayload.seller_gst_tin ?? "").trim() && storedGstin) providerPayload.client_gst_tin = storedGstin;
        if (!String(providerPayload.client_pan ?? providerPayload.client_pan_number ?? providerPayload.pan_number ?? "").trim() && storedPan) providerPayload.client_pan = storedPan;
      } catch {
        // Ignore malformed optional preferences; the provider payload validation will report a missing KYC value.
      }
    }
  }
  let delhiveryFacility: DelhiveryFacility | null = null;
  if (provider === "delhivery" && useDelhiveryB2b && clientId && delhiveryB2bToken && operation === "pickup_slots") {
    let facility = await resolveDelhiveryFacility(env, delhiveryB2bToken, base, clientId, providerPayload, requestIdValue, providerTimeoutMs);
    if (!facility.ok && /\b401\b|invalid token|unauthorized|token decode|not enough segments/i.test(facility.error)) {
      const refreshedToken = await delhiveryB2bBearer(env, credential, delhiveryB2bAccountName, requestIdValue, providerTimeoutMs, true);
      if (refreshedToken) {
        delhiveryB2bToken = refreshedToken;
        facility = await resolveDelhiveryFacility(env, delhiveryB2bToken, base, clientId, providerPayload, requestIdValue, providerTimeoutMs);
      }
    }
    if (!facility.ok) return { enabled: true, status: "failed" as const, error: facility.error };
    delhiveryFacility = facility.facility;
    providerPayload = { ...providerPayload, provider_facility_id: delhiveryFacility.id, provider_facility_code: delhiveryFacility.code };
  }
  const delhiveryCreate = provider === "delhivery" && operation === "shipments" ? useDelhiveryB2b ? delhiveryB2bManifestPayload(env, providerPayload) : delhiveryCreatePayload(env, providerPayload) : null;
  if (provider === "delhivery" && operation === "shipments" && !delhiveryCreate) return { enabled: false, status: "invalid_request" as const, reason: "Delhivery requires valid origin/destination addresses, a registered client name, and a pickup location" };
  const delhiveryPickup = provider === "delhivery" && operation === "pickups" ? delhiveryPickupPayload(env, providerPayload, useDelhiveryB2b) : null;
  if (provider === "delhivery" && operation === "pickups" && !delhiveryPickup) return { enabled: false, status: "invalid_request" as const, reason: "Delhivery requires a valid pickup date and registered pickup location" };
  const rivigoCreate = provider === "rivigo" && operation === "shipments" ? rivigoBookingPayload(payload, rivigo!) : null;
  if (provider === "rivigo" && operation === "shipments" && !rivigoCreate) return { enabled: false, status: "invalid_request" as const, reason: "Rivigo requires valid origin/destination addresses, positive weight, and at least one box" };
  // Scheduled provider reconciliation is high-volume and mostly unchanged.
  // Keep shipment outcomes, meaningful tracking events, and interactive
  // requests in D1, but do not spend a D1 write for every cron poll. This is
  // especially important on the Cloudflare free tier, where repeated audit
  // rows can exhaust the daily write allowance and block real bookings.
  const cronReadOperations = new Set(["tracking", "document", "shipment_status", "serviceability", "serviceability_route", "pickup_status", "pickup_slots", "freight_charges"]);
  const persistIntegration = !(requestIdValue.startsWith("cron:") && cronReadOperations.has(operation));
  const integrationId = crypto.randomUUID();
  if (persistIntegration) await env.DB.prepare("INSERT INTO integration_requests (id, provider, client_id, operation, idempotency_key, provider_request_id, status, attempt_count) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)").bind(integrationId, provider, clientId ?? null, operation, idempotencyKey ?? null, requestIdValue).run();
  const delhiveryOrigin = provider === "delhivery" ? new URL(base).origin : "";
  const delhiveryAlternateB2bBase = provider === "delhivery" && useDelhiveryB2b
    ? (String(base).replace(/\/$/, "") === "https://btob.api.delhivery.com" ? "https://ltl-clients-api.delhivery.com" : "https://btob.api.delhivery.com")
    : "";
  const labelVariant = String(payload.label_api_variant ?? "");
  // Delhivery's published B2B OpenAPI contract is served from btob.api. The
  // ltl-clients host is retained for the existing manifest/tracking flows, but
  // label generation must use the documented production server.
  const delhiveryLabelBase = provider === "delhivery" && operation === "labels"
    ? labelVariant.endsWith("_alt") ? delhiveryAlternateB2bBase : delhiveryB2bDocsBase()
    : base;
  const trackonUrl = provider === "trackon" ? operation === "tracking" ? env.TRACKON_TRACKING_URL : operation === "shipments" ? env.TRACKON_BOOKING_URL : env.TRACKON_LABEL_URL : undefined;
  if (provider === "trackon" && !trackonUrl) return { enabled: false, status: "not_configured" as const, reason: `Trackon ${operation} endpoint is not configured` };
  const url = provider === "delhivery" && operation === "pickup_status"
    ? `https://one.delhivery.com/web/api/forward_orders/shipments/${encodeURIComponent(String(payload.pickup_id ?? ""))}/get_pickup_request`
    : provider === "trackon" && operation === "tracking"
    ? trackonTrackingUrl(trackonUrl!, trackingNumber, trackon!)
    : provider === "trackon" && operation === "labels"
      ? trackonLabelUrl(trackonUrl!, trackingNumber, trackon!)
      : provider === "delhivery" && operation === "labels"
        ? labelVariant === "ucp"
          ? "https://ucp-egw.delhivery.com/101/api/v1/doc/label/print"
          : (labelVariant === "pdf" || labelVariant === "pdf_alt" || labelVariant === "pdf_form" || labelVariant === "pdf_form_alt")
          ? `${String(delhiveryLabelBase).replace(/\/$/, "")}/docket/generate_label_pdf`
          : labelVariant === "legacy" || labelVariant === "legacy_alt"
            ? `${String(delhiveryLabelBase).replace(/\/$/, "")}/label/get_urls/${encodeURIComponent(delhiveryLabelApiSize(String(payload.label_size ?? "std")))}/${encodeURIComponent(trackingNumber)}`
            : `${delhiveryLabelApiBase()}/label/get_urls/${encodeURIComponent(delhiveryLabelApiSize(String(payload.label_size ?? "std")))}/${encodeURIComponent(trackingNumber)}`
      : provider === "delhivery" && operation === "lr_copy"
        ? `${base.replace(/\/$/, "")}/lr_copy/print/${encodeURIComponent(trackingNumber)}?lr_copy_type=${encodeURIComponent(String(payload.lr_copy_type ?? "SHIPPER COPY"))}`
      : provider === "delhivery" && operation === "document"
        ? `${base.replace(/\/$/, "")}/document/download?lrn=${encodeURIComponent(trackingNumber)}${payload.doc_type ? `&doc_type=${encodeURIComponent(String(payload.doc_type))}` : ""}&auto_download=true&version=latest`
      : provider === "delhivery" && operation === "freight_charges"
        ? `${base.replace(/\/$/, "")}/lrn/freight-breakup?lrns=${encodeURIComponent(trackingNumber)}`
      : provider === "delhivery" && operation === "shipment_status"
        ? `${(useDelhiveryB2b ? delhiveryB2bDocsBase() : base).replace(/\/$/, "")}/${useDelhiveryB2b ? "v2/manifest" : "manifest"}?job_id=${encodeURIComponent(String(payload.provider_booking_id ?? ""))}`
      : provider === "delhivery" && operation === "tracking"
        ? useDelhiveryB2b
        ? `${base.replace(/\/$/, "")}/v2/track/${encodeURIComponent(delhiveryB2bNumber(trackingNumber) ?? String(payload.shipment_id ?? trackingNumber))}`
          : `${base.replace(/\/$/, "")}/packages/json/?waybill=${encodeURIComponent(trackingNumber)}&ref_ids=${encodeURIComponent(String(payload.order_id ?? ""))}`
    : provider === "delhivery" && operation === "shipments"
      ? useDelhiveryB2b ? `${delhiveryB2bDocsBase()}/v2/manifest` : `${delhiveryOrigin}/api/cmu/create.json`
       : provider === "delhivery" && operation === "pickups"
         ? useDelhiveryB2b ? `${base.replace(/\/$/, "")}/pickup_requests/` : "https://track.delhivery.com/fm/request/new/"
       : provider === "delhivery" && operation === "pickup_slots"
         ? `${base.replace(/\/$/, "")}/web/api/forward_orders/pickup_slots/${encodeURIComponent(String(delhiveryFacility?.code ?? ""))}?facility_id=${encodeURIComponent(String(delhiveryFacility?.id ?? ""))}`
        : provider === "delhivery" && operation === "serviceability_route"
          ? `${base.replace(/\/$/, "")}/tat/estimate?origin_pin=${encodeURIComponent(String(payload.origin_pincode ?? ""))}&destination_pin=${encodeURIComponent(String(payload.destination_pincode ?? ""))}`
        : provider === "delhivery" && operation === "serviceability"
          ? `${base.replace(/\/$/, "")}/pincode-service/${encodeURIComponent(String(payload.destination_pincode ?? ""))}?weight=${encodeURIComponent(String(Math.max(1, Number(payload.weight_kg ?? payload.weight ?? 0) || 0)))}`
    : provider === "ekart"
      ? `${base.replace(/\/$/, "")}/v2/shipments/${operation === "shipments" ? "create" : "track"}`
      : provider === "xpressbees" && operation === "tracking"
        ? xpressbeesTrackingUrl(base)
      : provider === "xpressbees" && operation === "serviceability"
        ? env.XPRESSBEES_SERVICEABILITY_URL!
      : provider === "xpressbees" && operation === "quotes"
        ? `${base.replace(/\/$/, "")}/franchise/shipments/calculate_pricing`
      : provider === "xpressbees" && operation === "shipments"
        ? `${base.replace(/\/$/, "")}/franchise/shipments`
      : provider === "xpressbees" && operation === "pickups"
        ? `${base.replace(/\/$/, "")}/franchise/shipments/pickup`
      : provider === "rivigo" && operation === "tracking"
        ? `${base.replace(/\/$/, "")}/operations/tracking`
      : provider === "rivigo" && operation === "shipments"
        ? `${base.replace(/\/$/, "")}/operations/booking`
      : provider === "rivigo" && operation === "serviceability"
        ? `${base.replace(/\/$/, "")}/operations/serviceable/pincode?fromPinCode=${encodeURIComponent(String(payload.origin_pincode ?? payload.from_pincode ?? ""))}&toPinCode=${encodeURIComponent(String(payload.destination_pincode ?? payload.to_pincode ?? ""))}`
      : provider === "rivigo" && operation === "updates"
        ? `${base.replace(/\/$/, "")}/operations/booking`
      : provider === "rivigo" && operation === "cancellations"
        ? `${base.replace(/\/$/, "")}/operations/booking/cancel?bookingId=${encodeURIComponent(String(payload.booking_id ?? payload.provider_reference ?? ""))}`
      : trackonUrl!;
  const labelCallbackToken = provider === "delhivery" && operation === "labels" && (payload.label_api_variant === "pdf" || payload.label_api_variant === "pdf_alt") && typeof payload.shipment_id === "string"
    ? crypto.randomUUID()
    : null;
  if (labelCallbackToken && typeof payload.shipment_id === "string" && clientId) {
    await env.DB.prepare("INSERT INTO delhivery_label_callback_tokens (token, shipment_id, client_id, label_size, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+30 minutes'))")
      .bind(labelCallbackToken, payload.shipment_id, clientId, String(payload.label_size ?? "a4")).run();
  }
  const requestBody = provider === "delhivery" && operation === "shipments"
    ? useDelhiveryB2b ? JSON.stringify(delhiveryCreate) : `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryCreate))}`
     : provider === "delhivery" && operation === "pickups"
       ? JSON.stringify(delhiveryPickup)
      : provider === "ekart" && operation === "shipments"
        ? JSON.stringify(ekartCreate)
      : provider === "ekart" ? JSON.stringify({ tracking_id: trackingNumber })
        : provider === "xpressbees" && operation === "tracking" ? xpressbeesTrackingBody(trackingNumber)
        : provider === "xpressbees" && operation === "serviceability" ? xpressbeesServiceabilityBody(payload)
        : provider === "xpressbees" && operation === "quotes" ? JSON.stringify({ order_type_user: "B2C", origin: String(payload.origin_pincode ?? payload.origin ?? ""), destination: String(payload.destination_pincode ?? payload.destination ?? ""), weight: Number(payload.weight ?? 0), length: Number(payload.length ?? 0), height: Number(payload.height ?? 0), breadth: Number(payload.breadth ?? payload.width ?? 0), cod_amount: Number(payload.cod_amount ?? 0), cod: Boolean(payload.cod) })
        : provider === "xpressbees" && operation === "shipments" ? JSON.stringify(xpressbeesBookingPayload(payload))
        : provider === "xpressbees" ? JSON.stringify(payload)
        : provider === "rivigo" && operation === "tracking" ? JSON.stringify({ entityList: [trackingNumber] })
        : provider === "rivigo" && operation === "shipments" ? JSON.stringify(rivigoCreate)
        : provider === "rivigo" && operation === "updates" ? JSON.stringify(payload)
        : provider === "rivigo" && operation === "cancellations" ? JSON.stringify(payload.cnotes_list ? { cnotesList: payload.cnotes_list } : {})
        : provider === "delhivery" && operation === "labels" && (payload.label_api_variant === "pdf" || payload.label_api_variant === "pdf_alt")
          ? JSON.stringify({
              lrn: trackingNumber,
              size: (() => {
              return delhiveryLabelApiSize(String(payload.label_size ?? "a4"));
              })(),
              callback: {
                // Label generation callbacks are separate from shipment-status
                // webhooks and are not sent with the status-webhook signature.
                uri: `https://pss-api.psslogisticsadmin.workers.dev/v1/webhooks/delhivery/labels?token=${encodeURIComponent(labelCallbackToken ?? "")}`,
                method: "POST",
                authorization: `Bearer ${labelCallbackToken ?? ""}`,
                // Delhivery's async label service expects the callback auth
                // to be forwarded as request headers as well. Keep the query
                // token as a compatibility fallback for older workers.
                headers: {
                  Authorization: `Bearer ${labelCallbackToken ?? ""}`,
                  "Content-Type": "application/json",
                },
              },
            })
        : provider === "delhivery" && operation === "labels" && payload.label_api_variant === "ucp"
          ? JSON.stringify({ doc_type: "shipping_label", size: delhiveryUcpLabelSize(String(payload.label_size ?? "a4")), lr_numbers: [trackingNumber] })
        : provider === "delhivery" && operation === "labels" && (payload.label_api_variant === "pdf_form" || payload.label_api_variant === "pdf_form_alt")
          ? `lrnum=${encodeURIComponent(trackingNumber)}&size=${encodeURIComponent(delhiveryLabelApiSize(String(payload.label_size ?? "a4")))}&label_size=${encodeURIComponent(String(payload.label_size ?? "a4"))}`
        : provider === "delhivery" && ["tracking", "freight_charges", "shipment_status", "serviceability", "serviceability_route", "pickup_status", "pickup_slots", "labels", "lr_copy", "document"].includes(operation) ? ""
        : operation === "tracking" ? JSON.stringify({ Appkey: trackon!.appKey, userId: trackon!.userId, password: trackon!.password, AWBNo: trackingNumber })
          : operation === "shipments" ? JSON.stringify(trackonPayload(payload, trackon!))
            : JSON.stringify({ Appkey: trackon!.appKey, userId: trackon!.userId, password: trackon!.password, AWBNo: trackingNumber });
  if (provider === "delhivery" && operation === "shipments" && !useDelhiveryB2b) headers["content-type"] = "application/x-www-form-urlencoded";
  if (provider === "delhivery" && operation === "shipments" && useDelhiveryB2b) headers["content-type"] = "application/json";
  let response: Response | null = null; let lastError = "provider_request_failed";
   const readOnlyProviderCall = operation === "tracking" || operation === "serviceability" || operation === "serviceability_route" || operation === "pickup_status" || operation === "pickup_slots";
  const singleManifestCall = provider === "delhivery" && operation === "shipments";
  const maxAttempts = singleManifestCall ? 1 : readOnlyProviderCall ? (provider === "delhivery" && useDelhiveryB2b ? 2 : 1) : 3;
  // Courier tracking/serviceability are read-only, but provider APIs can take
  // longer than a browser request under normal network load. Keep a bounded
  // timeout so public tracking does not hang indefinitely while avoiding false
  // failures from a five-second cutoff.
  const attemptTimeoutMs = providerTimeoutMs;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (persistIntegration) await env.DB.prepare("UPDATE integration_requests SET attempt_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(attempt + 1, integrationId).run();
    try {
      // XpressBees documents tracking as POST even though it is a read-only
      // lookup. Keep the generic GET behavior for Delhivery/Trackon tracking,
      // but send the XpressBees AWB body with POST to avoid provider HTTP 405.
       const isGet = (["tracking", "freight_charges", "shipment_status", "serviceability", "serviceability_route", "pickup_slots", "labels", "lr_copy", "document"].includes(operation) && provider !== "xpressbees" && provider !== "rivigo" && !(provider === "delhivery" && operation === "labels" && ["ucp", "pdf", "pdf_alt", "pdf_form", "pdf_form_alt"].includes(labelVariant))) || (provider === "trackon" && operation === "labels");
      const method = provider === "rivigo" && operation === "cancellations" ? "DELETE" : provider === "rivigo" && operation === "updates" ? "PUT" : isGet ? "GET" : "POST";
      if (provider === "delhivery" && operation === "labels" && (payload.label_api_variant === "pdf_form" || payload.label_api_variant === "pdf_form_alt")) headers["content-type"] = "application/x-www-form-urlencoded";
      if (provider === "delhivery" && operation === "labels" && payload.label_api_variant === "ucp") {
        headers["content-type"] = "application/json";
        headers["accept"] = "application/pdf";
        headers["X-Hq-Client-Id"] = "cms::client::4eb099bf-cada-11ed-889a-06153c838f22";
      }
      response = await providerFetch(url, { method, headers, body: isGet ? undefined : requestBody }, attemptTimeoutMs);
      if (!singleManifestCall && provider === "delhivery" && useDelhiveryB2b && response.status === 401 && attempt === 0 && credential) {
        const refreshedToken = await delhiveryB2bBearer(env, credential, delhiveryB2bAccountName, requestIdValue, providerTimeoutMs, true, delhiveryLabelAuthBase);
        if (refreshedToken) {
          headers.Authorization = `Bearer ${refreshedToken}`;
          continue;
        }
      }
      // Some XpressBees accounts expose the tracking route as GET even though
      // the franchise documentation describes the same route as POST. A 405
      // is safe to retry because tracking is read-only; keep shipment and
      // pickup operations on their configured methods.
      if (provider === "xpressbees" && operation === "tracking" && response.status === 405) {
        const fallbackUrl = new URL(url);
        fallbackUrl.searchParams.set("awb_number", trackingNumber);
        response = await providerFetch(fallbackUrl.toString(), { method: "GET", headers }, attemptTimeoutMs);
      }
      // Delhivery exposes the same B2B tracking contract through two hosts in
      // different account environments. Login already tries both hosts, but a
      // token may authenticate successfully while the configured host returns
      // `No Such Resource` for an otherwise valid LRN. Retry the read-only
      // tracking request against the alternate host before recording a failure.
      if (provider === "delhivery" && useDelhiveryB2b && operation === "tracking" && response.status === 404) {
        const configuredB2bBase = String(env.DELHIVERY_B2B_API_BASE_URL ?? "https://ltl-clients-api.delhivery.com").replace(/\/$/, "");
        const alternateB2bBase = configuredB2bBase === "https://btob.api.delhivery.com"
          ? "https://ltl-clients-api.delhivery.com"
          : "https://btob.api.delhivery.com";
        const alternateUrl = `${alternateB2bBase}/v2/track/${encodeURIComponent(delhiveryB2bNumber(trackingNumber) ?? String(payload.shipment_id ?? trackingNumber))}`;
        try {
          const alternateResponse = await providerFetch(alternateUrl, { method: "GET", headers }, attemptTimeoutMs);
          if (alternateResponse.ok || alternateResponse.status !== 404) response = alternateResponse;
        } catch { /* Keep the original provider response if the alternate host is unavailable. */ }
      }
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        if (!response.ok) {
          const allow = response.headers.get("allow")?.replace(/[^A-Za-z, ]/g, "").trim();
          lastError = `provider_http_${response.status}${allow ? `_allow_${allow.replace(/\s+/g, "_")}` : ""}`;
        }
        break;
      }
      lastError = `provider_http_${response.status}`;
    } catch (caught) { lastError = caught instanceof Error ? caught.name === "AbortError" ? "provider_timeout" : caught.message : "provider_request_failed"; }
    const retryAfter = response?.headers.get("retry-after");
    const retryDelay = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(Number(retryAfter) * 1000, 5000) : 200 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  if (!response) { if (persistIntegration) await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind("PROVIDER_REQUEST_FAILED", lastError, integrationId).run(); return { enabled: true, status: "failed" as const, providerStatus: 0, error: lastError }; }
  // Consume the provider response without forwarding its raw body to browser clients.
  // Provider payloads can contain customer data or contract-specific fields; only a
  // normalized tracking event is persisted and returned to the internal caller.
  let responseBody = "";
  let responseBytes: Uint8Array | null = null;
  let lrCopyResponses: Array<{ copyType: string; bytes: Uint8Array }> = [];
  try {
    if (provider === "delhivery" && ["labels", "lr_copy", "document"].includes(operation)) {
      responseBytes = await providerResponseBytes(response, 12 * 1024 * 1024);
      responseBody = new TextDecoder().decode(responseBytes);
      if (response.ok && operation === "lr_copy" && !payload.lr_copy_type) {
        for (const copyType of ["LM POD", "RECIPIENT COPY"]) {
          const copyUrl = `${base.replace(/\/$/, "")}/lr_copy/print/${encodeURIComponent(trackingNumber)}?lr_copy_type=${encodeURIComponent(copyType)}`;
          const copyResponse = await providerFetch(copyUrl, { method: "GET", headers }, attemptTimeoutMs);
          if (!copyResponse.ok) throw new Error(`provider_lr_copy_${copyType.toLowerCase().replaceAll(" ", "_")}_http_${copyResponse.status}`);
          lrCopyResponses.push({ copyType, bytes: await providerResponseBytes(copyResponse, 12 * 1024 * 1024) });
        }
      }
    } else {
      responseBody = await providerResponseText(response, attemptTimeoutMs);
    }
  } catch (caught) {
    const bodyError = caught instanceof Error ? caught.message : "provider_timeout";
    if (persistIntegration) await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = 'PROVIDER_REQUEST_FAILED', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(bodyError, integrationId).run();
    return { enabled: true, status: "failed" as const, providerStatus: response.status, error: bodyError };
  }
  const providerFailureDetail = !response.ok ? responseBody.replace(/\s+/g, " ").trim().slice(0, 300) : null;
  if (persistIntegration) await env.DB.prepare("UPDATE integration_requests SET status = ?, error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(response.ok ? "succeeded" : "failed", response.ok ? null : `HTTP_${response.status}`, response.ok ? null : `${lastError}${providerFailureDetail ? `: ${providerFailureDetail}` : ""}`.slice(0, 500), integrationId).run();
  let parsedProviderBody: unknown = null;
  try { parsedProviderBody = JSON.parse(responseBody); } catch { parsedProviderBody = responseBody.trim() || null; }
  if (!response.ok && provider === "delhivery" && operation === "shipment_status" && clientId && typeof payload.shipment_id === "string" && response.status === 404 && /invalid job id/i.test(responseBody)) {
    // Only Delhivery's explicit invalid-job response is strong enough to
    // release an asynchronous booking for a safe retry. Other failures must
    // never clear the job id or risk creating a duplicate shipment.
    await env.DB.prepare("UPDATE shipments SET provider_booking_id = NULL, provider_sync_status = 'failed', status = CASE WHEN status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery') THEN 'exception' ELSE status END, provider_retry_at = NULL, provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ? AND provider_reference IS NULL AND lr_number IS NULL AND master_awb IS NULL")
      .bind("Delhivery invalidated the asynchronous booking job; queued for a safe retry", payload.shipment_id, clientId).run();
  }
  if (provider === "delhivery" && operation === "labels") {
    const bodyObject = parsedProviderBody && typeof parsedProviderBody === "object" ? parsedProviderBody as Record<string, unknown> : null;
    console.warn(JSON.stringify({
      event: "delhivery_label_response",
      request_id: requestIdValue,
      variant: String(payload.label_api_variant ?? "primary"),
      http_status: response.status,
      content_type: response.headers.get("content-type"),
      body_bytes: responseBytes?.byteLength ?? responseBody.length,
      top_level_keys: bodyObject ? Object.keys(bodyObject).slice(0, 20) : [],
      job_id: bodyObject ? findProviderReference(bodyObject, new Set(["job_id", "jobid", "request_id", "requestid"])) : null,
      url_count: findProviderUrls(parsedProviderBody).length,
      pdf_payload: isProviderPdfArtifact(parsedProviderBody),
    }));
  }
  let providerEdd = response.ok ? findProviderEdd(parsedProviderBody) : null;
  let normalizedTracking: NormalizedProviderTracking | null = null;
  let normalizedTrackingEvents: NormalizedProviderTracking[] = [];
  if (operation === "tracking" && clientId && typeof payload.shipment_id === "string") {
    const syncError = response.ok ? null : `${lastError}${providerFailureDetail ? `: ${providerFailureDetail}` : ""}`.slice(0, 500);
    await env.DB.prepare("UPDATE shipments SET provider_last_attempt_at = CURRENT_TIMESTAMP, provider_last_error_code = ?, provider_last_error_message = ?, provider_last_success_at = CASE WHEN ? IS NULL THEN CURRENT_TIMESTAMP ELSE provider_last_success_at END WHERE id = ? AND client_id = ?")
      .bind(response.ok ? null : `HTTP_${response.status}`, syncError, syncError, payload.shipment_id, clientId).run();
  }
  if (response.ok && operation === "tracking") {
    try {
      normalizedTrackingEvents = normalizeProviderTrackingEvents(JSON.parse(responseBody));
      normalizedTracking = normalizedTrackingEvents.at(-1) ?? null;
    } catch { normalizedTracking = null; normalizedTrackingEvents = []; }
    if (clientId && typeof payload.shipment_id === "string") {
      try { await persistProviderWeight(env, payload.shipment_id, clientId, findProviderWeight(parsedProviderBody)); } catch (caught) { console.error(JSON.stringify({ event: "provider_weight_persist_failed", shipment_id: payload.shipment_id, error: caught instanceof Error ? caught.message : "unknown_error" })); }
    }
    if (!providerEdd) {
      providerEdd = normalizedTrackingEvents.map((event) => normalizeProviderEddFromText(event.description)).find((value): value is string => Boolean(value)) ?? null;
    }
    if (normalizedTracking && clientId && typeof payload.shipment_id === "string") {
      const current = await env.DB.prepare("SELECT status FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(payload.shipment_id, clientId).first<{ status: string }>();
      const currentStatus = String(current?.status ?? "").toLowerCase();
      const genericExceptionWrapper = normalizedTracking.status === "exception" && /^provider status:\s*exception$/i.test(normalizedTracking.description.trim());
      const preserveActiveStatus = genericExceptionWrapper && ["picked_up", "in_transit", "out_for_delivery"].includes(currentStatus);
      if (current && !preserveActiveStatus && validProviderShipmentTransition(currentStatus, normalizedTracking.status)) {
        await env.DB.prepare("UPDATE shipments SET provider = ?, status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, CURRENT_TIMESTAMP) ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(provider, normalizedTracking.status, normalizedTracking.status, payload.shipment_id, clientId).run();
      }
      const existingEvents = await env.DB.prepare("SELECT status, location, description, created_by_user_id, event_time FROM tracking_events WHERE shipment_id = ?").bind(payload.shipment_id).all<{ status: string; location: string | null; description: string | null; created_by_user_id: string | null; event_time: string | null }>();
      const existingSignatures = new Set(existingEvents.results.map((event) => `${event.status}|${event.location ?? ""}|${event.description ?? ""}|${event.event_time ?? ""}`));
      for (const event of normalizedTrackingEvents) {
        const signature = `${event.status}|${event.location}|${event.description}|${event.eventTime ?? ""}`;
        if (existingSignatures.has(signature)) continue;
        await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), payload.shipment_id, event.status, event.location, event.description, `provider:${provider}`, event.eventTime).run();
        existingSignatures.add(signature);
      }
    }
  }
  if (response.ok && operation === "tracking" && providerEdd && clientId && typeof payload.shipment_id === "string") {
    await env.DB.prepare("UPDATE shipments SET edd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(providerEdd, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "delhivery" && useDelhiveryB2b && operation === "shipment_status" && clientId && typeof payload.shipment_id === "string") {
    const statusLr = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["lrnum", "lr_num", "lr_number", "lr_no", "lrn", "lrn_number", "lr"]))) ?? responseBody.match(/(?:lr(?:n|[_ ]?(?:number|num|no))?)[^A-Za-z0-9]{0,12}(\d{6,20})/i)?.[1] ?? null;
    const statusAwb = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["master_awb", "master_awb_number", "masterawb", "master_waybill", "awb", "awb_number", "waybill", "waybill_number", "waybill_no"]))) ?? responseBody.match(/(?:master[_ ]?awb|awb|waybill)[^A-Za-z0-9]{0,12}(\d{6,20})/i)?.[1] ?? null;
    const statusJobId = findProviderReference(parsedProviderBody, new Set(["job_id", "jobid", "manifest_job_id", "request_id", "requestid"])) ?? (String(payload.provider_booking_id ?? "").trim() || null);
    if (statusLr || statusAwb) {
      await env.DB.prepare("UPDATE shipments SET lr_number = COALESCE(?, lr_number), master_awb = COALESCE(?, master_awb), box_awbs_json = COALESCE(?, box_awbs_json), provider_sync_status = 'confirmed', status = CASE WHEN status = 'exception' THEN 'booked' ELSE status END, tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), provider_last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(statusLr, statusAwb, statusAwb ? JSON.stringify([statusAwb]) : null, statusLr ?? statusAwb, statusAwb ?? statusLr, payload.shipment_id, clientId).run();
      const completedBilling = await completeShipmentBilling(env, clientId, payload.shipment_id);
      if (!completedBilling.ok) console.error(JSON.stringify({ event: "shipment_billing_deferred", request_id: requestIdValue, shipment_id: payload.shipment_id, error: completedBilling.error }));
      return { enabled: true, status: "accepted" as const, providerStatus: response.status, providerPending: false, providerBookingId: statusJobId, providerReference: statusAwb ?? statusLr, lr_number: statusLr, master_awb: statusAwb };
    }
    const pendingMessage = "Delhivery accepted the booking but has not published the LR/AWB yet.";
    await env.DB.prepare("UPDATE shipments SET provider_booking_id = COALESCE(?, provider_booking_id), provider_sync_status = 'pending', status = 'exception', provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ? AND provider_reference IS NULL AND lr_number IS NULL AND master_awb IS NULL")
      .bind(statusJobId, pendingMessage, payload.shipment_id, clientId).run();
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, providerPending: true, providerBookingId: statusJobId, message: pendingMessage };
  }
  if (response.ok && provider === "delhivery" && operation === "shipment_status" && clientId && typeof payload.shipment_id === "string" && !String(payload.tracking_number ?? payload.lr_number ?? payload.provider_reference ?? "").trim()) {
    const pendingMessage = "Delhivery accepted the booking but has not published the LR/AWB yet.";
    await env.DB.prepare("UPDATE shipments SET provider_sync_status = 'pending', status = 'exception', provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ? AND provider_booking_id IS NOT NULL AND provider_reference IS NULL AND lr_number IS NULL AND master_awb IS NULL")
      .bind(pendingMessage, payload.shipment_id, clientId).run();
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, providerPending: true, providerBookingId: String(payload.provider_booking_id ?? "").trim() || null, message: pendingMessage };
  }
  if (response.ok && provider === "delhivery" && operation === "pickup_slots") {
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, dates: normalizeDelhiveryPickupSlots(parsedProviderBody) };
  }
  if (response.ok && provider === "delhivery" && operation === "pickup_status") {
    const pickupStatus = (() => {
      let found = "";
      const walk = (node: unknown, depth = 0) => {
        if (depth > 8 || node === null || node === undefined || found) return;
        if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
        if (typeof node !== "object") return;
        const object = node as Record<string, unknown>;
        for (const key of ["status", "Status", "pickup_status", "pickupStatus", "state", "State"]) {
          const value = object[key];
          if (typeof value === "string" && pickupStatusFromProviderEvent(value)) { found = value; return; }
        }
        for (const child of Object.values(object)) walk(child, depth + 1);
      };
      walk(parsedProviderBody);
      return found;
    })();
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, pickupStatus: pickupStatusFromProviderEvent(pickupStatus), providerStatusDetail: pickupStatus || "Delhivery pickup status response received" };
  }
  // Delhivery B2B manifestation is asynchronous. The initial POST /manifest
  // acknowledges the request with a job id; the LR and AWB are returned by a
  // subsequent GET /manifest status request. Do not classify an accepted job
  // as a pickup-only request while Delhivery is still processing it.
  if (response.ok && provider === "delhivery" && useDelhiveryB2b && operation === "shipments") {
    const initialLr = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["lrnum", "lr_num", "lr_number", "lr_no", "lrn", "lrn_number", "lr"])))
      ?? responseBody.match(/(?:lr(?:n|[_ ]?(?:number|num|no))?)[^A-Za-z0-9]{0,12}(\d{6,20})/i)?.[1]
      ?? null;
    const initialAwb = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["master_awb", "master_awb_number", "masterawb", "master_waybill", "awb", "awb_number", "waybill", "waybill_number", "waybill_no"])))
      ?? responseBody.match(/(?:master[_ ]?awb|awb|waybill)[^A-Za-z0-9]{0,12}(\d{6,20})/i)?.[1]
      ?? null;
    const jobId = findProviderReference(parsedProviderBody, new Set(["job_id", "jobid", "manifest_job_id", "request_id", "requestid"]));
    if (!initialLr && !initialAwb && jobId) {
      for (let poll = 0; poll < 6; poll += 1) {
        // Ask for the status immediately, then use a bounded provider-friendly
        // interval. The manifest response already supplied the job id, so no
        // second manifest call is ever needed for LR retrieval.
        await new Promise((resolve) => setTimeout(resolve, poll === 0 ? 0 : 1500));
        try {
          const statusUrl = `${delhiveryB2bDocsBase()}/v2/manifest?job_id=${encodeURIComponent(jobId)}`;
          const statusResponse = await providerFetch(statusUrl, { method: "GET", headers }, Math.max(providerTimeoutMs, 5000));
          const statusBody = await providerResponseText(statusResponse, Math.max(providerTimeoutMs, 5000));
          if (statusResponse.ok) {
            let statusJson: unknown = null;
            try { statusJson = JSON.parse(statusBody); } catch { statusJson = null; }
            const statusLr = delhiveryB2bNumber(findProviderReference(statusJson, new Set(["lrnum", "lr_num", "lr_number", "lr_no", "lrn", "lrn_number", "lr"])))
              ?? statusBody.match(/(?:lr(?:n|[_ ]?(?:number|num|no))?)[^A-Za-z0-9]{0,12}(\d{6,20})/i)?.[1]
              ?? null;
            const statusAwb = delhiveryB2bNumber(findProviderReference(statusJson, new Set(["master_awb", "master_awb_number", "masterawb", "master_waybill", "awb", "awb_number", "waybill", "waybill_number", "waybill_no"])))
              ?? statusBody.match(/(?:master[_ ]?awb|awb|waybill)[^A-Za-z0-9]{0,12}(\d{6,20})/i)?.[1]
              ?? null;
            if (statusLr || statusAwb) {
              parsedProviderBody = statusJson;
              responseBody = statusBody;
              break;
            }
          }
        } catch {
          // Keep polling within the bounded window; the original manifest was
          // accepted and a delayed status response is expected.
        }
      }
    }
  }
  if (response.ok && provider === "delhivery" && useDelhiveryB2b && operation === "tracking" && clientId && typeof payload.shipment_id === "string") {
    const liveLr = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["lrnum", "lr_num", "lr_number", "lr_no", "lrn", "lrn_number", "lr"]))) ?? null;
    const liveAwb = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["master_awb", "master_awb_number", "masterawb", "master_waybill", "awb", "awb_number", "waybill", "waybill_number", "waybill_no"]))) ?? null;
    if (liveLr || liveAwb) await env.DB.prepare("UPDATE shipments SET lr_number = COALESCE(?, lr_number), master_awb = COALESCE(?, master_awb), tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), provider_sync_status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(liveLr, liveAwb, liveLr ?? liveAwb, liveAwb ?? liveLr, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "delhivery" && operation === "shipments" && clientId && typeof payload.shipment_id === "string") {
    // A PUR is a pickup-request identifier, not an LR. Keep extraction
    // ordered and type-specific so an AWB/job id cannot be mistaken for the
    // LR, and never allow the UI to fall back to the pickup reference as the
    // shipment booking reference.
    const b2bLrReference = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["lrnum", "lr_num", "lr_number", "lr_no", "lrn", "lrn_number", "lr"])));
    const b2bAwbReference = delhiveryB2bNumber(findProviderReference(parsedProviderBody, new Set(["master_awb", "master_awb_number", "masterawb", "master_waybill", "awb", "awb_number", "waybill", "waybill_number", "waybill_no"])));
    const providerBookingId = findProviderReference(parsedProviderBody, new Set(["job_id", "jobid", "manifest_job_id", "request_id", "requestid"]));
    const createdReference = useDelhiveryB2b ? b2bLrReference ?? b2bAwbReference : findProviderReference(parsedProviderBody, new Set(["waybill", "awb", "tracking_number", "trackingid", "shipment_id"]));
    const providerReference = useDelhiveryB2b ? b2bAwbReference ?? createdReference : createdReference;
    if (useDelhiveryB2b && !createdReference && providerBookingId) {
      const pending = "Delhivery accepted the booking and returned a provider job ID. LR/AWB is still being confirmed.";
      await env.DB.prepare("UPDATE shipments SET provider_booking_id = COALESCE(?, provider_booking_id), provider_sync_status = 'pending', status = 'exception', provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(providerBookingId, pending, payload.shipment_id, clientId).run();
      // `accepted` is a provider result, not a persisted integration-request
      // status. Keep the request pending until Delhivery publishes the LR/AWB;
      // the table intentionally permits only pending/succeeded/failed/retrying.
      await env.DB.prepare("UPDATE integration_requests SET status = 'pending', error_code = NULL, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pending, integrationId).run();
      return { enabled: true, status: "accepted" as const, providerStatus: response.status, providerPending: true, providerBookingId, message: pending };
    }
    if (useDelhiveryB2b && !createdReference) {
      const failure = "Delhivery accepted the request but returned no LR or AWB. The pickup request was not treated as a shipment booking.";
      await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = 'PROVIDER_REFERENCE_MISSING', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(failure, integrationId).run();
      return { enabled: true, status: "failed" as const, providerStatus: response.status, error: failure };
    }
    if (createdReference) await env.DB.prepare("UPDATE shipments SET lr_number = COALESCE(?, lr_number), master_awb = COALESCE(?, master_awb), box_awbs_json = COALESCE(?, box_awbs_json), provider_booking_id = COALESCE(?, provider_booking_id), provider_sync_status = 'confirmed', tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(useDelhiveryB2b ? b2bLrReference : null, useDelhiveryB2b ? b2bAwbReference : null, useDelhiveryB2b && b2bAwbReference ? JSON.stringify([b2bAwbReference]) : null, providerBookingId, createdReference, providerReference, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "trackon" && operation === "shipments" && clientId && typeof payload.shipment_id === "string") {
    const createdReference = findProviderReference(parsedProviderBody, new Set(["docketno", "docket_no", "awbno", "awb"])) ?? responseBody.match(/Docket\s*No\.\s*:\s*([A-Za-z0-9]+)/i)?.[1] ?? null;
    if (createdReference) await env.DB.prepare("UPDATE shipments SET tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(createdReference, createdReference, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "trackon" && operation === "labels") {
    const labelUrl = findProviderReference(parsedProviderBody, new Set(["fileurl", "file_url"]));
    return { enabled: true, status: labelUrl ? "accepted" as const : "failed" as const, providerStatus: response.status, label_url: labelUrl, error: labelUrl ? undefined : "Trackon did not return a label URL" };
  }
  if (response.ok && provider === "delhivery" && ["labels", "lr_copy", "document"].includes(operation)) {
    let artifact: unknown = null;
    try {
      artifact = JSON.parse(responseBody);
    } catch {
      artifact = {
        urls: findProviderUrls(responseBody, [], 0, "", response.url),
        content_base64: responseBytes ? providerBytesToBase64(responseBytes) : btoa(responseBody),
        content_type: responseBytes ? providerContentTypeFromBytes(responseBytes, response.headers.get("content-type") ?? "application/octet-stream") : response.headers.get("content-type") ?? "application/octet-stream",
      };
    }
    if (operation === "labels" && (payload.label_api_variant === "pdf" || payload.label_api_variant === "pdf_alt") && !isProviderPdfArtifact(artifact)) {
      // Delhivery queues PDF generation and publishes the resulting PDF URLs
      // through the label-links endpoint once the task completes. Poll that
      // provider endpoint briefly so the client receives the actual PDFs in
      // the same request instead of an empty formats menu.
      const labelUrl = `${delhiveryLabelApiBase()}/label/get_urls/${encodeURIComponent(delhiveryLabelApiSize(String(payload.label_size ?? "a4")))}/${encodeURIComponent(trackingNumber)}`;
      // The alternate B2B PDF endpoint returns a job id first. Delhivery's
      // label-link endpoint usually publishes the completed assets several
      // seconds later, so poll long enough for the provider job to finish.
      for (let poll = 0; poll < 12 && !findProviderUrls(artifact).length; poll += 1) {
        if (poll > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const labelResponse = await providerFetch(labelUrl, { method: "GET", headers }, Math.max(providerTimeoutMs, 5000));
          if (!labelResponse.ok) continue;
          const labelBody = await providerResponseText(labelResponse, Math.max(providerTimeoutMs, 5000));
          let labelJson: unknown = null;
          try { labelJson = JSON.parse(labelBody); } catch { labelJson = labelBody.trim() || null; }
          if (labelJson && findProviderUrls(labelJson).length) artifact = typeof labelJson === "object" ? labelJson : { urls: findProviderUrls(labelJson, [], 0, "", labelResponse.url) };
        } catch {
          // Keep the queued response and continue the bounded retry window.
        }
      }
    }
    if (operation === "labels" && artifact && typeof artifact === "object") {
      const labelUrls = findProviderUrls(artifact, [], 0, "", response.url);
      if (labelUrls.length) {
        try {
          const labelArtifacts: Array<{ content_base64: string; content_type: string }> = [];
          const requestedCopies = Math.max(1, Number(payload.boxes ?? payload.pieces ?? 1) + 1);
          // get_urls returns one asset per box plus a final MPS document asset.
          // Keep that provider document instead of replacing it with a duplicate
          // box label; the client uses the returned order for the A4 output.
          const labelFetchResults: string[] = [];
          for (const labelUrl of labelUrls.slice(0, requestedCopies)) {
            const labelResponse = await providerFetch(labelUrl, { method: "GET", headers: { ...headers, accept: "application/json,image/*,application/pdf" } }, attemptTimeoutMs);
            const labelContentType = labelResponse.headers.get("content-type") ?? "application/octet-stream";
            labelFetchResults.push(`${labelResponse.status}:${labelContentType}`);
            if (!labelResponse.ok) throw new Error(`label_content_http_${labelResponse.status}`);
            if (labelContentType.toLowerCase().includes("json")) {
              const labelBody = await providerResponseText(labelResponse, attemptTimeoutMs);
              let labelJson: unknown = null;
              try { labelJson = JSON.parse(labelBody); } catch { labelJson = labelBody.trim() || null; }
              const labelBase64 = findProviderContentBase64(labelJson);
              if (labelBase64) {
                const labelType = providerContentTypeFromBase64(labelBase64, findProviderContentType(labelJson) ?? "application/octet-stream");
              if (labelType === "application/pdf" || labelType === "image/png" || labelType === "image/jpeg") labelArtifacts.push({ content_base64: labelBase64, content_type: labelType });
              }
            } else {
              const labelBytes = await providerResponseBytes(labelResponse, 12 * 1024 * 1024);
              const labelType = providerContentTypeFromBytes(labelBytes, labelContentType);
              if (labelType === "application/pdf" || labelType === "image/png" || labelType === "image/jpeg") labelArtifacts.push({ content_base64: providerBytesToBase64(labelBytes), content_type: labelType });
            }
          }
          if (labelArtifacts.length) {
            // Keep only assets Delhivery actually returned. Never fabricate a
            // missing box label or MPS/document by duplicating another asset.
            artifact = { artifacts: labelArtifacts, content_type: labelArtifacts[0].content_type, copies: labelArtifacts.length };
          }
          console.warn(JSON.stringify({ event: "delhivery_label_assets", request_id: requestIdValue, variant: String(payload.label_api_variant ?? "primary"), requested_size: String(payload.label_size ?? "a4"), url_count: labelUrls.length, fetch_results: labelFetchResults, pdf_count: labelArtifacts.length }));
        } catch (caught) {
          return { enabled: true, status: "failed" as const, providerStatus: response.status, error: caught instanceof Error ? caught.message : "label_content_fetch_failed" };
        }
      }
      // Some older Delhivery B2B shipments return successful label URL
      // responses whose assets are image-only, while the provider's LR print
      // endpoint still publishes the authoritative PDF. Do not convert those
      // images or pretend that they are the requested physical sticker size.
      // Offer the provider PDF as A4 only; 4x2, 4x2.5, and 3x2 remain hidden
      // unless their own Delhivery endpoint returns genuine PDFs.
      if (operation === "labels" && String(payload.label_size ?? "") === "a4" && !isProviderPdfArtifact(artifact)) {
        try {
          const fallbackUrl = `${base.replace(/\/$/, "")}/lr_copy/print/${encodeURIComponent(trackingNumber)}?lr_copy_type=SHIPPER%20COPY`;
          const fallbackResponse = await providerFetch(fallbackUrl, { method: "GET", headers: { accept: "application/pdf" } }, attemptTimeoutMs);
          if (fallbackResponse.ok) {
            const fallbackBytes = await providerResponseBytes(fallbackResponse, 12 * 1024 * 1024);
            if (providerContentTypeFromBytes(fallbackBytes, fallbackResponse.headers.get("content-type") ?? "application/octet-stream") === "application/pdf") {
              artifact = { content_base64: providerBytesToBase64(fallbackBytes), content_type: "application/pdf", copies: 1, source: "delhivery_lr_copy_fallback" };
            }
          }
        } catch {
          // Keep the original provider result. A fallback failure must not
          // make a successful label endpoint look like a booking failure.
        }
      }
    }
    if (operation === "document" && clientId && typeof payload.shipment_id === "string") {
      const pod = await persistDelhiveryPod(env, clientId, payload.shipment_id, trackingNumber, artifact, responseBytes, response, requestIdValue);
      return { enabled: true, status: pod.stored || pod.reason === "already_exists" ? "accepted" as const : "failed" as const, providerStatus: response.status, artifact, pod_document_id: pod.document_id, error: pod.stored || pod.reason === "already_exists" ? undefined : pod.reason };
    }
    if (operation === "lr_copy" && !payload.lr_copy_type && responseBytes && lrCopyResponses.length) {
      artifact = {
        artifacts: [
          { copy_type: "SHIPPER COPY", content_base64: providerBytesToBase64(responseBytes), content_type: response.headers.get("content-type") ?? "application/pdf" },
          ...lrCopyResponses.map(({ copyType, bytes }) => ({ copy_type: copyType, content_base64: providerBytesToBase64(bytes), content_type: "application/pdf" })),
        ],
        content_type: "application/pdf",
        copies: lrCopyResponses.length + 1,
      };
    }
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, artifact };
  }
  if (response.ok && provider === "delhivery" && operation === "pickups" && typeof payload.pickup_id === "string") {
    const rawPickupReference = findProviderReference(parsedProviderBody, new Set(["pickup_id", "pickup_request_id", "pickup_request_number", "pickup_request_no", "pickupRequestId", "pickupRequestNumber", "pur_id", "pur", "pur_number", "pickup_request"]));
    const pickupReference = validDelhiveryPickupReference(rawPickupReference)
      ?? responseBody.match(/(?:pickup(?:[_ ]request)?(?:[_ ](?:id|number|no))?|pur(?:[_ ]?(?:id|number|no))?)[^0-9]{0,16}(\d{6,20})/i)?.[1]
      ?? null;
    if (pickupReference) await env.DB.prepare("UPDATE pickup_requests SET provider = 'delhivery', provider_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(pickupReference, payload.pickup_id, clientId ?? "").run();
    const providerState = findProviderReference(parsedProviderBody, new Set(["status", "provider_status", "state", "pickup_status"]));
    const providerSlotId = findProviderReference(parsedProviderBody, new Set(["slot_id", "pickup_slot_id", "provider_slot_id", "slot", "time_slot_id"]));
    const acceptedDate = findProviderReference(parsedProviderBody, new Set(["pickup_date", "pickupDate", "scheduled_date", "scheduledDate", "pickup_scheduled_date"]));
    const acceptedWindow = findProviderReference(parsedProviderBody, new Set(["pickup_time", "pickupTime", "time_slot", "timeSlot", "pickup_window", "pickupWindow", "requested_time_slot"]));
    const providerPending = Boolean(providerState && /pending|queued|processing|created|in_progress/i.test(providerState));
    return { enabled: true, status: "accepted" as const, providerStatus: providerState ?? response.status, providerPending, providerReference: pickupReference, providerSlotId, acceptedDate: acceptedDate && validPickupDate(acceptedDate) ? acceptedDate : null, acceptedWindow };
  }
  if (response.ok && provider === "delhivery" && operation === "serviceability_route") {
    const body = parsedProviderBody && typeof parsedProviderBody === "object" ? parsedProviderBody as Record<string, unknown> : {};
    const providerError = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
    const providerErrorText = String(providerError?.message ?? providerError?.detail ?? providerError?.code ?? body.message ?? "").trim();
    if (body.success === false || /not\s*(found|available|serviceable)|unserviceable|invalid\s*(pin|pincode)/i.test(providerErrorText)) {
      return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: false, pickup: false, prepaid: false, cod: false, oda: null, reason: providerErrorText.slice(0, 300) || "Delhivery does not currently service this route" };
    }
    const parseTat = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const match = value.match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
      }
      return null;
    };
    const findTat = (value: unknown, depth = 0): number | null => {
      if (depth > 5 || value == null || typeof value !== "object") return null;
      if (Array.isArray(value)) {
        for (const item of value) { const found = findTat(item, depth + 1); if (found !== null) return found; }
        return null;
      }
      const record = value as Record<string, unknown>;
      for (const key of ["tat", "tat_days", "tatDays", "expected_tat", "estimated_tat", "estimatedTat", "estimated_days", "transit_days", "transit_time"]) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          const found = parseTat(record[key]);
          if (found !== null) return found;
        }
      }
      for (const nested of Object.values(record)) { if (nested && typeof nested === "object") { const found = findTat(nested, depth + 1); if (found !== null) return found; } }
      return null;
    };
    const tatDays = parseTat(parsedProviderBody) ?? findTat(body);
    if (tatDays !== null && tatDays > 0) return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: true, pickup: true, prepaid: true, cod: false, oda: null, tat_days: tatDays };
    return { enabled: true, status: "failed" as const, providerStatus: response.status, error: "Delhivery returned an incomplete route serviceability response" };
  }
  if (response.ok && provider === "delhivery" && operation === "serviceability") {
    const body = parsedProviderBody && typeof parsedProviderBody === "object" ? parsedProviderBody as Record<string, unknown> : {};
    const b2bData = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : null;
    const providerError = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
    const providerErrorText = String(providerError?.message ?? providerError?.detail ?? providerError?.code ?? "").trim();
    if (body.success === false && providerErrorText && /pincode|pin\s*code|serviceab|not\s*(found|available|serviceable)|unserviceable/i.test(providerErrorText)) return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: false, prepaid: false, cod: false, pickup: false, oda: null, reason: providerErrorText.slice(0, 300) };
    const candidateRows = [
      body.data,
      b2bData?.pincode_serviceability_data,
      b2bData?.serviceability_data,
      b2bData?.data,
      body.pincode_serviceability_data,
      body.serviceability_data,
      body.result,
      body.results,
    ];
    const findB2bRows = (value: unknown, depth = 0): unknown[] | null => {
      if (depth > 4 || value == null) return null;
      if (Array.isArray(value)) return value.length > 0 ? value : null;
      if (typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(record, "fm_serviceable") || Object.prototype.hasOwnProperty.call(record, "fmServiceable")) return [record];
      for (const nested of Object.values(record)) {
        const rows = findB2bRows(nested, depth + 1);
        if (rows) return rows;
      }
      return null;
    };
    const b2bRows = candidateRows.reduce<unknown[] | null>((found, value) => found ?? findB2bRows(value), null);
    const b2bRow = b2bRows?.[0] && typeof b2bRows[0] === "object" ? b2bRows[0] as Record<string, unknown> : null;
    if (b2bRows && !b2bRow) return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: false, prepaid: false, cod: false, pickup: false, oda: null, reason: "Delhivery does not currently service this pincode" };
    if (b2bRow) {
      const hasServiceabilityFlag = Object.prototype.hasOwnProperty.call(b2bRow, "fm_serviceable") || Object.prototype.hasOwnProperty.call(b2bRow, "fmServiceable");
      if (!hasServiceabilityFlag) return { enabled: true, status: "failed" as const, providerStatus: response.status, error: "Delhivery returned an incomplete pincode serviceability response" };
      const truthyFlag = (value: unknown) => value === true || ["true", "yes", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
      const serviceable = truthyFlag(b2bRow.fm_serviceable ?? b2bRow.fmServiceable);
      const paymentFlags = providerPaymentFlags(b2bRow);
      return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable, prepaid: paymentFlags.prepaid ?? undefined, cod: paymentFlags.cod ?? undefined, pickup: serviceable, oda: truthyFlag(b2bRow.oda), facility_city: String(b2bRow.city ?? "").trim() || undefined, facility_state: String(b2bRow.state ?? "").trim() || undefined };
    }
    const code = Array.isArray(body.delivery_codes) ? (body as { delivery_codes: Array<Record<string, unknown>> }).delivery_codes[0] : null;
    const postal = code?.postal_code && typeof code.postal_code === "object" ? code.postal_code as Record<string, unknown> : null;
    if (!postal) return { enabled: true, status: "failed" as const, providerStatus: response.status, error: "Delhivery returned an incomplete pincode serviceability response" };
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: Boolean(postal && (String(postal.pre_paid ?? "N").toUpperCase() === "Y" || String(postal.cash ?? "N").toUpperCase() === "Y")), prepaid: String(postal?.pre_paid ?? "N").toUpperCase() === "Y", cod: String(postal?.cash ?? "N").toUpperCase() === "Y", pickup: String(postal?.pickup ?? "N").toUpperCase() === "Y", oda: providerOdaFlag(postal), facility_city: String(postal?.city ?? postal?.district ?? "").trim() || undefined, facility_state: String(postal?.state ?? "").trim() || undefined };
  }
  if (response.ok && provider === "rivigo" && operation === "serviceability") {
    const payloadBody = parsedProviderBody && typeof parsedProviderBody === "object" ? (parsedProviderBody as Record<string, unknown>).payload : null;
    const body = payloadBody && typeof payloadBody === "object" ? payloadBody as Record<string, unknown> : {};
    const from = body.fromPincodeDTO && typeof body.fromPincodeDTO === "object" ? body.fromPincodeDTO as Record<string, unknown> : {};
    const to = body.toPincodeDTO && typeof body.toPincodeDTO === "object" ? body.toPincodeDTO as Record<string, unknown> : {};
    const fromServiceable = Object.keys(from).length > 0 && Boolean(from.deliveryServiceability ?? from.pickupServiceability);
    const toServiceable = Object.keys(to).length > 0 && Boolean(to.deliveryServiceability ?? to.pickupServiceability);
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: fromServiceable && toServiceable, cod: Boolean(to.codDodAllowed), to_pay: Boolean(to.toPayAllowed), tat_days: Number(body.tat ?? 0) || null, origin_oda: providerOdaFlag(from), destination_oda: providerOdaFlag(to) };
  }
  if (response.ok && provider === "xpressbees" && operation === "serviceability") {
    const body = parsedProviderBody && typeof parsedProviderBody === "object" ? parsedProviderBody as Record<string, unknown> : {};
    const options = Array.isArray(body.message) ? body.message : Array.isArray(body.data) ? body.data : [];
    const serviceable = body.status === true && options.length > 0;
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable, prepaid: serviceable, cod: serviceable, pickup: serviceable, oda: null };
  }
  if (response.ok && provider === "ekart" && operation === "shipments" && clientId && typeof payload.shipment_id === "string" && ekartCreate) {
    let providerReference: string | null = null;
    try { providerReference = findProviderReference(JSON.parse(responseBody), new Set(["tracking_id", "trackingid", "waybill", "awb", "shipment_id"])); } catch { providerReference = null; }
    const requestedReference = (ekartCreate.services[0]?.service_details[0]?.shipment as { tracking_id?: string } | undefined)?.tracking_id;
    const createdTracking = providerReference ?? requestedReference ?? null;
    if (createdTracking) await env.DB.prepare("UPDATE shipments SET tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(createdTracking, createdTracking, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "rivigo" && operation === "shipments" && clientId && typeof payload.shipment_id === "string") {
    const createdReference = findProviderReference(parsedProviderBody, new Set(["cnote", "bookingId", "booking_id"]));
    if (createdReference) await env.DB.prepare("UPDATE shipments SET tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(createdReference, createdReference, payload.shipment_id, clientId).run();
  }
  const providerError = response.ok
    ? undefined
    : findProviderReference(parsedProviderBody, new Set(["message", "error", "errors", "rmk", "remark", "remarks", "reason", "detail"]))
      ?? (responseBody.replace(/\s+/g, " ").trim().slice(0, 300) || lastError);
  const providerErrorText = String(providerError ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const normalizedError = response.ok
    ? undefined
    : /client[- ]warehouse.*not active|warehouse.*inactive|wrong\/inactive center/i.test(providerErrorText)
      ? "Delhivery rejected this booking because the selected pickup warehouse is inactive. Activate that exact saved warehouse for this Delhivery account, then retry."
      : `${lastError}: ${providerErrorText || "Delhivery rejected the booking"}`;
  const providerAmountValue = provider === "delhivery" ? findDelhiveryCost(parsedProviderBody) : provider === "xpressbees" && operation === "quotes" ? findProviderAmount(parsedProviderBody) : null;
  if (response.ok && provider === "delhivery" && providerAmountValue !== null && clientId && typeof payload.shipment_id === "string") {
    await env.DB.prepare("INSERT OR REPLACE INTO pricing_provider_costs (id, shipment_id, client_id, provider, provider_account_id, provider_amount, provider_status) VALUES (COALESCE((SELECT id FROM pricing_provider_costs WHERE shipment_id = ?), ?), ?, ?, ?, ?, ?, ?)")
      .bind(payload.shipment_id, crypto.randomUUID(), payload.shipment_id, clientId, provider, account?.id ?? null, providerAmountValue, "accepted").run();
  }
  return { enabled: true, status: response.ok ? "accepted" as const : "failed" as const, providerStatus: response.status, normalized_status: normalizedTracking?.status, edd: providerEdd, tracking: normalizedTracking ? { status: normalizedTracking.status, location: normalizedTracking.location, description: normalizedTracking.description, event_time: normalizedTracking.eventTime } : undefined, tracking_events: operation === "tracking" ? normalizedTrackingEvents.map((event) => ({ status: event.status, location: event.location, description: event.description, event_time: event.eventTime, source: `provider:${provider}` })) : undefined, amount: providerAmountValue, provider_account_id: account?.id, account_name: account?.account_name, confidence_score: account?.confidence_score, priority: account?.priority, rate_card_id: account?.rate_card_id ?? undefined, error: normalizedError };
}

async function recordPickupAttempt(env: Env, details: { pickupId: string; clientId: string; provider: string; providerAccountId?: string | null; requestId?: string | null; idempotencyKey?: string | null; requestedDate?: string | null; requestedWindow?: string | null; status: string; providerStatus?: string | number | null; providerReference?: string | null; providerErrorCode?: string | null; errorMessage?: string | null }) {
  await env.DB.prepare("INSERT INTO pickup_request_attempts (id, pickup_id, client_id, provider, provider_account_id, request_id, idempotency_key, requested_date, requested_time_slot, status, provider_status, provider_reference, provider_error_code, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), details.pickupId, details.clientId, details.provider, details.providerAccountId ?? null, details.requestId ?? null, details.idempotencyKey ?? null, details.requestedDate ?? null, details.requestedWindow ?? null, details.status, details.providerStatus == null ? null : String(details.providerStatus), details.providerReference ?? null, details.providerErrorCode ?? null, details.errorMessage ?? null)
    .run();
}

// Delhivery's B2B pickup API exposes creation/cancellation, not an append-
// shipment operation for an already accepted PUR. Only keep a manifest group
// open while its provider request is still pending; once accepted/scheduled,
// a later shipment must receive its own provider pickup request.
const GROUPABLE_MANIFEST_PICKUP_STATUSES = ["requested", "provider_pending"];

function manifestPickupAddress(payload: Record<string, unknown>) {
  const origin = payload.origin_address && typeof payload.origin_address === "object" ? payload.origin_address as Record<string, unknown> : {};
  const value = (key: string, fallback?: unknown) => String(origin[key] ?? payload[key] ?? fallback ?? "").trim();
  return {
    name: value("name", payload.contact_name ?? payload.pickup_location),
    line: value("line", payload.pickup_address ?? payload.origin),
    city: value("city"),
    state: value("state"),
    pincode: value("pincode", payload.pincode ?? payload.origin_pincode),
    country: value("country", "India") || "India",
    phone: value("phone", payload.contact_phone ?? payload.pickup_phone),
  };
}

function pickupAwbsFromJson(value: unknown) {
  if (typeof value !== "string") return normalizePickupAwbNumbers(value);
  try { return normalizePickupAwbNumbers(JSON.parse(value)); } catch { return normalizePickupAwbNumbers(value); }
}

async function ensureManifestPickupGroup(
  env: Env,
  details: { shipmentId: string; clientId: string; provider: CourierProvider; providerAccountId: string | null; warehouseId?: string | null; payload: Record<string, unknown>; requestId: string; idempotencyKey?: string | null },
) {
  const address = manifestPickupAddress(details.payload);
  const requestedDate = providerSafePickupDate(String(details.payload.pickup_date ?? details.payload.requested_date ?? details.payload.edd ?? new Date().toISOString().slice(0, 10)));
  const requestedWindow = String(details.payload.requested_time_slot ?? details.payload.window ?? "09:00 - 11:00").trim();
  const pieces = Math.max(1, Number(details.payload.pieces ?? 1));
  const weight = Number(details.payload.total_weight_kg ?? details.payload.weight ?? 0);
  const warehouse = details.warehouseId
    ? await env.DB.prepare("SELECT id, name FROM warehouses WHERE id = ? AND client_id = ? LIMIT 1").bind(details.warehouseId, details.clientId).first<{ id: string; name: string }>()
    : null;
  const providerWarehouse = String(warehouse?.name ?? details.payload.delhivery_pickup_location ?? details.payload.pickup_location ?? address.name).trim();
  const shipment = await env.DB.prepare("SELECT tracking_number, lr_number, master_awb, provider_reference FROM shipments WHERE id = ? AND client_id = ? LIMIT 1")
    .bind(details.shipmentId, details.clientId).first<{ tracking_number: string | null; lr_number: string | null; master_awb: string | null; provider_reference: string | null }>();
  const shipmentAwbs = normalizePickupAwbNumbers(shipment?.master_awb ?? shipment?.tracking_number ?? shipment?.provider_reference);
  const groupableStatuses = GROUPABLE_MANIFEST_PICKUP_STATUSES.map(() => "?").join(", ");
  const existing = await env.DB.prepare(`SELECT id, shipment_id, status, provider_reference, provider_status, provider_awb_numbers_json, pieces, total_weight_kg
    FROM pickup_requests
    WHERE client_id = ? AND provider = ? AND COALESCE(provider_account_id, '') = COALESCE(?, '')
      AND pincode = ? AND pickup_address = ?
      AND requested_date = ? AND requested_time_slot = ? AND status IN (${groupableStatuses})
    ORDER BY created_at ASC LIMIT 1`)
    .bind(details.clientId, details.provider, details.providerAccountId, address.pincode, address.line, requestedDate, requestedWindow, ...GROUPABLE_MANIFEST_PICKUP_STATUSES).first<{ id: string; shipment_id: string | null; status: string; provider_reference: string | null; provider_status: string | null; provider_awb_numbers_json: string | null; pieces: number | null; total_weight_kg: number | null }>();

  if (existing) {
    let groupedAwbs = pickupAwbsFromJson(existing.provider_awb_numbers_json);
    groupedAwbs = Array.from(new Set([...groupedAwbs, ...shipmentAwbs]));
    await env.DB.prepare("UPDATE pickup_requests SET pieces = COALESCE(pieces, 0) + ?, total_weight_kg = COALESCE(total_weight_kg, 0) + ?, provider_awb_numbers_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(pieces, Number.isFinite(weight) ? weight : 0, JSON.stringify(groupedAwbs), existing.id, details.clientId).run();
    await env.DB.prepare("INSERT OR IGNORE INTO pickup_request_shipments (pickup_id, shipment_id, client_id) VALUES (?, ?, ?)")
      .bind(existing.id, details.shipmentId, details.clientId).run();
    if (existing.provider_reference) await env.DB.prepare("UPDATE shipments SET provider_pickup_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(existing.provider_reference, details.shipmentId, details.clientId).run();
    return { ok: true as const, id: existing.id, status: existing.status, providerReference: existing.provider_reference, grouped: true as const };
  }

  const pickupId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO pickup_requests (id, shipment_id, client_id, created_by_user_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, city, state, pincode, country, pieces, total_weight_kg, status, provider, provider_account_id, warehouse_id, provider_status, provider_awb_numbers_json, idempotency_key, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, 'pending', ?, ?, ?)")
    .bind(pickupId, details.shipmentId, details.clientId, `manifest:${details.shipmentId}`, requestedDate, requestedWindow, address.line, address.name || "Consignor", normalizePickupPhone(address.phone) ?? "0000000000", address.city || null, address.state || null, address.pincode, address.country, pieces, Number.isFinite(weight) ? weight : null, details.provider, details.providerAccountId, details.warehouseId ?? null, JSON.stringify(shipmentAwbs), `manifest-pickup-${details.shipmentId}`, "Automatically grouped from manifested shipment using the consignor address")
    .run();
  await env.DB.prepare("INSERT OR IGNORE INTO pickup_request_shipments (pickup_id, shipment_id, client_id) VALUES (?, ?, ?)")
    .bind(pickupId, details.shipmentId, details.clientId).run();

  const providerResult = await safeProviderRequest(env, details.provider, "pickups", {
    pickup_id: pickupId,
    shipment_id: details.shipmentId,
    provider_account_id: details.providerAccountId,
    delhivery_pickup_location: providerWarehouse,
    pickup_location: providerWarehouse,
    scheduled_date: requestedDate,
    requested_date: requestedDate,
    window: requestedWindow,
    requested_time_slot: requestedWindow,
    location: address.line,
    pickup_address: address.line,
    contact_name: address.name || "Consignor",
    contact_phone: normalizePickupPhone(address.phone) ?? "0000000000",
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    country: address.country,
    pieces,
    weight: Number.isFinite(weight) ? weight : 0,
    awb_number: shipmentAwbs,
    provider_managed: true,
  }, details.requestId, details.clientId, details.idempotencyKey ?? `manifest-pickup-${details.shipmentId}`);
  const providerReference = (providerResult as { providerReference?: string | null }).providerReference ?? null;
  const providerStatus = (providerResult as { providerStatus?: string | number | null }).providerStatus ?? providerResult.status;
  const providerError = (providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? null;
  await recordPickupAttempt(env, { pickupId, clientId: details.clientId, provider: details.provider, providerAccountId: details.providerAccountId, requestId: details.requestId, idempotencyKey: details.idempotencyKey, requestedDate, requestedWindow, status: providerResult.status, providerStatus, providerReference, providerErrorCode: providerResult.status === "accepted" ? null : providerResult.status, errorMessage: providerError }).catch(() => undefined);
  if (providerResult.status !== "accepted") {
    const failureReason = String(providerError ?? `The ${details.provider} pickup was not accepted`).slice(0, 500);
    await env.DB.prepare("UPDATE pickup_requests SET status = 'failed', provider_status = ?, provider_request_id = ?, provider_error_code = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(String(providerStatus), details.requestId, String(providerResult.status), failureReason, pickupId, details.clientId).run();
    return { ok: false as const, id: pickupId, status: "failed", error: failureReason };
  }
  const pickupStatus = (providerResult as { providerPending?: boolean }).providerPending ? "provider_pending" : "scheduled";
  const acceptedDate = (providerResult as { acceptedDate?: string | null }).acceptedDate ?? requestedDate;
  const acceptedWindow = (providerResult as { acceptedWindow?: string | null }).acceptedWindow ?? requestedWindow;
  await env.DB.prepare("UPDATE pickup_requests SET status = ?, provider_status = ?, provider_request_id = ?, provider_reference = COALESCE(?, provider_reference), provider_slot_id = COALESCE(?, provider_slot_id), requested_date = ?, requested_time_slot = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
    .bind(pickupStatus, String(providerStatus), details.requestId, providerReference, (providerResult as { providerSlotId?: string | null }).providerSlotId ?? null, acceptedDate, acceptedWindow, pickupId, details.clientId).run();
  if (providerReference) await env.DB.prepare("UPDATE shipments SET provider_pickup_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
    .bind(providerReference, details.shipmentId, details.clientId).run();
  return { ok: true as const, id: pickupId, status: pickupStatus, providerReference, grouped: false as const };
}

async function safeProviderRequest(env: Env, provider: CourierProvider, operation: string, payload: Record<string, unknown>, requestIdValue: string, clientId?: string, idempotencyKey?: string, timeoutMsOverride?: number) {
  try {
    return await providerRequest(env, provider, operation, payload, requestIdValue, clientId, idempotencyKey, timeoutMsOverride);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.slice(0, 500) : "provider_request_failed";
    const cronReadOperations = new Set(["tracking", "document", "shipment_status", "serviceability", "serviceability_route", "pickup_status", "pickup_slots", "freight_charges"]);
    const persistIntegration = !(requestIdValue.startsWith("cron:") && cronReadOperations.has(operation));
    if (persistIntegration) {
      try {
        await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = 'PROVIDER_EXCEPTION', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_request_id = ? AND provider = ? AND operation = ? AND status = 'pending'").bind(message, requestIdValue, provider, operation).run();
      } catch (recordingError) {
        console.error(JSON.stringify({ request_id: requestIdValue, route: "/v1/provider-request", provider, operation, error: "failed_to_record_provider_exception", detail: recordingError instanceof Error ? recordingError.message.slice(0, 200) : "unknown" }));
      }
    }
    console.error(JSON.stringify({ request_id: requestIdValue, route: "/v1/provider-request", provider, operation, error: message }));
    return { enabled: true, status: "failed" as const, providerStatus: 0, error: message };
  }
}

async function verifyDelhiveryServiceability(env: Env, originPincode: string, destinationPincode: string, providerAccountId: string, requestIdValue: string, clientId: string, paymentMode?: string, weightKg?: number): Promise<DelhiveryServiceabilityResult> {
  const normalizedWeightKg = Number.isFinite(Number(weightKg)) && Number(weightKg) > 0 ? Number(weightKg) : 20;
  const cacheKey = serviceabilityCacheKey(providerAccountId, originPincode, destinationPincode, paymentMode, normalizedWeightKg);
  const cached = delhiveryServiceabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, provenance: "cached_provider" };
  const [originResult, destinationResult, routeResult] = await Promise.all([
    safeProviderRequest(env, "delhivery", "serviceability", { destination_pincode: originPincode, weight_kg: normalizedWeightKg, provider_account_id: providerAccountId }, `${requestIdValue}:origin-serviceability`, clientId, undefined, 10000),
    safeProviderRequest(env, "delhivery", "serviceability", { destination_pincode: destinationPincode, weight_kg: normalizedWeightKg, provider_account_id: providerAccountId }, `${requestIdValue}:destination-serviceability`, clientId, undefined, 10000),
    safeProviderRequest(env, "delhivery", "serviceability_route", { origin_pincode: originPincode, destination_pincode: destinationPincode, provider_account_id: providerAccountId }, `${requestIdValue}:route-serviceability`, clientId, undefined, 10000),
  ]);
  const origin = originResult as Record<string, unknown>;
  const destination = destinationResult as Record<string, unknown>;
  const route = routeResult as Record<string, unknown>;
  const routeAccepted = route.status === "accepted" && route.serviceable === true;
  // Delhivery's B2B pincode response describes per-pincode capability and
  // payment flags; the B2B route/TAT response is the authoritative lane
  // decision. Use the route for origin/destination lane serviceability while
  // retaining the pincode response's payment restrictions. Explicit provider
  // failures and a route-negative response still block the operation.
  const routeDecisionOrigin = routeAccepted && origin.status === "accepted"
    ? { ...origin, serviceable: true, pickup: true }
    : origin;
  const routeDecisionDestination = routeAccepted && destination.status === "accepted"
    ? { ...destination, serviceable: true, prepaid: route.prepaid === true ? true : destination.prepaid, cod: route.cod === true ? true : destination.cod }
    : destination;
  const decision = routeAccepted
    ? evaluateDelhiveryServiceability(routeDecisionOrigin, routeDecisionDestination, paymentMode)
    : { ok: false, providerUnavailable: route.status !== "accepted" && route.status !== "failed", reason: String(route.error ?? route.reason ?? "Delhivery could not verify the origin-to-destination route") };
  const result: DelhiveryServiceabilityResult = {
    ok: decision.ok,
    provenance: decision.providerUnavailable ? "provider_unavailable" : "live_provider",
    origin,
    destination,
    route,
    reason: decision.reason,
  };
  if (result.ok) delhiveryServiceabilityCache.set(cacheKey, { expiresAt: Date.now() + DELHIVERY_SERVICEABILITY_CACHE_TTL_MS, result });
  return result;
}

async function resolveDelhiveryProviderAccountId(env: Env, clientId: string, requestedAccountId?: string | null) {
  const requested = String(requestedAccountId ?? "").trim();
  const row = requested
    ? await env.DB.prepare("SELECT pa.id FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.id = ? AND pa.provider = 'delhivery' AND pa.status = 'active' AND (pa.client_id = ? OR (p.client_id = ? AND p.enabled = 1)) LIMIT 1").bind(clientId, requested, clientId, clientId).first<{ id: string }>()
    : await env.DB.prepare("SELECT pa.id FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.provider = 'delhivery' AND pa.status = 'active' AND (pa.client_id = ? OR (p.client_id = ? AND p.enabled = 1)) ORDER BY CASE WHEN pa.client_id = ? THEN 0 ELSE 1 END, COALESCE(p.priority, 100) ASC, COALESCE(p.confidence_score, 0) DESC, pa.account_name ASC LIMIT 1").bind(clientId, clientId, clientId, clientId).first<{ id: string }>();
  return row?.id ?? null;
}

async function loadShipmentInvoiceDocumentsForRetry(env: Env, clientId: string, shipmentId: string, payload: Record<string, unknown>) {
  const rows = await env.DB.prepare("SELECT object_key, original_filename, content_type FROM shipment_documents WHERE shipment_id = ? AND client_id = ? ORDER BY created_at ASC").bind(shipmentId, clientId).all<{ object_key: string; original_filename: string; content_type: string }>();
  const documents: Array<Record<string, unknown>> = [];
  for (const row of rows.results) {
    const object = await env.FILES.get(row.object_key);
    if (!object) throw new Error(`queued_invoice_missing:${row.original_filename}`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    documents.push({ name: row.original_filename, content_type: row.content_type, body_base64: providerBytesToBase64(bytes), invoice_number: String(payload.invoice_number ?? row.original_filename) });
  }
  return documents;
}

function providerRetryPayload(payload: Record<string, unknown>) {
  const retryPayload = { ...payload };
  delete retryPayload.invoice_documents;
  delete retryPayload.eway_document;
  return retryPayload;
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function retryPendingDelhiveryBookings(env: Env, cron: string) {
  const pending = await env.DB.prepare("SELECT id, client_id, provider_account_id, provider_booking_payload_json, provider_retry_count FROM shipments WHERE provider = 'delhivery' AND status IN ('booked', 'exception') AND provider_sync_status IN ('pending', 'failed') AND provider_booking_payload_json IS NOT NULL AND provider_booking_id IS NULL AND (provider_retry_at IS NULL OR datetime(provider_retry_at) <= datetime('now')) ORDER BY updated_at ASC LIMIT 10").all<{ id: string; client_id: string; provider_account_id: string | null; provider_booking_payload_json: string; provider_retry_count: number | null }>();
  for (const shipment of pending.results) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(shipment.provider_booking_payload_json) as Record<string, unknown>; } catch {
      await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'failed', provider_last_error = ?, provider_booking_payload_json = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind("Queued booking payload could not be decoded", shipment.id, shipment.client_id).run();
      continue;
    }
    try {
      // Older queued bookings may not have persisted the selected warehouse id.
      // Recover it only when the queued origin exactly matches one of this
      // client's saved warehouses; unsaved origins remain on registration.
      if (!(typeof payload.warehouse_id === "string" && payload.warehouse_id.trim())) {
        const origin = payload.origin_address && typeof payload.origin_address === "object" ? payload.origin_address as Record<string, unknown> : null;
        const originPincode = String(origin?.pincode ?? "").trim();
        const originLine = String(origin?.line ?? origin?.address ?? "").trim().toLowerCase();
        const originCity = String(origin?.city ?? "").trim().toLowerCase();
        const originState = String(origin?.state ?? "").trim().toLowerCase();
        const originPhone = String(origin?.phone ?? "").replace(/\D/g, "");
        const originName = String(origin?.name ?? "").trim().toLowerCase();
        if (originPincode && originLine) {
          const savedWarehouses = await env.DB.prepare("SELECT id, address, city, state, pincode, contact, contact_name FROM warehouses WHERE client_id = ? AND status = 'active'").bind(shipment.client_id).all<{ id: string; address: string | null; city: string | null; state: string | null; pincode: string | null; contact: string | null; contact_name: string | null }>();
          const matchedWarehouse = savedWarehouses.results.find((warehouse) =>
            String(warehouse.pincode ?? "").trim() === originPincode
            && String(warehouse.address ?? "").trim().toLowerCase() === originLine
            && String(warehouse.city ?? "").trim().toLowerCase() === originCity
            && String(warehouse.state ?? "").trim().toLowerCase() === originState
            && (!originPhone || String(warehouse.contact ?? "").replace(/\D/g, "") === originPhone)
            && (!originName || String(warehouse.contact_name ?? "").trim().toLowerCase() === originName)
          );
          if (matchedWarehouse) payload.warehouse_id = matchedWarehouse.id;
        }
      }
      const invoiceDocuments = await loadShipmentInvoiceDocumentsForRetry(env, shipment.client_id, shipment.id, payload);
      const result = await safeProviderRequest(env, "delhivery", "shipments", { shipment_id: shipment.id, ...payload, invoice_documents: invoiceDocuments, provider_account_id: shipment.provider_account_id ?? payload.provider_account_id }, `cron:${cron}:booking:${shipment.id}`, shipment.client_id, `queued-booking-${shipment.id}`, 25000);
      if (result.status === "accepted") {
        const snapshot = await env.DB.prepare("SELECT 1 AS present FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(shipment.id, shipment.client_id).first<{ present: number }>();
        if (snapshot) {
          const billing = await completeShipmentBilling(env, shipment.client_id, shipment.id);
          if (!billing.ok) {
            await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'failed', provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(billing.error, shipment.id, shipment.client_id).run();
            continue;
          }
        }
        await env.DB.prepare("UPDATE shipments SET provider_booking_payload_json = NULL, provider_retry_at = NULL, provider_last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(shipment.id, shipment.client_id).run();
        continue;
      }
      const reason = String((result as { error?: string; reason?: string }).error ?? (result as { reason?: string }).reason ?? "Delhivery did not accept the queued booking").slice(0, 500);
      const retryCount = Number(shipment.provider_retry_count ?? 0) + 1;
      const stillActivationPending = /awaiting provider activation|not active|not configured/i.test(reason);
      if (stillActivationPending) {
        const delayMinutes = Math.min(60, Math.max(5, 5 * 2 ** Math.min(retryCount - 1, 3)));
        await env.DB.prepare("UPDATE shipments SET provider_retry_count = ?, provider_retry_at = datetime('now', ?), provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(retryCount, `+${delayMinutes} minutes`, reason, shipment.id, shipment.client_id).run();
        continue;
      }
      await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'failed', provider_booking_payload_json = NULL, provider_retry_at = NULL, provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(reason, shipment.id, shipment.client_id).run();
      await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'exception', ?, 'system:delhivery-retry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipment.id, `Queued Delhivery booking failed: ${reason}`).run();
      const billing = await env.DB.prepare("SELECT amount, status FROM billing_records WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(shipment.id, shipment.client_id).first<{ amount: number; status: string }>();
      if (billing?.status === "paid" && Number(billing.amount) > 0) {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, 'credit', ?, ?, 'posted', 0)").bind(crypto.randomUUID(), shipment.client_id, Number(billing.amount), `REVERSAL-${shipment.id}`),
          env.DB.prepare("UPDATE billing_records SET status = 'void', updated_at = CURRENT_TIMESTAMP WHERE shipment_id = ? AND client_id = ?").bind(shipment.id, shipment.client_id),
        ]);
        await recalculateWalletBalances(env, shipment.client_id);
      }
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message.slice(0, 500) : "queued_booking_retry_failed";
      const retryCount = Number(shipment.provider_retry_count ?? 0) + 1;
      await env.DB.prepare("UPDATE shipments SET provider_retry_count = ?, provider_retry_at = datetime('now', '+15 minutes'), provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(retryCount, reason, shipment.id, shipment.client_id).run();
    }
  }
}

async function reconcilePendingDelhiveryReferences(env: Env, cron: string) {
  // A provider job can be accepted while the original request still ends in
  // a local exception (for example, after a persistence error). Keep polling
  // any reference-less accepted job, regardless of the local display status;
  // otherwise it becomes permanently stranded and can never receive its LR.
  const pending = await env.DB.prepare("SELECT id, client_id, provider_account_id, provider_booking_id FROM shipments WHERE provider = 'delhivery' AND provider_booking_id IS NOT NULL AND COALESCE(lr_number, master_awb, provider_reference, '') = '' AND (status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery') OR (status = 'exception' AND provider_sync_status IN ('pending', 'failed'))) ORDER BY updated_at ASC LIMIT 20").all<{ id: string; client_id: string; provider_account_id: string | null; provider_booking_id: string }>();
  for (const shipment of pending.results) {
    try {
      await safeProviderRequest(env, "delhivery", "shipment_status", { shipment_id: shipment.id, provider_booking_id: shipment.provider_booking_id, provider_account_id: shipment.provider_account_id }, `cron:${cron}:delhivery-reference:${shipment.id}`, shipment.client_id, undefined, 10000);
    } catch (caught) {
      console.error(JSON.stringify({ job: "delhivery_reference_reconciliation", shipment_id: shipment.id, error: caught instanceof Error ? caught.message : "unknown_error" }));
    }
  }
  if (pending.results.length) console.log(JSON.stringify({ job: "delhivery_reference_reconciliation", candidates: pending.results.length }));
}
async function verifyWebhook(request: Request, env: Env, provider: "delhivery" | "ekart" | "trackon", rawBody: string) {
  const secret = provider === "delhivery" ? env.DELHIVERY_WEBHOOK_SECRET : provider === "ekart" ? env.EKART_WEBHOOK_SECRET : (env as unknown as Record<string, unknown>).TRACKON_WEBHOOK_SECRET as string | undefined;
  if (!secret) return false;
  const tokenHeader = provider === "delhivery" ? request.headers.get("X-Delhivery-Webhook-Token") ?? request.headers.get("X-Webhook-Token") : provider === "trackon" ? request.headers.get("X-Trackon-Webhook-Token") ?? request.headers.get("X-Webhook-Token") : null;
  if (tokenHeader && timingSafeEqual(tokenHeader.trim(), secret.trim())) return true;
  const provided = request.headers.get("X-Webhook-Signature") ?? request.headers.get("X-Signature") ?? "";
  if (!provided) return false;
  return timingSafeEqual(provided.replace(/^sha256=/, ""), await hmac(secret, rawBody));
}

function rivigoWebhookCredentials(env: Env) {
  if (!env.RIVIGO_CREDENTIALS_JSON) return null;
  try {
    const value = JSON.parse(env.RIVIGO_CREDENTIALS_JSON) as Record<string, unknown>;
    const appUuid = String(value.appUuid ?? value.app_uuid ?? value.uuid ?? "").trim();
    const appSecret = String(value.appSecret ?? value.app_secret ?? value.secret ?? "").trim();
    return appUuid && appSecret ? { appUuid, appSecret } : null;
  } catch { return null; }
}

async function verifyRivigoWebhook(request: Request, env: Env, rawBody: string, payload: Record<string, unknown>) {
  const secret = env.RIVIGO_WEBHOOK_SECRET?.trim();
  if (secret) {
    const token = request.headers.get("X-Rivigo-Webhook-Token") ?? request.headers.get("X-Webhook-Token");
    if (token && timingSafeEqual(token.trim(), secret)) return true;
    const provided = request.headers.get("X-Webhook-Signature") ?? request.headers.get("X-Signature") ?? "";
    if (provided && timingSafeEqual(provided.replace(/^sha256=/, ""), await hmac(secret, rawBody))) return true;
    return false;
  }
  // Rivigo's portal form does not expose a signing-secret field. In that mode,
  // accept only events addressed to the configured app UUID. A signing secret
  // can still be added later when the provider or a proxy supports one.
  const credentials = rivigoWebhookCredentials(env);
  const appUuid = String(payload.AppUuid ?? payload.appUuid ?? payload.app_uuid ?? "").trim();
  return Boolean(credentials?.appUuid && appUuid && timingSafeEqual(appUuid, credentials.appUuid));
}

function rivigoWebhookDetails(payload: Record<string, unknown>) {
  const metadata = payload.Metadata && typeof payload.Metadata === "object" ? payload.Metadata as Record<string, unknown> : payload.metadata && typeof payload.metadata === "object" ? payload.metadata as Record<string, unknown> : {};
  const eventName = String(payload.EventName ?? payload.eventName ?? payload.event_type ?? payload.type ?? "unknown").trim();
  const event = eventName.toUpperCase();
  const rawStatus = event.includes("CANCELL") ? "cancelled" : event.includes("UNDELIVER") || event.includes("FAILED") ? "exception" : event.includes("RTO") || event.includes("RETURN") ? "rto" : event.includes("DELIVER") && !event.includes("OUT_FOR") ? "delivered" : event.includes("OUT_FOR_DELIVERY") ? "out_for_delivery" : event.includes("PICKUP") && (event.includes("COMPLETE") || event.includes("SUCCESS")) ? "picked_up" : "in_transit";
  const reference = String(metadata.Cnote ?? metadata.cnote ?? payload.Cnote ?? payload.cnote ?? payload.BookingId ?? payload.bookingId ?? payload.booking_id ?? "").trim();
  const location = String(metadata.Location ?? metadata.location ?? metadata.City ?? metadata.city ?? payload.Location ?? payload.location ?? payload.City ?? payload.city ?? "").slice(0, 200);
  const eventTimeValue = payload.EventTimestamp ?? payload.eventTimestamp ?? payload.event_time ?? payload.timestamp;
  return { eventName, rawStatus, reference, location, eventTime: typeof eventTimeValue === "string" ? eventTimeValue : null, description: `Rivigo event ${eventName}`.slice(0, 500) };
}

async function handleRivigoWebhook(request: Request, env: Env, requestIdValue: string, headers: HeadersInit) {
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "Webhook payload is too large", 413, requestIdValue, headers);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return error("INVALID_JSON", "Webhook payload must be valid JSON", 400, requestIdValue, headers); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("VALIDATION_ERROR", "Webhook payload must be an object", 400, requestIdValue, headers);
  if (!await verifyRivigoWebhook(request, env, rawBody, payload)) return error("INVALID_SIGNATURE", "Webhook authentication is invalid", 401, requestIdValue, headers);
  const details = rivigoWebhookDetails(payload);
  const eventId = `rivigo:${String(payload.ReferenceId ?? payload.referenceId ?? details.reference ?? "unknown").trim()}:${await sha256(rawBody).then((value) => value.slice(0, 16))}`;
  const stored = await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (id, provider, event_id, event_type, payload, signature_valid, status) VALUES (?, 'rivigo', ?, ?, ?, 1, 'received')").bind(crypto.randomUUID(), eventId, details.eventName, rawBody).run();
  if (Number(stored.meta?.changes ?? 0) === 0) return json({ ok: true, accepted: true, duplicate: true, request_id: requestIdValue }, 202, headers);
  const shipment = details.reference ? await env.DB.prepare("SELECT id, status FROM shipments WHERE id = ? OR tracking_number = ? OR provider_reference = ? LIMIT 1").bind(details.reference, details.reference, details.reference).first<{ id: string; status: string }>() : null;
  if (!shipment || !validShipmentTransition(String(shipment.status).toLowerCase(), details.rawStatus)) return json({ ok: true, accepted: true, matched: Boolean(shipment), applied: false, request_id: requestIdValue }, 202, headers);
  const deliveredAt = details.rawStatus === "delivered" ? new Date().toISOString() : null;
  await env.DB.prepare("UPDATE shipments SET provider = 'rivigo', provider_reference = COALESCE(?, provider_reference), status = ?, delivered_at = COALESCE(?, delivered_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(details.reference || null, details.rawStatus, deliveredAt, shipment.id).run();
  await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipment.id, details.rawStatus, details.location, details.description, "webhook:rivigo", details.eventTime).run();
  await env.DB.prepare("UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE provider = 'rivigo' AND event_id = ?").bind(eventId).run();
  return json({ ok: true, accepted: true, matched: true, applied: true, request_id: requestIdValue }, 202, headers);
}

function delhiveryWebhookDetails(payload: Record<string, unknown>) {
  const shipment = payload.Shipment && typeof payload.Shipment === "object" ? payload.Shipment as Record<string, unknown> : payload.shipment && typeof payload.shipment === "object" ? payload.shipment as Record<string, unknown> : payload;
  const pickupDetails = payload.Pickup && typeof payload.Pickup === "object" ? payload.Pickup as Record<string, unknown> : payload.pickup && typeof payload.pickup === "object" ? payload.pickup as Record<string, unknown> : {};
  const statusObject = shipment.Status && typeof shipment.Status === "object" ? shipment.Status as Record<string, unknown> : shipment.status && typeof shipment.status === "object" ? shipment.status as Record<string, unknown> : {};
  const rawStatus = typeof shipment.Status === "string" ? shipment.Status : statusObject.Status ?? statusObject.status ?? shipment.status ?? payload.status ?? payload.event_type;
  const reference = String(shipment.AWB ?? shipment.awb ?? shipment.waybill ?? shipment.Waybill ?? shipment.ReferenceNo ?? shipment.reference_no ?? pickupDetails.PickupId ?? pickupDetails.pickup_id ?? pickupDetails.PickupID ?? pickupDetails.pickupId ?? pickupDetails.PUR ?? pickupDetails.pur ?? pickupDetails.reference ?? payload.PickupId ?? payload.pickup_id ?? payload.PickupID ?? payload.pickupId ?? payload.PUR ?? payload.pur ?? payload.pickup_reference ?? payload.pickupReference ?? payload.awb ?? payload.waybill ?? payload.tracking_number ?? payload.provider_reference ?? payload.shipment_id ?? "").trim();
  const dateCandidate = findProviderReference(payload, new Set(["pickup_date", "pickupDate", "scheduled_date", "scheduledDate", "pickup_scheduled_date"]));
  const dateMatch = dateCandidate?.match(/(\d{4}-\d{2}-\d{2})/);
  const requestedDate = dateMatch && validPickupDate(dateMatch[1]) ? dateMatch[1] : null;
  const requestedTimeSlot = findProviderReference(payload, new Set(["pickup_time", "pickupTime", "start_time", "startTime", "time_slot", "timeSlot", "pickup_window", "pickupWindow", "requested_time_slot"]));
  return {
    reference,
    rawStatus,
    requestedDate,
    requestedTimeSlot: requestedTimeSlot?.slice(0, 80) || null,
    description: String(statusObject.Instructions ?? statusObject.description ?? shipment.Instructions ?? shipment.description ?? payload.description ?? payload.message ?? "Delhivery status update").slice(0, 500),
    location: String(statusObject.StatusLocation ?? statusObject.location ?? shipment.StatusLocation ?? shipment.location ?? payload.location ?? payload.city ?? "").slice(0, 200),
    eventTime: typeof (statusObject.StatusDateTime ?? shipment.StatusDateTime ?? payload.event_time ?? payload.timestamp) === "string" ? String(statusObject.StatusDateTime ?? shipment.StatusDateTime ?? payload.event_time ?? payload.timestamp) : null,
  };
}

function pickupStatusFromProviderEvent(rawStatus: unknown) {
  const value = String(rawStatus ?? "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (!value) return null;
  // Check the negative pickup state before the generic "picked" substring.
  // Otherwise Delhivery's "Not Picked" is incorrectly stored as picked_up.
  if (value.includes("not_picked") || value.includes("not_collected") || value.includes("pickup_not_done")) return "not_picked";
  if (value.includes("reschedul")) return "rescheduled";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("fail") || value.includes("exception") || value.includes("reject") || value.includes("undeliver")) return "failed";
  if (value.includes("picked") || value.includes("pickup_complete") || value.includes("collected")) return "picked_up";
  if (value.includes("driver") || value.includes("assign") || value.includes("en_route") || value.includes("out_for_pickup")) return value.includes("en_route") || value.includes("out_for_pickup") ? "en_route" : "driver_assigned";
  if (value.includes("schedule") || value.includes("manifest") || value.includes("book") || value.includes("accept") || value.includes("confirm")) return "scheduled";
  return null;
}

async function reconcileShipmentLinkedPickupStatuses(env: Env, cron: string) {
  const rows = await env.DB.prepare(`
    SELECT pr.id, pr.client_id, pr.status, pr.provider_status,
      COUNT(DISTINCT s.id) AS expected_count,
      COUNT(DISTINCT CASE WHEN s.status IN ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') THEN s.id END) AS picked_count,
      COUNT(DISTINCT CASE WHEN s.status = 'delivered' THEN s.id END) AS delivered_count,
      COUNT(DISTINCT CASE WHEN s.status IN ('exception', 'rto', 'cancelled') THEN s.id END) AS failed_count,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tracking_events te
        WHERE te.shipment_id = s.id
          AND (
            lower(COALESCE(te.description, '') || ' ' || COALESCE(te.status, '')) LIKE '%out for pickup%'
            OR lower(COALESCE(te.description, '') || ' ' || COALESCE(te.status, '')) LIKE '%out_for_pickup%'
            OR lower(COALESCE(te.description, '') || ' ' || COALESCE(te.status, '')) LIKE '%out-for-pickup%'
            OR lower(COALESCE(te.description, '') || ' ' || COALESCE(te.status, '')) LIKE '%driver assigned%'
            OR lower(COALESCE(te.description, '') || ' ' || COALESCE(te.status, '')) LIKE '%en route%'
          )
      ) THEN s.id END) AS en_route_count
    FROM pickup_requests pr
    LEFT JOIN shipments s ON s.id = pr.shipment_id OR EXISTS (
      SELECT 1 FROM pickup_request_shipments prs WHERE prs.pickup_id = pr.id AND prs.shipment_id = s.id
    )
    WHERE pr.provider = 'delhivery' AND pr.status NOT IN ('cancelled', 'completed', 'failed')
    GROUP BY pr.id, pr.client_id, pr.status, pr.provider_status
    ORDER BY pr.updated_at ASC LIMIT 75
  `).all<{ id: string; client_id: string; status: string; provider_status: string | null; expected_count: number; picked_count: number; delivered_count: number; failed_count: number; en_route_count: number }>();
  for (const pickup of rows.results) {
    const expectedCount = Math.max(0, Number(pickup.expected_count ?? 0));
    const pickedCount = Math.max(0, Number(pickup.picked_count ?? 0));
    const deliveredCount = Math.max(0, Number(pickup.delivered_count ?? 0));
    const failedCount = Math.max(0, Number(pickup.failed_count ?? 0));
    const enRouteCount = Math.max(0, Number(pickup.en_route_count ?? 0));
    const nextStatus = expectedCount > 0 && deliveredCount === expectedCount
      ? 'completed'
      : pickedCount > 0
        ? 'picked_up'
        : enRouteCount > 0
          ? 'en_route'
        : failedCount === expectedCount && expectedCount > 0
          ? 'failed'
          : pickup.status;
    const detail = pickedCount > 0
      ? `Delhivery linked shipments: ${pickedCount}/${expectedCount} picked`
      : enRouteCount > 0
        ? `Delhivery linked shipments: ${enRouteCount}/${expectedCount} out for pickup`
      : failedCount > 0
        ? `Delhivery linked shipments: ${failedCount}/${expectedCount} failed or cancelled`
        : 'Delhivery has not reported a pickup scan for the linked shipments';
    await env.DB.prepare("UPDATE pickup_requests SET status = ?, provider_picked_count = ?, provider_expected_count = ?, provider_status_synced_at = CURRENT_TIMESTAMP, provider_status_detail = ?, provider_status = COALESCE(NULLIF(provider_status, ''), 'delhivery:linked_shipments'), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
      .bind(nextStatus, pickedCount, expectedCount, detail, pickup.id, pickup.client_id).run();
  }
  if (rows.results.length) console.log(JSON.stringify({ job: "pickup_status_reconciliation", cron, candidates: rows.results.length }));
}

async function refreshDelhiveryPickupStatuses(env: Env, cron: string) {
  // B2B pickup status is represented by the linked shipment movement events.
  // The One web-console endpoint below is not a supported B2B API route and
  // returns 403 for B2B credentials. Exclude B2B requests from this poll so a
  // bad endpoint cannot overwrite or obscure the linked-shipment truth.
  const rows = await env.DB.prepare(`
    SELECT id, client_id, provider_reference, status
    FROM pickup_requests pr
    LEFT JOIN provider_accounts pa ON pa.id = pr.provider_account_id
    WHERE pr.provider = 'delhivery'
      AND (pa.id IS NULL OR lower(COALESCE(pa.account_name, '')) NOT LIKE '%b2b%')
      AND pr.provider_reference IS NOT NULL
      AND pr.status NOT IN ('cancelled', 'completed', 'failed')
    ORDER BY pr.updated_at ASC
    LIMIT 75
  `).all<{ id: string; client_id: string; provider_reference: string; status: string }>();
  let updated = 0;
  let failed = 0;
  for (const pickup of rows.results) {
    const result = await providerRequest(
      env,
      "delhivery",
      "pickup_status",
      { pickup_id: pickup.provider_reference },
      `cron:pickup-status:${pickup.id}`,
      pickup.client_id,
    ) as Record<string, unknown>;
    if (result.status !== "accepted") { failed += 1; continue; }
    const nextStatus = typeof result.pickupStatus === "string" ? result.pickupStatus : null;
    if (!nextStatus) continue;
    const detail = String(result.providerStatusDetail ?? `Delhivery pickup status: ${nextStatus}`).slice(0, 500);
    await env.DB.prepare(`
      UPDATE pickup_requests
      SET status = ?, provider_status = ?, provider_status_synced_at = CURRENT_TIMESTAMP,
          provider_status_detail = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND client_id = ?
    `).bind(nextStatus, `delhivery:${String(result.providerStatusDetail ?? nextStatus).toLowerCase().replace(/\s+/g, "_").slice(0, 120)}`, detail, pickup.id, pickup.client_id).run();
    if (nextStatus !== pickup.status) updated += 1;
  }
  if (rows.results.length) console.log(JSON.stringify({ job: "delhivery_pickup_status_poll", cron, candidates: rows.results.length, updated, failed }));
}

function delhiveryDocumentUrl(payload: Record<string, unknown>) {
  const value = payload.DocumentUrl ?? payload.DocumentURL ?? payload.document_url ?? payload.documentUrl ?? (payload.Document && typeof payload.Document === "object" ? (payload.Document as Record<string, unknown>).url : undefined);
  return typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : null;
}

function delhiveryDocumentContentType(url: URL, response: Response) {
  const responseType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (responseType === "application/pdf" || responseType === "image/jpeg" || responseType === "image/png" || responseType === "image/webp") return responseType;
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith(".pdf")) return "application/pdf";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  return null;
}

function bytesFromBase64(value: string) {
  const normalized = value.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) return null;
  try {
    const decoded = atob(normalized);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function persistDelhiveryPod(env: Env, clientId: string, shipmentId: string, trackingNumber: string, artifact: unknown, responseBytes: Uint8Array | null, response: Response, requestIdValue: string) {
  const existing = await env.DB.prepare("SELECT id FROM shipment_documents WHERE shipment_id = ? AND lower(original_filename) LIKE 'delhivery-pod-%' ORDER BY created_at DESC LIMIT 1").bind(shipmentId).first<{ id: string }>();
  if (existing) return { stored: false, document_id: existing.id, reason: "already_exists" };
  let bytes = responseBytes;
  let contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!bytes || contentType.includes("json")) {
    const base64 = findProviderContentBase64(artifact);
    bytes = base64 ? bytesFromBase64(base64) : null;
    contentType = findProviderToken(artifact, new Set(["content_type", "contentType", "mime_type", "mimeType"]))?.toLowerCase().split(";", 1)[0].trim() ?? contentType;
  }
  if (!bytes || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(contentType) || !documentSignatureMatches(contentType, bytes)) {
    console.warn(JSON.stringify({ request_id: requestIdValue, shipment_id: shipmentId, pod_persist: "invalid_provider_document" }));
    return { stored: false, reason: "invalid_provider_document" };
  }
  const documentId = crypto.randomUUID();
  const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const objectKey = `clients/${clientId}/shipments/${shipmentId}/${documentId}-delhivery-pod.${extension}`;
  await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare("INSERT INTO shipment_documents (id, shipment_id, client_id, object_key, original_filename, content_type, file_size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(documentId, shipmentId, clientId, objectKey, `delhivery-pod-${trackingNumber}.${extension}`, contentType, bytes.byteLength, "automation:delhivery:fujiyama").run();
  } catch (caught) {
    await env.FILES.delete(objectKey).catch(() => undefined);
    throw caught;
  }
  return { stored: true, document_id: documentId };
}

function delhiveryLabelCallbackSize(payload: Record<string, unknown>, fallback: string) {
  const raw = String(findProviderToken(payload, new Set(["label_size", "labelSize", "size", "format", "label_format"])) ?? fallback).trim().toLowerCase().replace(/[×* ]/g, "x");
  if (raw === "a4") return "a4";
  if (raw === "sm") return fallback === "4x2" || fallback === "3x2" ? fallback : "3x2";
  if (raw === "md") return fallback === "4x2.5" ? fallback : "4x2.5";
  if (raw === "3x2") return "3x2";
  if (raw === "4x2.5") return "4x2.5";
  if (raw === "4x2") return "4x2";
  return fallback;
}

function delhiveryCallbackAssetAllowed(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "delhivery.com" || host.endsWith(".delhivery.com") || host.endsWith(".delhivery.co.in") || host.endsWith(".delhivery.net");
  } catch { return false; }
}

async function handleDelhiveryLabelWebhook(request: Request, env: Env, requestIdValue: string, headers: HeadersInit) {
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "Label callback payload is too large", 413, requestIdValue, headers);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return error("INVALID_JSON", "Label callback payload must be valid JSON", 400, requestIdValue, headers); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("VALIDATION_ERROR", "Label callback payload must be an object", 400, requestIdValue, headers);
  const callbackAuthorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const token = new URL(request.url).searchParams.get("token")?.trim() || callbackAuthorization;
  if (!token) return error("INVALID_CALLBACK", "Label callback token is required", 401, requestIdValue, headers);
  const callback = await env.DB.prepare("SELECT token, shipment_id, client_id, label_size FROM delhivery_label_callback_tokens WHERE token = ? AND datetime(expires_at) > CURRENT_TIMESTAMP LIMIT 1").bind(token).first<{ token: string; shipment_id: string; client_id: string; label_size: string }>();
  if (!callback) return error("INVALID_CALLBACK", "Label callback token is invalid or expired", 401, requestIdValue, headers);
  const reference = findProviderReference(payload, new Set(["lrn", "lrn_number", "lr_number", "lr", "awb", "awb_number", "waybill", "tracking_number", "provider_reference"]));
  const jobId = findProviderReference(payload, new Set(["job_id", "jobid", "request_id", "requestid"]));
  const eventId = `delhivery:label:${callback.token}:${jobId ?? "callback"}:${await sha256(rawBody).then((value) => value.slice(0, 16))}`;
  const stored = await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (id, provider, event_id, event_type, payload, signature_valid, status) VALUES (?, 'delhivery', ?, 'label_generated', ?, 1, 'received')").bind(crypto.randomUUID(), eventId, rawBody).run();
  if (Number(stored.meta?.changes ?? 0) === 0) return json({ ok: true, accepted: true, duplicate: true, request_id: requestIdValue }, 202, headers);
  const size = delhiveryLabelCallbackSize(payload, callback.label_size);
  const urls = findProviderUrls(payload).filter(delhiveryCallbackAssetAllowed);
  const base64 = findProviderContentBase64(payload);
  const shipment = await env.DB.prepare("SELECT lr_number, provider_account_id FROM shipments WHERE id = ? LIMIT 1").bind(callback.shipment_id).first<{ lr_number: string | null; provider_account_id: string | null }>();
  const effectiveReference = reference ?? shipment?.lr_number ?? null;
  const account = await env.DB.prepare("SELECT pa.account_name, pa.credential_secret_name FROM provider_accounts pa JOIN shipments s ON s.provider_account_id = pa.id WHERE s.id = ? AND pa.provider = 'delhivery' LIMIT 1").bind(callback.shipment_id).first<{ account_name: string; credential_secret_name: string }>();
  const credential = account ? (env as unknown as Record<string, unknown>)[account.credential_secret_name] as string | undefined : undefined;
  const tokenValue = account ? await delhiveryB2bBearer(env, credential, account.account_name, requestIdValue, 8000, false, delhiveryB2bDocsBase()) : null;
  const assets: Array<{ bytes: Uint8Array; contentType: string }> = [];
  if (base64) { const bytes = bytesFromBase64(base64); if (bytes && documentSignatureMatches("application/pdf", bytes)) assets.push({ bytes, contentType: "application/pdf" }); }
  for (const url of urls.slice(0, 32)) {
    try {
      const response = await providerFetch(url, { method: "GET", headers: { accept: "application/pdf", ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {}) } }, 10000);
      if (!response.ok) continue;
      const bytes = await providerResponseBytes(response, 12 * 1024 * 1024);
      const contentType = providerContentTypeFromBytes(bytes, response.headers.get("content-type") ?? "application/pdf");
      if (contentType === "application/pdf" && documentSignatureMatches(contentType, bytes)) assets.push({ bytes, contentType });
    } catch { /* Keep processing other provider assets. */ }
  }
  if (!assets.length && effectiveReference && tokenValue) {
    try {
      const labelResponse = await providerFetch(`${delhiveryB2bDocsBase()}/v2/get-label-urls/${encodeURIComponent(delhiveryLabelApiSize(size))}/${encodeURIComponent(effectiveReference)}`, { method: "GET", headers: { accept: "application/json", Authorization: `Bearer ${tokenValue}` } }, 10000);
      if (labelResponse.ok) {
        let labelPayload: unknown = null;
        try {
          const labelBody = await providerResponseText(labelResponse, 10000);
          try { labelPayload = JSON.parse(labelBody); } catch { labelPayload = labelBody.trim() || null; }
        } catch { labelPayload = null; }
        for (const url of findProviderUrls(labelPayload, [], 0, "", labelResponse.url).filter(delhiveryCallbackAssetAllowed).slice(0, 32)) {
          const response = await providerFetch(url, { method: "GET", headers: { accept: "application/pdf", Authorization: `Bearer ${tokenValue}` } }, 10000);
          if (!response.ok) continue;
          const bytes = await providerResponseBytes(response, 12 * 1024 * 1024);
          const contentType = providerContentTypeFromBytes(bytes, response.headers.get("content-type") ?? "application/pdf");
          if (contentType === "application/pdf" && documentSignatureMatches(contentType, bytes)) assets.push({ bytes, contentType });
        }
      }
    } catch { /* The client can retry while the provider finishes publishing URLs. */ }
  }
  for (let index = 0; index < assets.length; index += 1) {
    const filename = `delhivery-label-${effectiveReference ?? callback.shipment_id}-${size}-${index + 1}.pdf`;
    const existing = await env.DB.prepare("SELECT id FROM shipment_documents WHERE shipment_id = ? AND original_filename = ? LIMIT 1").bind(callback.shipment_id, filename).first<{ id: string }>();
    if (existing) continue;
    const documentId = crypto.randomUUID();
    const objectKey = `clients/${callback.client_id}/shipments/${callback.shipment_id}/${documentId}-${filename}`;
    await env.FILES.put(objectKey, assets[index].bytes, { httpMetadata: { contentType: assets[index].contentType } });
    try {
      await env.DB.prepare("INSERT INTO shipment_documents (id, shipment_id, client_id, object_key, original_filename, content_type, file_size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(documentId, callback.shipment_id, callback.client_id, objectKey, filename, assets[index].contentType, assets[index].bytes.byteLength, "webhook:delhivery:label").run();
    } catch (caught) { await env.FILES.delete(objectKey).catch(() => undefined); throw caught; }
  }
  await env.DB.prepare("UPDATE delhivery_label_callback_tokens SET expires_at = datetime('now', '+10 minutes') WHERE token = ?").bind(callback.token).run();
  await env.DB.prepare("UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE provider = 'delhivery' AND event_id = ?").bind(eventId).run();
  console.log(JSON.stringify({ event: "delhivery_label_callback", request_id: requestIdValue, shipment_id: callback.shipment_id, reference: effectiveReference, size, urls: urls.length, assets: assets.length }));
  return json({ ok: true, accepted: true, matched: true, saved: assets.length, request_id: requestIdValue }, 202, headers);
}

async function loadStoredDelhiveryLabels(env: Env, shipmentId: string, reference: string, size: string) {
  const rows = await env.DB.prepare("SELECT object_key, content_type FROM shipment_documents WHERE shipment_id = ? AND original_filename LIKE ? ORDER BY original_filename ASC LIMIT 32").bind(shipmentId, `delhivery-label-${reference}-${size}-%`).all<{ object_key: string; content_type: string }>();
  const artifacts: Array<{ content_base64: string; content_type: string }> = [];
  for (const row of rows.results) {
    const object = await env.FILES.get(row.object_key);
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (row.content_type === "application/pdf" && documentSignatureMatches(row.content_type, bytes)) artifacts.push({ content_base64: providerBytesToBase64(bytes), content_type: row.content_type });
  }
  return artifacts;
}

async function handleProviderWebhook(request: Request, env: Env, provider: "delhivery" | "ekart" | "trackon", requestIdValue: string, headers: HeadersInit) {
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "Webhook payload is too large", 413, requestIdValue, headers);
  if (!await verifyWebhook(request, env, provider, rawBody)) return error("INVALID_SIGNATURE", "Webhook signature is invalid", 401, requestIdValue, headers);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return error("INVALID_JSON", "Webhook payload must be valid JSON", 400, requestIdValue, headers); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("VALIDATION_ERROR", "Webhook payload must be an object", 400, requestIdValue, headers);
  const delhiveryDetails = provider === "delhivery" ? delhiveryWebhookDetails(payload) : null;
  const suppliedEventId = String(payload.event_id ?? payload.id ?? delhiveryDetails?.reference ?? payload.AWBNo ?? payload.awb ?? payload.waybill ?? "").trim();
  const eventId = suppliedEventId ? `${provider}:${suppliedEventId}:${await sha256(rawBody).then((value) => value.slice(0, 16))}` : `${provider}:${await sha256(rawBody)}`;
  const stored = await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (id, provider, event_id, event_type, payload, signature_valid, status) VALUES (?, ?, ?, ?, ?, 1, 'received')").bind(crypto.randomUUID(), provider, eventId, String(payload.event_type ?? payload.status ?? "unknown"), rawBody).run();
  if (Number(stored.meta?.changes ?? 0) > 0) {
    const reference = delhiveryDetails?.reference ?? String(payload.tracking_number ?? payload.AWBNo ?? payload.awb ?? payload.waybill ?? payload.provider_reference ?? payload.shipment_id ?? "").trim();
    const status = normalizeProviderShipmentStatus(delhiveryDetails?.rawStatus ?? payload.status ?? payload.current_status ?? payload.event_type);
    const description = delhiveryDetails?.description ?? String(payload.description ?? payload.message ?? `Webhook event ${eventId}`); const location = delhiveryDetails?.location ?? String(payload.location ?? payload.city ?? "");
    const shipment = reference ? await env.DB.prepare("SELECT id FROM shipments WHERE id = ? OR tracking_number = ? OR provider_reference = ? LIMIT 1").bind(reference, reference, reference).first<{ id: string }>() : null;
     const pickupStatus = provider === "delhivery" ? pickupStatusFromProviderEvent(delhiveryDetails?.rawStatus ?? payload.status ?? payload.event_type) : null;
     const pickup = provider === "delhivery" && reference ? await env.DB.prepare(`
       SELECT pr.id, pr.shipment_id
       FROM pickup_requests pr
       WHERE pr.provider = 'delhivery'
         AND (
           pr.provider_reference = ? OR pr.provider_request_id = ? OR pr.id = ?
           OR pr.shipment_id = ?
           OR EXISTS (SELECT 1 FROM pickup_request_shipments prs WHERE prs.pickup_id = pr.id AND prs.shipment_id = ?)
         )
       LIMIT 1
     `).bind(reference, reference, reference, shipment?.id ?? null, shipment?.id ?? null).first<{ id: string; shipment_id: string | null }>() : null;
     if (pickupStatus && pickup) {
       await env.DB.prepare("UPDATE pickup_requests SET status = ?, provider_status = ?, provider_reference = COALESCE(provider_reference, ?), requested_date = COALESCE(?, requested_date), requested_time_slot = COALESCE(?, requested_time_slot), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('requested', 'provider_pending', 'scheduled', 'driver_assigned', 'en_route', 'rescheduled')")
         .bind(pickupStatus, String(delhiveryDetails?.rawStatus ?? payload.status ?? payload.event_type ?? ""), reference || null, delhiveryDetails?.requestedDate ?? null, delhiveryDetails?.requestedTimeSlot ?? null, pickup.id)
         .run();
     }
    if (shipment) {
      const current = await env.DB.prepare("SELECT status FROM shipments WHERE id = ? LIMIT 1").bind(shipment.id).first<{ status: string }>();
      if (!current || !validShipmentTransition(String(current.status).toLowerCase(), status)) {
        // Provider events can arrive out of order. They are authenticated and
        // matched, but must remain available for reconciliation rather than
        // being presented as rejected or silently discarded.
        await env.DB.prepare("UPDATE webhook_events SET status = 'received', processed_at = NULL WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
        return json({ ok: true, accepted: true, matched: true, applied: false, request_id: requestIdValue }, 202, headers);
      }
      const deliveredAt = status.includes("deliver") ? new Date().toISOString() : null;
      await env.DB.prepare("UPDATE shipments SET provider = ?, provider_reference = COALESCE(?, provider_reference), status = ?, delivered_at = COALESCE(?, delivered_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(provider, reference || null, status, deliveredAt, shipment.id).run();
      await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipment.id, status, location, description, `webhook:${provider}`, delhiveryDetails?.eventTime ?? null).run();
       if (provider === "delhivery") {
         if (pickupStatus && !pickup) {
          await env.DB.prepare("UPDATE pickup_requests SET status = ?, provider_status = ?, provider_reference = COALESCE(provider_reference, ?), requested_date = COALESCE(?, requested_date), requested_time_slot = COALESCE(?, requested_time_slot), updated_at = CURRENT_TIMESTAMP WHERE shipment_id = ? AND provider = 'delhivery' AND status IN ('requested', 'provider_pending', 'scheduled', 'driver_assigned', 'en_route', 'rescheduled')")
            .bind(pickupStatus, String(delhiveryDetails?.rawStatus ?? payload.status ?? payload.event_type ?? ""), reference || null, delhiveryDetails?.requestedDate ?? null, delhiveryDetails?.requestedTimeSlot ?? null, shipment.id)
            .run();
        }
      }
      await env.DB.prepare("UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
    } else if (pickup) {
      await env.DB.prepare("UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
      return json({ ok: true, accepted: true, matched: true, applied: Boolean(pickupStatus), request_id: requestIdValue }, 200, headers);
    } else {
      // The event is authenticated and accepted, but cannot be applied until a
      // matching local shipment exists. Keep it received for reconciliation.
      await env.DB.prepare("UPDATE webhook_events SET status = 'received', processed_at = NULL WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
      return json({ ok: true, accepted: true, matched: false, request_id: requestIdValue }, 202, headers);
    }
  }
  return json({ ok: true, accepted: true, request_id: requestIdValue }, 202, headers);
}

async function handleDelhiveryDocumentWebhook(request: Request, env: Env, requestIdValue: string, headers: HeadersInit) {
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "Webhook payload is too large", 413, requestIdValue, headers);
  if (!await verifyWebhook(request, env, "delhivery", rawBody)) return error("INVALID_SIGNATURE", "Webhook signature is invalid", 401, requestIdValue, headers);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return error("INVALID_JSON", "Webhook payload must be valid JSON", 400, requestIdValue, headers); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("VALIDATION_ERROR", "Webhook payload must be an object", 400, requestIdValue, headers);
  const reference = String(payload.AWB ?? payload.awb ?? payload.Waybill ?? payload.waybill ?? payload.tracking_number ?? payload.provider_reference ?? payload.shipment_id ?? "").trim();
  const eventId = `delhivery:document:${reference || "unknown"}:${await sha256(rawBody).then((value) => value.slice(0, 16))}`;
  const stored = await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (id, provider, event_id, event_type, payload, signature_valid, status) VALUES (?, 'delhivery', ?, ?, ?, 1, 'received')").bind(crypto.randomUUID(), eventId, String(payload.document_type ?? payload.type ?? "document"), rawBody).run();
  let documentStored = false;
  if (Number(stored.meta?.changes ?? 0) > 0) {
    const shipment = reference ? await env.DB.prepare("SELECT id, client_id FROM shipments WHERE id = ? OR tracking_number = ? OR provider_reference = ? LIMIT 1").bind(reference, reference, reference).first<{ id: string; client_id: string }>() : null;
    const documentUrl = delhiveryDocumentUrl(payload);
    if (shipment && documentUrl) {
      try {
        const parsedUrl = new URL(documentUrl);
        const allowedHost = parsedUrl.hostname === "delhivery.com" || parsedUrl.hostname.endsWith(".delhivery.com") || parsedUrl.hostname.endsWith(".delhivery.co.in") || parsedUrl.hostname.endsWith(".delhivery.net");
        if (!allowedHost) throw new Error("document_host_not_allowed");
        const response = await providerFetch(parsedUrl, { method: "GET", headers: { accept: "application/pdf,image/*", ...(env.DELHIVERY_API_TOKEN ? { Authorization: `Token ${env.DELHIVERY_API_TOKEN}` } : {}) } }, 8000);
        if (!response.ok) throw new Error(`document_fetch_failed_${response.status}`);
        const bytes = await providerResponseBytes(response, 10 * 1024 * 1024);
        const contentType = delhiveryDocumentContentType(parsedUrl, response);
        if (!contentType || !documentSignatureMatches(contentType, bytes)) throw new Error("document_type_or_signature_invalid");
        const documentId = crypto.randomUUID();
        const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
        const objectKey = `clients/${shipment.client_id}/shipments/${shipment.id}/${documentId}-delhivery-pod.${extension}`;
        await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType } });
        try {
          await env.DB.prepare("INSERT INTO shipment_documents (id, shipment_id, client_id, object_key, original_filename, content_type, file_size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(documentId, shipment.id, shipment.client_id, objectKey, `delhivery-pod-${reference || shipment.id}.${extension}`, contentType, bytes.byteLength, "webhook:delhivery").run();
        } catch (caught) {
          await env.FILES.delete(objectKey).catch(() => undefined);
          throw caught;
        }
        documentStored = true;
      } catch (caught) {
        console.error(JSON.stringify({ request_id: requestIdValue, route: "/v1/webhooks/delhivery/documents", provider: "delhivery", error: caught instanceof Error ? caught.message.slice(0, 200) : "document_store_failed" }));
      }
    }
    // A valid provider document event can arrive before the shipment is
    // imported into PSS. Keep it received for reconciliation instead of
    // labelling it ignored; only duplicate or invalid events are rejected.
    await env.DB.prepare("UPDATE webhook_events SET status = ?, processed_at = ? WHERE provider = 'delhivery' AND event_id = ?").bind(shipment && (!documentUrl || documentStored) ? "processed" : "received", shipment && (!documentUrl || documentStored) ? new Date().toISOString() : null, eventId).run();
  }
  return json({ ok: true, accepted: true, document_event: true, document_stored: documentStored, request_id: requestIdValue }, 202, headers);
}

async function refreshDelhiveryShipments(env: Env, cron: string) {
  const columns = "id, client_id, tracking_number, lr_number, provider_reference, provider_account_id";
  // Select in small pages for bounded concurrency, but keep paging through the
  // complete due queue. The old single-query LIMIT 50 meant the scheduler could
  // leave the rest of the eligible fleet untouched indefinitely.
  const order = "ORDER BY CASE status WHEN 'out_for_delivery' THEN 0 WHEN 'in_transit' THEN 1 ELSE 2 END, CASE WHEN provider_last_attempt_at IS NULL THEN 0 ELSE 1 END, provider_last_attempt_at ASC, updated_at ASC LIMIT 50";
  const latestEvent = "(SELECT lower(COALESCE(te.location, '') || ' ' || COALESCE(te.description, '')) FROM tracking_events te WHERE te.shipment_id = shipments.id ORDER BY te.event_time DESC LIMIT 1)";
  // The Worker wakes every 5 minutes, but each shipment is selected only at
  // its state-specific cadence. Last-mile centre scans are identified from
  // the latest normalized provider event without changing the public status.
  const due = `(provider_last_attempt_at IS NULL OR
    (status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'exception', 'rto') AND (edd IS NULL OR weight_override_kg IS NULL) AND datetime(provider_last_attempt_at) <= datetime('now', '-10 minutes')) OR
    (status = 'out_for_delivery' AND datetime(provider_last_attempt_at) <= datetime('now', '-10 minutes')) OR
    (status = 'in_transit' AND datetime(provider_last_attempt_at) <= datetime('now', '-30 minutes')) OR
    (status IN ('booked', 'picked_up', 'cancelled') AND datetime(provider_last_attempt_at) <= datetime('now', '-10 minutes')) OR
    (status IN ('in_transit', 'exception', 'rto') AND NOT (status = 'in_transit' AND ${latestEvent} GLOB '*last[- ]mile*') AND datetime(provider_last_attempt_at) <= datetime('now', '-4 hours'))) `;
  // Delivered shipments are terminal for status polling. Keep their separate
  // POD backfill below, but do not spend tracking calls refreshing them.
  const refreshRows: Array<{ id: string; client_id: string; tracking_number: string | null; lr_number: string | null; provider_reference: string | null; provider_account_id: string | null }> = [];
  let trackingSucceeded = 0;
  let trackingFailed = 0;
  let immediatePodSucceeded = 0;
  let immediatePodFailed = 0;
  const refreshStartedAt = Date.now();
  // Leave a small safety margin for the POD pass and response logging. If the
  // Worker reaches this budget, the next cron invocation continues from the
  // remaining due rows because each attempted shipment receives a new attempt
  // timestamp. There is no fleet-wide 50-record ceiling anymore.
  while (Date.now() - refreshStartedAt < 10000) {
    const active = await env.DB.prepare(`SELECT ${columns} FROM shipments WHERE provider = 'delhivery' AND COALESCE(lr_number, tracking_number, provider_reference) IS NOT NULL AND status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'exception', 'rto', 'cancelled') AND ${due} ${order}`).all<{ id: string; client_id: string; tracking_number: string | null; lr_number: string | null; provider_reference: string | null; provider_account_id: string | null }>();
    if (!active.results.length) break;
    const batch = active.results.slice(0, 3);
    refreshRows.push(...batch);
    const results = await Promise.all(batch.map(async (shipment) => {
      const result = await safeProviderRequest(env, "delhivery", "tracking", { shipment_id: shipment.id, tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: shipment.provider_account_id }, `cron:${cron}:delhivery:tracking:${shipment.id}`, shipment.client_id, undefined, 10000);
      let podStatus: "accepted" | "failed" | null = null;
      // A delivered transition must immediately start POD retrieval. If
      // Delhivery has not published the artifact yet, the delivered shipment
      // remains in the POD backfill queue for the next scheduler run.
      if (result.status === "accepted" && result.normalized_status === "delivered") {
        const pod = await safeProviderRequest(env, "delhivery", "document", { shipment_id: shipment.id, tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: shipment.provider_account_id, doc_type: "LM_POD" }, `cron:${cron}:delhivery:pod:${shipment.id}`, shipment.client_id, undefined, 15000);
        podStatus = pod.status === "accepted" ? "accepted" : "failed";
      }
      return { tracking: result.status === "accepted", pod: podStatus };
    }));
    trackingSucceeded += results.filter((result) => result.tracking).length;
    trackingFailed += results.filter((result) => !result.tracking).length;
    immediatePodSucceeded += results.filter((result) => result.pod === "accepted").length;
    immediatePodFailed += results.filter((result) => result.pod === "failed").length;
  }

  const podCandidates = await env.DB.prepare("SELECT s.id, s.client_id, s.tracking_number, s.lr_number, s.provider_reference, s.provider_account_id FROM shipments s WHERE s.provider = 'delhivery' AND s.status = 'delivered' AND COALESCE(s.lr_number, s.tracking_number, s.provider_reference) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipment_documents d WHERE d.shipment_id = s.id AND lower(d.original_filename) LIKE 'delhivery-pod-%') ORDER BY s.updated_at ASC LIMIT 5").all<{ id: string; client_id: string; tracking_number: string | null; lr_number: string | null; provider_reference: string | null; provider_account_id: string | null }>();
  let podSucceeded = immediatePodSucceeded;
  let podFailed = immediatePodFailed;
  for (let index = 0; index < podCandidates.results.length; index += 3) {
    const batch = podCandidates.results.slice(index, index + 3);
    const results = await Promise.all(batch.map(async (shipment) => {
      const result = await safeProviderRequest(env, "delhivery", "document", { shipment_id: shipment.id, tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: shipment.provider_account_id, doc_type: "LM_POD" }, `cron:${cron}:delhivery:pod:${shipment.id}`, shipment.client_id, undefined, 15000);
      return result.status === "accepted";
    }));
    podSucceeded += results.filter(Boolean).length;
    podFailed += results.filter((value) => !value).length;
  }
  console.log(JSON.stringify({ job: "delhivery_shipments_refresh", cron, tracking_candidates: refreshRows.length, tracking_succeeded: trackingSucceeded, tracking_failed: trackingFailed, pod_candidates: podCandidates.results.length, pod_succeeded: podSucceeded, pod_failed: podFailed }));
}

async function refreshPendingProviderWeights(env: Env, cron: string) {
  // Weight reconciliation has its own bounded queue so status and POD polling
  // cannot starve shipments whose provider measurement has not arrived yet.
  // The provider response is the only source allowed to mark a weight as
  // received; this job never invents or manually overrides a measurement.
  const candidates = await env.DB.prepare(`
    SELECT s.id, s.client_id, s.tracking_number, s.lr_number, s.provider_reference, s.provider_account_id
    FROM shipments s
    LEFT JOIN weight_reconciliations w ON w.shipment_id = s.id AND w.client_id = s.client_id
    WHERE s.provider = 'delhivery'
      AND COALESCE(s.lr_number, s.tracking_number, s.provider_reference) IS NOT NULL
      AND s.status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto')
      AND (w.provider_weight_received_at IS NULL OR s.weight_override_kg IS NULL)
      AND (s.provider_last_attempt_at IS NULL OR datetime(s.provider_last_attempt_at) <= datetime('now', '-5 minutes'))
    ORDER BY CASE WHEN s.provider_last_attempt_at IS NULL THEN 0 ELSE 1 END, s.provider_last_attempt_at ASC, s.updated_at ASC
    LIMIT 20
  `).all<{ id: string; client_id: string; tracking_number: string | null; lr_number: string | null; provider_reference: string | null; provider_account_id: string | null }>();

  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < candidates.results.length; index += 4) {
    const batch = candidates.results.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map((shipment) => safeProviderRequest(
      env,
      "delhivery",
      "tracking",
      { shipment_id: shipment.id, tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: shipment.provider_account_id },
      `cron:${cron}:delhivery:weight:${shipment.id}`,
      shipment.client_id,
      undefined,
      10000,
    )));
    succeeded += results.filter((result) => result.status === "fulfilled" && result.value.status === "accepted").length;
    failed += results.length - results.filter((result) => result.status === "fulfilled" && result.value.status === "accepted").length;
  }
  console.log(JSON.stringify({ job: "delhivery_weight_reconciliation", cron, candidates: candidates.results.length, succeeded, failed }));
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const id = requestId(request);
    const headers = corsHeaders(request, env);
    if (!originAllowed(request, env)) return error("ORIGIN_NOT_ALLOWED", "Origin not allowed", 403, id, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, environment: env.ENVIRONMENT ?? "unknown" }, 200, withCors(request, env));
    if (url.pathname === "/public/track" && request.method === "GET") {
      if (await publicRateLimited(env, request, "/public/track")) return error("RATE_LIMITED", "Too many tracking requests", 429, id, withCors(request, env));
      const reference = url.searchParams.get("reference")?.trim();
      if (!reference || reference.length > 128) return error("VALIDATION_ERROR", "A tracking reference is required", 400, id, withCors(request, env));
      type PublicShipment = { id: string; client_id: string; tracking_number: string | null; lr_number: string | null; provider_reference: string | null; provider: string | null; provider_account_id: string | null; status: string; edd: string | null; delivered_at: string | null; updated_at: string | null };
      // Resolve PSS, courier, and provider references in one indexed read so
      // public tracking does not pay for up to three sequential D1 round trips.
      const shipment = await env.DB.prepare("SELECT id, client_id, tracking_number, lr_number, provider_reference, provider, provider_account_id, status, edd, delivered_at, updated_at FROM shipments WHERE id = ? OR tracking_number = ? OR lr_number = ? OR provider_reference = ? LIMIT 1").bind(reference, reference, reference, reference).first<PublicShipment>();
      if (shipment) {
        const events = await env.DB.prepare("SELECT status, location, description, created_by_user_id, event_time FROM tracking_events WHERE shipment_id = ? ORDER BY event_time ASC LIMIT 50").bind(shipment.id).all();
        if (shipment.provider === "delhivery" && shipment.provider_account_id) {
          const providerResult = await safeProviderRequest(env, "delhivery", "tracking", { shipment_id: shipment.id, tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: shipment.provider_account_id }, id, shipment.client_id, undefined, 5000);
          const tracking = (providerResult as { tracking?: { status?: string; location?: string; description?: string; event_time?: string | null } }).tracking;
          if (providerResult.status === "accepted" && tracking?.status) {
            return json({ ok: true, data: { tracking_number: shipment.tracking_number ?? shipment.provider_reference, status: tracking.status, edd: (providerResult as { edd?: string | null }).edd ?? shipment.edd, delivered_at: tracking.status === "delivered" ? tracking.event_time ?? null : shipment.delivered_at, updated_at: tracking.event_time ?? shipment.updated_at, events: (providerResult as { tracking_events?: unknown[] }).tracking_events ?? [{ status: tracking.status, location: tracking.location ?? "", description: tracking.description ?? "", event_time: tracking.event_time ?? null, source: "provider:delhivery" }] }, provider: "delhivery", provider_status: providerResult.status, request_id: id }, 200, withCors(request, env, { "cache-control": "private, no-store" }));
          }
        }
        // This is the intentionally restricted public projection (no client,
        // address, consignee, document, or billing data), so a short edge
        // cache safely removes repeat D1 reads without making operational
        // authenticated data cacheable.
        return json({ ok: true, data: { tracking_number: shipment.tracking_number, status: shipment.status, edd: shipment.edd, delivered_at: shipment.delivered_at, updated_at: shipment.updated_at, events: events.results }, request_id: id }, 200, withCors(request, env, { "cache-control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60" }));
      }

      // A public AWB may belong to a courier shipment that has not yet been
      // imported into PSS D1. Query only the explicitly supported tracking
      // providers, normalize the response, and never return the raw payload.
      const requestedProvider = url.searchParams.get("provider")?.trim().toLowerCase();
      const providers: CourierProvider[] = requestedProvider && ["delhivery", "trackon", "xpressbees", "rivigo"].includes(requestedProvider)
        ? [requestedProvider as CourierProvider]
        : ["delhivery", "trackon", "xpressbees"];
      const providerTargets: Array<{ provider: CourierProvider; providerAccountId?: string }> = [];
      for (const provider of providers) {
        if (provider === "delhivery") {
          const accounts = await env.DB.prepare("SELECT id FROM provider_accounts WHERE provider = ? AND status = 'active' ORDER BY created_at ASC LIMIT 20").bind(provider).all<{ id: string }>();
          if (accounts.results.length > 0) {
            for (const account of accounts.results) providerTargets.push({ provider, providerAccountId: account.id });
          } else {
            providerTargets.push({ provider });
          }
        } else {
          providerTargets.push({ provider });
        }
      }
      const providerResults = await Promise.all(providerTargets.map(async ({ provider, providerAccountId }) => {
        try {
          // Public tracking must settle before the Hero client's 8-second
          // request budget; authenticated operational lookups keep the
          // normal provider timeout.
          const providerResult = await safeProviderRequest(env, provider, "tracking", { tracking_number: reference, ...(providerAccountId ? { provider_account_id: providerAccountId } : {}) }, id, undefined, undefined, 5000);
          const tracking = (providerResult as { tracking?: { status?: string; location?: string; description?: string; event_time?: string | null } }).tracking;
          return { provider, provider_account_id: providerAccountId, status: String(providerResult.status), tracking, edd: (providerResult as { edd?: string | null }).edd ?? null };
        } catch (caught) {
          console.warn(JSON.stringify({ request_id: id, provider, public_tracking_error: caught instanceof Error ? caught.message : "provider_request_failed" }));
          return { provider, provider_account_id: providerAccountId, status: "failed", tracking: undefined };
        }
      }));
      const match = providerResults.find(({ status, tracking }) => status === "accepted" && tracking?.status);
      if (match?.tracking?.status) {
        const tracking = match.tracking;
        return json({ ok: true, data: { tracking_number: reference, provider: match.provider, status: tracking.status, edd: match.edd ?? null, delivered_at: tracking.status === "delivered" ? tracking.event_time ?? null : null, updated_at: tracking.event_time ?? null, events: [{ status: tracking.status, location: tracking.location ?? "", description: tracking.description ?? "", event_time: tracking.event_time ?? null }] }, request_id: id }, 200, withCors(request, env, { "cache-control": "private, no-store" }));
      }
      const providerOutcomes: Array<{ provider: CourierProvider; status: string }> = providerResults.map(({ provider, status }) => ({ provider, status }));
      // A provider connection can outlive the public request in the edge
      // runtime. Do not leave the Master health panels showing "pending"
      // forever; only terminalize stale read-only checks, never mutations or
      // webhook records.
      await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = 'PROVIDER_TIMEOUT_STALE', error_message = 'Read-only provider request exceeded the terminalization window', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending' AND operation IN ('tracking', 'serviceability', 'serviceability_route') AND created_at <= datetime('now', '-10 seconds')").run();
      const unavailableStatuses = new Set(["failed", "not_configured", "disabled", "safety_disabled"]);
      const allProvidersUnavailable = providerOutcomes.length > 0 && providerOutcomes.every(({ status }) => unavailableStatuses.has(status));
      return json({
        ok: true,
        data: null,
        status: allProvidersUnavailable ? "provider_unavailable" : "not_found",
        providers_checked: providers,
        provider_outcomes: providerOutcomes,
        request_id: id,
      }, 200, withCors(request, env, { "cache-control": "private, no-store" }));
    }
    if (url.pathname === "/v1/webhooks/delhivery/labels" && request.method === "POST") return handleDelhiveryLabelWebhook(request, env, id, headers);
    if (url.pathname === "/v1/webhooks/delhivery/documents" && request.method === "POST") return handleDelhiveryDocumentWebhook(request, env, id, headers);
    if (url.pathname === "/v1/webhooks/rivigo" && request.method === "POST") return handleRivigoWebhook(request, env, id, headers);
    const publicWebhook = url.pathname.match(/^\/v1\/webhooks\/(delhivery|ekart|trackon)$/);
    if (publicWebhook && request.method === "POST") return handleProviderWebhook(request, env, publicWebhook[1] as "delhivery" | "ekart" | "trackon", id, headers);
    if (!url.pathname.startsWith("/v1/")) return error("NOT_FOUND", "Not found", 404, id, headers);
    const auth = await authenticate(request, env);
    if (!auth) return error("AUTHENTICATION_REQUIRED", "Authentication required", 401, id, headers);
    if (auth.kind === "api" && auth.apiKeyId && auth.clientId) {
      ctx.waitUntil(Promise.all([
        env.DB.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(auth.apiKeyId).run(),
        env.DB.prepare("INSERT INTO api_key_usage (id, api_key_id, client_id, endpoint, method, status_code, bytes_in, bytes_out, request_id) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?)").bind(crypto.randomUUID(), auth.apiKeyId, auth.clientId, url.pathname, request.method, Number(request.headers.get("content-length") ?? 0), id).run(),
      ]).then(() => undefined).catch(() => undefined));
    }
    // Strip only the `/v1` prefix and preserve the leading slash expected by route matchers.
    let route = url.pathname.slice(3);
    try {
      const limited = route === "/pricing/quotes" && request.method === "POST" ? pricingPreviewRateLimited(request, auth) : await rateLimited(env, request, auth, route);
      if (limited) return new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "Too many requests" }, request_id: id }), { status: 429, headers: { ...headers, "content-type": "application/json", "retry-after": "60" } });
      if (route === "/me" && request.method === "GET") return json({ ok: true, authenticated: true, user_id: auth.userId, client_id: auth.clientId, client_ids: [...auth.clientIds], audience: auth.audience, roles: [...auth.roles], permissions: [...auth.permissions], system: auth.system }, 200, withCors(request, env));
      const pincodeLookup = route.match(/^\/pincodes\/(\d{6})$/);
      if (pincodeLookup && request.method === "GET") {
        if (!hasScope(auth, "quotes.create") && !hasScope(auth, "serviceability.read")) return error("FORBIDDEN", "Pincode lookup permission required", 403, id, headers);
        const pincode = pincodeLookup[1];
        const location = await pricingPincode(env, pincode);
        if (!location) return error("PINCODE_NOT_FOUND", "Pincode is not present in the active PSS dataset", 404, id, headers);
        return json({ ok: true, data: { pincode, city: location.facility_city, state: location.facility_state, oda: Boolean(location.oda), provenance: "local_dataset" }, request_id: id }, 200, headers);
      }
      // Fujiyama receives a stable PSS contract. It never receives Delhivery
      // credentials or calls Delhivery directly. Tracking refreshes the
      // provider through the account already assigned to the PSS shipment,
      // then returns the normalized PSS history. The provider call remains
      // read-only and is subject to the normal provider capability gate.
      // Booking delegates to the canonical shipment path below so pricing,
      // wallet, idempotency, audit, and provider-account selection remain
      // identical to panel bookings.
      if (route === "/fujiyama/tracking" && request.method === "GET") {
        if (!hasScope(auth, "tracking.read")) return error("FORBIDDEN", "Tracking read scope required", 403, id, headers);
        const awb = url.searchParams.get("awb")?.trim() || url.searchParams.get("tracking_number")?.trim();
        const trackingType = url.searchParams.get("trackingType")?.trim() || "VENDOR-AWB";
        if (!awb || awb.length > 128) return error("VALIDATION_ERROR", "A valid AWB is required", 400, id, headers);
        if (trackingType !== "VENDOR-AWB") return error("VALIDATION_ERROR", "trackingType must be VENDOR-AWB", 400, id, headers);
        const shipment = auth.clientId
          ? await env.DB.prepare("SELECT id, tracking_number, lr_number, provider_reference, provider_account_id, status, provider, destination, edd, delivered_at FROM shipments WHERE client_id = ? AND (tracking_number = ? OR lr_number = ? OR provider_reference = ?) ORDER BY updated_at DESC LIMIT 1").bind(auth.clientId, awb, awb, awb).first<{ id: string; tracking_number: string | null; lr_number: string | null; provider_reference: string | null; provider_account_id: string | null; status: string | null; provider: string | null; destination: string | null; edd: string | null; delivered_at: string | null }>()
          : null;
        if (!shipment) {
          const assignedAccounts = await env.DB.prepare(`
            SELECT pa.id
            FROM provider_accounts pa
            LEFT JOIN provider_account_client_policies p
              ON p.provider_account_id = pa.id AND p.client_id = ?
            WHERE pa.provider = 'delhivery'
              AND pa.status = 'active'
              AND (pa.client_id = ? OR pa.client_id IS NULL)
           AND p.provider_account_id IS NOT NULL AND p.enabled = 1
            ORDER BY COALESCE(p.priority, 100) ASC, pa.created_at ASC
            LIMIT 20`).bind(auth.clientId, auth.clientId).all<{ id: string }>();
          const directResults = await Promise.all(assignedAccounts.results.map(async (account) => {
            try {
              const providerResult = await safeProviderRequest(env, "delhivery", "tracking", { tracking_number: awb, lr_number: awb, provider_account_id: account.id }, id, auth.clientId ?? undefined, undefined, 5000);
              const tracking = (providerResult as { tracking?: { status?: string; location?: string; description?: string; event_time?: string | null }; tracking_events?: unknown[] }).tracking;
              return { status: String(providerResult.status), tracking, tracking_events: (providerResult as { tracking_events?: unknown[] }).tracking_events, edd: (providerResult as { edd?: string | null }).edd ?? null };
            } catch { return { status: "failed", tracking: undefined }; }
          }));
          const directMatch = directResults.find(({ status, tracking }) => status === "accepted" && tracking?.status);
          if (directMatch?.tracking?.status) {
            const tracking = directMatch.tracking;
            return json({ ok: true, data: {
              tracking_type: trackingType,
              awb,
              found: true,
              source: "delhivery",
              status: tracking.status,
              location: tracking.location ?? "",
              description: tracking.description ?? "",
              event_time: tracking.event_time ?? null,
              edd: directMatch.edd ?? null,
              provider: "delhivery",
              events: directMatch.tracking_events ?? [{ status: tracking.status, location: tracking.location ?? "", description: tracking.description ?? "", event_time: tracking.event_time ?? null, source: "provider:delhivery" }],
            }, request_id: id }, 200, headers);
          }
          return json({ ok: true, data: { tracking_type: trackingType, awb, found: false, source: "delhivery", status: "not_found", location: "", description: "No shipment found in PSS or the client’s active Delhivery accounts", event_time: null, provider: "delhivery", events: [] }, request_id: id }, 200, headers);
        }
        const providerResult = shipment.provider === "delhivery"
          ? await safeProviderRequest(env, "delhivery", "tracking", {
              shipment_id: shipment.id,
              tracking_number: shipment.tracking_number ?? awb,
              lr_number: shipment.lr_number ?? awb,
              provider_reference: shipment.provider_reference ?? awb,
              provider_account_id: shipment.provider_account_id ?? undefined,
            }, id, auth.clientId, undefined, 5000)
          : { enabled: false, status: "not_requested" as const };
        const events = await env.DB.prepare("SELECT status, location, description, created_by_user_id, event_time FROM tracking_events WHERE shipment_id = ? ORDER BY event_time ASC").bind(shipment.id).all<{ status: string; location: string | null; description: string | null; created_by_user_id: string | null; event_time: string | null }>();
        const latest = events.results.at(-1);
        const liveTracking = (providerResult as { tracking?: { status?: string; location?: string; description?: string; event_time?: string | null } }).tracking;
        return json({ ok: true, data: {
          tracking_type: trackingType,
          awb,
          found: true,
          status: liveTracking?.status ?? latest?.status ?? shipment.status ?? "unknown",
          location: liveTracking?.location ?? latest?.location ?? shipment.destination ?? "",
          description: liveTracking?.description ?? latest?.description ?? "",
          event_time: liveTracking?.event_time ?? latest?.event_time ?? shipment.delivered_at ?? null,
          provider: shipment.provider ?? "delhivery",
          provider_status: providerResult.status,
          events: events.results.map((event) => ({ ...event, source: event.created_by_user_id })),
          edd: (providerResult as { edd?: string | null }).edd ?? shipment.edd ?? null,
        }, request_id: id }, 200, headers);
      }
      if (route === "/fujiyama/bookings" && request.method === "POST") {
        if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment creation scope required", 403, id, headers);
        route = "/shipments";
      }
      if (route === "/preferences" && (request.method === "GET" || request.method === "PUT")) {
        const clientId = requireClient(auth, url.searchParams.get("client_id"));
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT client_id, preferences_json, updated_at FROM client_preferences WHERE client_id = ? LIMIT 1").bind(clientId).first<{ client_id: string; preferences_json: string; updated_at: string }>();
          return json({ ok: true, data: { client_id: clientId, preferences: row ? JSON.parse(row.preferences_json) : {}, updated_at: row?.updated_at ?? null } }, 200, headers);
        }
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const preferences = payload.preferences && typeof payload.preferences === "object" ? payload.preferences : null;
        if (!preferences) return error("VALIDATION_ERROR", "Preferences must be an object", 400, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = "PUT /v1/preferences"; const existing = await idempotentResponse(env, idempotencyKey, clientId, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare("INSERT INTO client_preferences (client_id, preferences_json, updated_by_user_id, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(client_id) DO UPDATE SET preferences_json = excluded.preferences_json, updated_by_user_id = excluded.updated_by_user_id, updated_at = CURRENT_TIMESTAMP").bind(clientId, JSON.stringify(preferences), auth.userId ?? `api:${clientId}`).run();
        await audit(env, ctx, auth, id, "preferences.updated", "client_preferences", clientId, { client_id: clientId });
        const serialized = JSON.stringify({ ok: true, data: { client_id: clientId, preferences }, request_id: id }); await saveIdempotent(env, idempotencyKey, clientId, endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/employee-preferences" && (request.method === "GET" || request.method === "PUT")) {
        if (!auth.userId || !hasRole(auth, ["employee", "admin", "super_admin"])) return error("FORBIDDEN", "Employee preference access is not allowed", 403, id, headers);
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT user_id, email_notifications, task_reminders, compact_layout, updated_at FROM employee_preferences WHERE user_id = ? LIMIT 1").bind(auth.userId).first<{ user_id: string; email_notifications: number; task_reminders: number; compact_layout: number; updated_at: string }>();
          return json({ ok: true, data: { user_id: auth.userId, email_notifications: Boolean(row?.email_notifications ?? 1), task_reminders: Boolean(row?.task_reminders ?? 1), compact_layout: Boolean(row?.compact_layout ?? 0), updated_at: row?.updated_at ?? null } }, 200, headers);
        }
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload);
        const fields = ["email_notifications", "task_reminders", "compact_layout"] as const;
        if (fields.some((field) => payload[field] !== undefined && typeof payload[field] !== "boolean")) return error("VALIDATION_ERROR", "Employee preferences must be boolean values", 400, id, headers);
        const current = await env.DB.prepare("SELECT email_notifications, task_reminders, compact_layout FROM employee_preferences WHERE user_id = ? LIMIT 1").bind(auth.userId).first<{ email_notifications: number; task_reminders: number; compact_layout: number }>();
        const next = { email_notifications: payload.email_notifications === undefined ? Boolean(current?.email_notifications ?? 1) : Boolean(payload.email_notifications), task_reminders: payload.task_reminders === undefined ? Boolean(current?.task_reminders ?? 1) : Boolean(payload.task_reminders), compact_layout: payload.compact_layout === undefined ? Boolean(current?.compact_layout ?? 0) : Boolean(payload.compact_layout) };
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = "PUT /v1/employee-preferences"; const existing = await idempotentResponse(env, key, auth.userId, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare("INSERT INTO employee_preferences (user_id, email_notifications, task_reminders, compact_layout, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET email_notifications = excluded.email_notifications, task_reminders = excluded.task_reminders, compact_layout = excluded.compact_layout, updated_at = CURRENT_TIMESTAMP").bind(auth.userId, next.email_notifications ? 1 : 0, next.task_reminders ? 1 : 0, next.compact_layout ? 1 : 0).run();
        await audit(env, ctx, auth, id, "employee_preferences.updated", "employee_preferences", auth.userId, { user_id: auth.userId });
        const serialized = JSON.stringify({ ok: true, data: { user_id: auth.userId, ...next }, request_id: id }); await saveIdempotent(env, key, auth.userId, endpoint, 200, serialized, requestHash); return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/provider-capabilities" && request.method === "GET") {
        const callsEnabled = String(env.ENABLE_PROVIDER_CALLS) === "true";
        const delhiveryConfigured = Boolean(env.DELHIVERY_API_BASE_URL && env.DELHIVERY_API_TOKEN);
        const ekartConfigured = Boolean(env.EKART_API_BASE_URL && env.EKART_API_KEY);
        const ekartCallsEnabled = String(env.EKART_ENABLE_PROVIDER_CALLS) === "true";
        const delhiveryWebhookConfigured = Boolean(env.DELHIVERY_WEBHOOK_SECRET);
        const ekartWebhookConfigured = Boolean(env.EKART_WEBHOOK_SECRET);
        const trackonConfigured = Boolean(env.TRACKON_API_BASE_URL && env.TRACKON_CREDENTIALS_JSON);
        const trackonWebhookConfigured = Boolean(env.TRACKON_WEBHOOK_SECRET);
        const xpressbeesConfigured = Boolean(env.XPRESSBEES_API_BASE_URL && env.XPRESSBEES_CREDENTIALS_JSON);
        const rivigoConfigured = Boolean(env.RIVIGO_API_BASE_URL && env.RIVIGO_CREDENTIALS_JSON);
        const rivigoCallsEnabled = String((env as unknown as Record<string, unknown>).RIVIGO_ENABLE_PROVIDER_CALLS) === "true";
        const rivigoWebhookConfigured = Boolean(env.RIVIGO_WEBHOOK_SECRET || rivigoWebhookCredentials(env)?.appUuid);
        // Read-only provider probes must not remain pending forever. Reconcile
        // only tracking/serviceability rows older than the terminalization
        // window; shipment, pickup, billing, and webhook records are untouched.
        // Health panels must not remain in a checking state after a read-only
        // provider probe has exceeded the same bounded terminalization window
        // used by the public tracker. Mutations and webhook records remain
        // untouched by this reconciliation.
        await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = 'PROVIDER_TIMEOUT_STALE', error_message = 'Read-only provider request remained pending beyond the terminalization window' WHERE status = 'pending' AND operation IN ('tracking', 'serviceability', 'serviceability_route') AND updated_at < datetime('now', '-10 seconds')").run();
        const recentRequests = await env.DB.prepare("SELECT provider, status, error_code, updated_at FROM integration_requests WHERE provider IN ('delhivery', 'ekart', 'trackon', 'xpressbees', 'rivigo') ORDER BY updated_at DESC, CASE WHEN status = 'pending' THEN 1 ELSE 0 END ASC, id DESC").all<{ provider: CourierProvider; status: string; error_code: string | null; updated_at: string | null }>();
        const providerHealth = (provider: CourierProvider) => {
          const latest = recentRequests.results.find((item) => item.provider === provider);
          const pendingAge = latest?.status === "pending" && latest.updated_at ? Date.now() - Date.parse(latest.updated_at) : 0;
          const pendingStale = latest?.status === "pending" && Number.isFinite(pendingAge) && pendingAge > 120_000;
          const failureAge = latest?.status === "failed" && latest.updated_at ? Date.now() - Date.parse(latest.updated_at) : 0;
          const failureStale = latest?.status === "failed" && Number.isFinite(failureAge) && failureAge > 15 * 60_000;
          return {
            health: latest?.status === "failed" ? (failureStale ? "stale" : "degraded") : pendingStale ? "degraded" : latest?.status === "pending" ? "pending" : latest?.status === "succeeded" ? "healthy" : "unknown",
            last_error_code: latest?.status === "failed" ? latest.error_code ?? "provider_request_failed" : pendingStale ? "provider_request_stuck" : null,
            last_checked_at: latest?.updated_at ?? null,
          };
        };
        return json({ ok: true, data: {
          delhivery: { ...providerHealth("delhivery"), configured: delhiveryConfigured, enabled: callsEnabled && delhiveryConfigured, webhook_configured: delhiveryWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!delhiveryConfigured ? ["provider_credentials_missing"] : []), ...(!delhiveryWebhookConfigured ? ["webhook_secret_missing"] : [])], capabilities: ["tracking", ...(delhiveryWebhookConfigured ? ["scan_webhooks", "document_webhooks"] : [])] },
          ekart: { ...providerHealth("ekart"), configured: ekartConfigured, enabled: callsEnabled && ekartConfigured && ekartCallsEnabled, webhook_configured: ekartWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!ekartConfigured ? ["provider_credentials_missing"] : []), ...(ekartCallsEnabled ? [] : ["disabled_by_agreed_scope"]), ...(!ekartWebhookConfigured ? ["webhook_secret_missing"] : [])], capabilities: ["tracking", "shipment_creation", ...(ekartWebhookConfigured ? ["webhooks"] : [])] },
          trackon: { ...providerHealth("trackon"), configured: trackonConfigured, enabled: callsEnabled && trackonConfigured, webhook_configured: trackonWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!trackonConfigured ? ["provider_credentials_or_endpoint_missing"] : []), ...(!trackonWebhookConfigured ? ["webhook_secret_missing"] : [])], capabilities: ["tracking", "labels", ...(trackonWebhookConfigured ? ["webhooks"] : [])] },
          xpressbees: { ...providerHealth("xpressbees"), configured: xpressbeesConfigured, enabled: callsEnabled && xpressbeesConfigured, webhook_configured: false, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!xpressbeesConfigured ? ["provider_credentials_or_endpoint_missing"] : []), ...(!env.XPRESSBEES_SERVICEABILITY_URL ? ["serviceability_endpoint_missing"] : [])], capabilities: ["tracking", "quotes", ...(env.XPRESSBEES_SERVICEABILITY_URL ? ["serviceability"] : [])] },
          rivigo: { ...providerHealth("rivigo"), configured: rivigoConfigured, enabled: callsEnabled && rivigoCallsEnabled && rivigoConfigured, webhook_configured: rivigoWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!rivigoConfigured ? ["provider_credentials_or_endpoint_missing"] : []), ...(rivigoCallsEnabled ? [] : ["disabled_by_go_live_gate"]), ...(!rivigoWebhookConfigured ? ["webhook_app_identity_missing"] : [])], capabilities: ["tracking", "serviceability", "shipment_creation", "shipment_update", "shipment_cancellation", ...(rivigoWebhookConfigured ? ["event_webhooks"] : [])] },
        } }, 200, headers);
      }
      if (route === "/provider-account-policies" && request.method === "GET") {
        if (!hasScope(auth, "provider_accounts.read") && !hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Provider account visibility permission required", 403, id, headers);
        const requestedClient = new URL(request.url).searchParams.get("client_id");
        const clientId = requireClient(auth, requestedClient);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        await ensureDefaultClientProviderPolicies(env, clientId, auth.userId ?? `client:${clientId}`);
         const internalProviderView = hasRole(auth, ["employee", "admin", "super_admin"]) || auth.system;
         const providerAccountVisibility = internalProviderView
           ? "pa.status = 'active' AND (pa.client_id = ? OR pa.client_id IS NULL)"
           : "pa.status = 'active' AND (pa.client_id = ? OR (pa.client_id IS NULL AND p.client_id = ? AND p.enabled = 1))";
         const rows = await env.DB.prepare(`
          SELECT pa.id, pa.provider, pa.account_name, pa.account_type, pa.client_id,
                  pa.capabilities_json, pa.credential_secret_name, pa.status,
                 CASE WHEN p.provider_account_id IS NULL THEN CASE WHEN pa.status = 'active' THEN 1 ELSE 0 END ELSE p.enabled END AS enabled,
                 CASE WHEN p.provider_account_id IS NULL THEN 100 ELSE p.priority END AS priority,
                 CASE WHEN p.provider_account_id IS NULL THEN 0 ELSE p.confidence_score END AS confidence_score,
                 p.rate_card_id, p.notes, p.updated_at AS policy_updated_at,
                 CASE WHEN p.provider_account_id IS NULL THEN 0 ELSE 1 END AS explicitly_configured
          FROM provider_accounts pa
          LEFT JOIN provider_account_client_policies p
            ON p.provider_account_id = pa.id AND p.client_id = ?
           -- Include disabled policies so Super Admin can manage the complete client/courier matrix.
           WHERE ${providerAccountVisibility}
           ORDER BY pa.provider, enabled DESC, priority ASC, confidence_score DESC, pa.account_name`).bind(...(internalProviderView ? [clientId, clientId] : [clientId, clientId, clientId])).all();
        const secretBag = env as unknown as Record<string, unknown>;
        const configured = (row: Record<string, unknown>) => {
          const secretName = String(row.credential_secret_name ?? "");
          return Boolean(secretName && typeof secretBag[secretName] === "string" && String(secretBag[secretName]).trim().length > 0);
        };
        return json({ ok: true, data: rows.results.map((row) => {
          const record = row as Record<string, unknown>;
          const isConfigured = configured(record);
          const { credential_secret_name: _credentialSecretName, ...safeRow } = record;
          return { ...safeRow, capabilities: (() => { try { return JSON.parse(String(record.capabilities_json ?? "[]")); } catch { return []; } })(), configured: isConfigured, enabled: Boolean(Number(record.enabled)) && isConfigured, explicitly_configured: Boolean(Number(record.explicitly_configured)) };
        }) }, 200, headers);
      }
      const providerPolicyMatch = route.match(/^\/provider-account-policies\/([^/]+)$/);
      if (providerPolicyMatch && request.method === "PUT") {
        if (!hasScope(auth, "provider_accounts.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Provider account policy management permission required", 403, id, headers);
        const account = await env.DB.prepare("SELECT id, provider, client_id, status FROM provider_accounts WHERE id = ? LIMIT 1").bind(providerPolicyMatch[1]).first<{ id: string; provider: CourierProvider; client_id: string | null; status: string }>();
        if (!account || account.status !== "active") return error("NOT_FOUND", "Active provider account not found", 404, id, headers);
        const payload = await bodyJson(request, 32 * 1024 * 1024);
        const clientId = typeof payload.client_id === "string" ? payload.client_id.trim() : "";
        const enabled = payload.enabled === undefined ? true : payload.enabled;
        const priority = payload.priority === undefined ? 100 : Number(payload.priority);
        const confidence = payload.confidence_score === undefined ? 0 : Number(payload.confidence_score);
        const rateCardId = payload.rate_card_id === undefined || payload.rate_card_id === null || payload.rate_card_id === "" ? null : String(payload.rate_card_id).trim();
        const notes = payload.notes === undefined || payload.notes === null || payload.notes === "" ? null : String(payload.notes).trim();
        if (!clientId || typeof enabled !== "boolean" || !Number.isInteger(priority) || priority < 0 || priority > 100000 || !Number.isFinite(confidence) || confidence < 0 || confidence > 100 || (notes && notes.length > 500)) return error("VALIDATION_ERROR", "Client, enabled, priority, confidence score, and notes are invalid", 400, id, headers);
        if (!auth.system && !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const requestHash = await payloadFingerprint(payload); const endpoint = `PUT /v1/provider-account-policies/${account.id}`;
        const existing = await idempotentResponse(env, key, auth.userId ?? "system", endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare(`INSERT INTO provider_account_client_policies (provider_account_id, client_id, enabled, priority, confidence_score, rate_card_id, notes, updated_by_user_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(provider_account_id, client_id) DO UPDATE SET enabled = excluded.enabled, priority = excluded.priority, confidence_score = excluded.confidence_score, rate_card_id = excluded.rate_card_id, notes = excluded.notes, updated_by_user_id = excluded.updated_by_user_id, updated_at = CURRENT_TIMESTAMP`).bind(account.id, clientId, enabled ? 1 : 0, priority, confidence, rateCardId, notes, auth.userId ?? "system").run();
        await audit(env, ctx, auth, id, "provider_account_client_policy.updated", "provider_account_client_policy", `${account.id}:${clientId}`, { provider: account.provider, client_id: clientId, enabled, priority, confidence_score: confidence, rate_card_id: rateCardId });
        const serialized = JSON.stringify({ ok: true, data: { provider_account_id: account.id, client_id: clientId, enabled, priority, confidence_score: confidence, rate_card_id: rateCardId, notes }, request_id: id });
        await saveIdempotent(env, key, auth.userId ?? "system", endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/security/sessions" && request.method === "GET") {
        if (!auth.userId || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Security session visibility permission required", 403, id, headers);
        const sessionId = `current-${(await sha256(auth.accessToken ?? "")).slice(0, 24)}`;
        return json({ ok: true, data: [{ id: sessionId, user_id: auth.userId, current: true, status: "active", last_seen_at: new Date().toISOString() }] }, 200, headers);
      }
      const securitySessionRevoke = route.match(/^\/security\/sessions\/([^/]+)\/revoke$/);
      if (securitySessionRevoke && request.method === "POST") {
        if (!auth.userId || !auth.accessToken || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Security session revocation permission required", 403, id, headers);
        const expectedSessionId = `current-${(await sha256(auth.accessToken)).slice(0, 24)}`;
        if (securitySessionRevoke[1] !== expectedSessionId) return error("NOT_FOUND", "Security session not found", 404, id, headers);
        const logout = await fetch(`${env.SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${auth.accessToken}` } });
        if (!logout.ok) return error("SESSION_REVOKE_FAILED", "The current Supabase session could not be revoked", 502, id, headers);
        await audit(env, ctx, auth, id, "security_session.revoked", "security_session", expectedSessionId, { user_id: auth.userId });
        return json({ ok: true, data: { id: expectedSessionId, status: "revoked" }, request_id: id }, 200, headers);
      }
      if (route === "/provider-accounts" && request.method === "GET") {
        if (!hasScope(auth, "provider_accounts.read")) return error("FORBIDDEN", "Provider account visibility permission required", 403, id, headers);
        const rows = auth.system
          ? await env.DB.prepare("SELECT id, provider, account_name, account_type, client_id, capabilities_json, status, created_by_user_id, created_at, updated_at FROM provider_accounts ORDER BY provider, account_name LIMIT 100").all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT id, provider, account_name, account_type, client_id, capabilities_json, status, created_by_user_id, created_at, updated_at FROM provider_accounts WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY provider, account_name LIMIT 100`).bind(...auth.clientIds).all()
            : { results: [] };
        return json({ ok: true, data: rows.results.map((row) => { const value = row as Record<string, unknown>; let capabilities: unknown[] = []; try { capabilities = JSON.parse(String(value.capabilities_json ?? "[]")); } catch { capabilities = []; } const { capabilities_json: _capabilitiesJson, ...safe } = value; return { ...safe, capabilities }; }) }, 200, headers);
      }
      if (route === "/provider-accounts" && request.method === "POST") {
        if (!hasScope(auth, "provider_accounts.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Provider account management permission required", 403, id, headers);
        const payload = await bodyJson(request); const provider = String(payload.provider ?? "").toLowerCase(); const accountName = String(payload.account_name ?? "").trim(); const accountType = String(payload.account_type ?? "production").toLowerCase(); const secretName = String(payload.credential_secret_name ?? "").trim(); const clientId = payload.client_id === null || payload.client_id === undefined || payload.client_id === "" ? null : String(payload.client_id);
        if (!new Set(["delhivery", "ekart", "trackon", "xpressbees", "rivigo"]).has(provider) || !accountName || accountName.length > 120 || !new Set(["production", "staging"]).has(accountType) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(secretName)) return error("VALIDATION_ERROR", "Invalid provider account details", 400, id, headers);
        if (!auth.system && (!clientId || !canAccessClient(auth, clientId))) return error("FORBIDDEN", "Provider account client scope is not allowed", 403, id, headers);
        if (clientId) { const client = await supabaseGet<{ id: string; status: string }>(env, `client_accounts?id=eq.${encodeURIComponent(clientId)}&status=eq.active&select=id,status`, auth.accessToken ?? ""); if (!client.length) return error("NOT_FOUND", "Client account not found", 404, id, headers); }
        const duplicate = await env.DB.prepare("SELECT id FROM provider_accounts WHERE provider = ? AND account_name = ? LIMIT 1").bind(provider, accountName).first<{ id: string }>(); if (duplicate) return error("CONFLICT", "Provider account name already exists", 409, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers); const requestHash = await payloadFingerprint(payload); const endpoint = "POST /v1/provider-accounts"; const existing = await idempotentResponse(env, idempotencyKey, auth.userId ?? "system", endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const accountId = crypto.randomUUID(); const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.filter((value): value is string => typeof value === "string").slice(0, 20) : []; await env.DB.prepare("INSERT INTO provider_accounts (id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(accountId, provider, accountName, accountType, secretName, clientId, JSON.stringify(capabilities), auth.userId ?? "system").run(); await audit(env, ctx, auth, id, "provider_account.created", "provider_account", accountId, { provider, account_name: accountName, client_id: clientId, credential_secret_name: secretName }); const serialized = JSON.stringify({ ok: true, data: { id: accountId, provider, account_name: accountName, account_type: accountType, client_id: clientId, capabilities, status: "active" }, request_id: id }); await saveIdempotent(env, idempotencyKey, auth.userId ?? "system", endpoint, 201, serialized, requestHash); return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      const providerAccountMatch = route.match(/^\/provider-accounts\/([^/]+)$/);
      if (providerAccountMatch && request.method === "PATCH") {
        if (!hasScope(auth, "provider_accounts.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Provider account management permission required", 403, id, headers);
        const account = await env.DB.prepare("SELECT id, client_id, credential_secret_name FROM provider_accounts WHERE id = ? LIMIT 1").bind(providerAccountMatch[1]).first<{ id: string; client_id: string | null; credential_secret_name: string }>(); if (!account) return error("NOT_FOUND", "Provider account not found", 404, id, headers); if (!auth.system && (!account.client_id || !canAccessClient(auth, account.client_id))) return error("NOT_FOUND", "Provider account not found", 404, id, headers); const payload = await bodyJson(request); const status = payload.status === undefined ? undefined : String(payload.status); if (status !== undefined && !new Set(["active", "disabled"]).has(status)) return error("VALIDATION_ERROR", "Invalid provider account status", 400, id, headers); if (status === "active") { const secretValue = (env as unknown as Record<string, unknown>)[account.credential_secret_name]; if (typeof secretValue !== "string" || !secretValue.trim()) return error("PROVIDER_CREDENTIAL_MISSING", "Add the matching Worker secret before activating this provider account", 409, id, headers); } const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers); const requestHash = await payloadFingerprint(payload); const endpoint = `PATCH /v1/provider-accounts/${account.id}`; const existing = await idempotentResponse(env, idempotencyKey, auth.userId ?? "system", endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } }); if (status !== undefined) await env.DB.prepare("UPDATE provider_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, account.id).run(); await audit(env, ctx, auth, id, "provider_account.updated", "provider_account", account.id, { status }); const serialized = JSON.stringify({ ok: true, data: { id: account.id, ...(status ? { status } : {}) }, request_id: id }); await saveIdempotent(env, idempotencyKey, auth.userId ?? "system", endpoint, 200, serialized, requestHash); return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/integration-requests" && request.method === "GET") {
        if (!hasScope(auth, "integrations.read")) return error("FORBIDDEN", "Integration visibility permission required", 403, id, headers);
        const rows = auth.system
          ? await env.DB.prepare("SELECT id, provider, client_id, operation, provider_request_id, status, attempt_count, error_code, error_message, created_at, updated_at FROM integration_requests ORDER BY updated_at DESC").all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT id, provider, client_id, operation, provider_request_id, status, attempt_count, error_code, error_message, created_at, updated_at FROM integration_requests WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY updated_at DESC`).bind(...auth.clientIds).all()
            : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      if (route === "/webhook-events" && request.method === "GET") {
        if (!hasScope(auth, "webhooks.read") || !auth.system) return error("FORBIDDEN", "Only organization administrators may view webhook events", 403, id, headers);
        const rows = await env.DB.prepare("SELECT id, provider, event_id, event_type, signature_valid, status, processed_at, created_at FROM webhook_events ORDER BY created_at DESC").all();
        return json({ ok: true, data: rows.results }, 200, headers);
      }

      if (route === "/shipments" && request.method === "GET") {
        const shipmentView = url.searchParams.get("view") ?? "default";
        const requiredShipmentScope = shipmentView === "tracking" ? "tracking.read" : "shipments.read";
        if (!hasScope(auth, requiredShipmentScope)) return error("FORBIDDEN", "Shipment read scope required", 403, id, headers);
        const compactShipmentView = url.searchParams.get("view") === "register" || shipmentView === "tracking";
        const internalShipmentView = hasScope(auth, "shipments.sensitive.read") || auth.system;
        const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 50);
        const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
        const searchTerm = String(url.searchParams.get("search") ?? "").trim().slice(0, 120);
        const searchFilter = searchTerm ? "(s.id LIKE ? OR s.pss_reference LIKE ? OR s.tracking_number LIKE ? OR s.lr_number LIKE ? OR s.master_awb LIKE ? OR s.provider_reference LIKE ?)" : "";
        const searchBinds = searchTerm ? Array(6).fill(`%${searchTerm}%`) : [];
        const requestedStatus = String(url.searchParams.get("status") ?? "").trim().toLowerCase().replaceAll(" ", "_");
        const statusFilter = requestedStatus === "active"
          ? "status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delayed', 'exception')"
          : requestedStatus === "returned"
            ? "status IN ('rto', 'returned')"
            : new Set(["booked", "picked_up", "in_transit", "out_for_delivery", "delivered", "delayed", "exception", "cancelled", "canceled"]).has(requestedStatus)
              ? `status = '${requestedStatus === "canceled" ? "cancelled" : requestedStatus}'`
              : "";
        const shipmentColumns = compactShipmentView || shipmentView === "tracking"
          ? "s.id, s.pss_reference, s.client_id, s.tracking_number, s.lr_number, s.master_awb, s.status, s.provider, s.origin, s.destination, s.total_weight_kg, s.weight_override_kg, s.weight_source, s.weight_updated_at, s.pieces, s.edd, s.delivered_at, s.created_at, s.updated_at, s.dimensions_json"
          : internalShipmentView
           ? "s.id, s.pss_reference, s.client_id, s.created_by_user_id, s.tracking_number, s.lr_number, s.master_awb, s.box_awbs_json, s.provider_booking_id, s.provider_pickup_id, s.provider_sync_status, s.status, s.provider, s.provider_account_id, s.provider_reference, (SELECT sd.id FROM shipment_documents sd WHERE sd.shipment_id = s.id AND lower(sd.original_filename) LIKE 'delhivery-pod-%' ORDER BY sd.created_at DESC LIMIT 1) AS pod_document_id, (SELECT sd.original_filename FROM shipment_documents sd WHERE sd.shipment_id = s.id AND lower(sd.original_filename) LIKE 'delhivery-pod-%' ORDER BY sd.created_at DESC LIMIT 1) AS pod_filename, (SELECT pr.provider_reference FROM pickup_requests pr WHERE pr.shipment_id = s.id AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference, (SELECT pr.status FROM pickup_requests pr WHERE pr.shipment_id = s.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_status, (SELECT pr.requested_date FROM pickup_requests pr WHERE pr.shipment_id = s.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_scheduled_date, (SELECT pr.requested_time_slot FROM pickup_requests pr WHERE pr.shipment_id = s.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_time_slot, (SELECT c.provider_status FROM pricing_provider_costs c WHERE c.shipment_id = s.id LIMIT 1) AS provider_confirmation_status, (SELECT te.description FROM tracking_events te WHERE te.shipment_id = s.id AND te.status = 'exception' ORDER BY te.event_time DESC LIMIT 1) AS provider_failure_reason, s.description, s.origin, s.destination, s.origin_address_json, s.destination_address_json, s.consignee, s.total_weight_kg, s.weight_override_kg, s.weight_source, s.weight_updated_at, s.declared_value, s.pieces, s.edd, s.delivered_at, s.created_at, s.updated_at"
          : "s.id, s.pss_reference, s.client_id, s.created_by_user_id, s.tracking_number, s.lr_number, s.master_awb, s.box_awbs_json, s.provider_booking_id, s.provider_pickup_id, s.provider_sync_status, s.status, s.provider, s.provider_reference, (SELECT sd.id FROM shipment_documents sd WHERE sd.shipment_id = s.id AND lower(sd.original_filename) LIKE 'delhivery-pod-%' ORDER BY sd.created_at DESC LIMIT 1) AS pod_document_id, (SELECT sd.original_filename FROM shipment_documents sd WHERE sd.shipment_id = s.id AND lower(sd.original_filename) LIKE 'delhivery-pod-%' ORDER BY sd.created_at DESC LIMIT 1) AS pod_filename, (SELECT pr.provider_reference FROM pickup_requests pr WHERE pr.shipment_id = s.id AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference, (SELECT pr.status FROM pickup_requests pr WHERE pr.shipment_id = s.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_status, (SELECT pr.requested_date FROM pickup_requests pr WHERE pr.shipment_id = s.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_scheduled_date, (SELECT pr.requested_time_slot FROM pickup_requests pr WHERE pr.shipment_id = s.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_time_slot, (SELECT c.provider_status FROM pricing_provider_costs c WHERE c.shipment_id = s.id LIMIT 1) AS provider_confirmation_status, (SELECT te.description FROM tracking_events te WHERE te.shipment_id = s.id AND te.status = 'exception' ORDER BY te.event_time DESC LIMIT 1) AS provider_failure_reason, s.description, s.origin, s.destination, s.origin_address_json, s.destination_address_json, s.consignee, s.total_weight_kg, s.declared_value, s.pieces, s.edd, s.delivered_at, s.created_at, s.updated_at";
        const trackingShipmentColumns = "s.id, s.pss_reference, s.client_id, s.tracking_number, s.lr_number, s.master_awb, s.box_awbs_json, s.provider_reference, s.provider_booking_id, s.provider_pickup_id, s.provider_sync_status, s.status, s.provider, s.origin, s.destination, s.origin_address_json, s.destination_address_json, s.consignee, s.total_weight_kg, s.weight_override_kg, s.weight_source, s.weight_updated_at, s.pieces, s.edd, s.delivered_at, s.created_at, s.updated_at, s.dimensions_json, (SELECT sd.id FROM shipment_documents sd WHERE sd.shipment_id = s.id AND lower(sd.original_filename) LIKE 'delhivery-pod-%' ORDER BY sd.created_at DESC LIMIT 1) AS pod_document_id, (SELECT sd.id FROM shipment_documents sd WHERE sd.shipment_id = s.id AND lower(sd.original_filename) NOT LIKE 'delhivery-pod-%' ORDER BY sd.created_at DESC LIMIT 1) AS invoice_document_id, (SELECT pr.provider_reference FROM pickup_requests pr WHERE (pr.shipment_id = s.id OR EXISTS (SELECT 1 FROM pickup_request_shipments prs WHERE prs.pickup_id = pr.id AND prs.shipment_id = s.id)) AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference, (SELECT b.invoice_number FROM billing_records b WHERE b.shipment_id = s.id ORDER BY b.created_at DESC LIMIT 1) AS invoice_number";
        const selectedShipmentColumns = shipmentView === "tracking" || !internalShipmentView ? trackingShipmentColumns : shipmentColumns;
        const queryLimit = pageSize + 1;
        const systemWhere = [statusFilter ? `s.${statusFilter}` : "", searchFilter].filter(Boolean).join(" AND ");
        const clientWhere = [`s.client_id IN (${[...auth.clientIds].map(() => "?").join(",")})`, statusFilter ? `s.${statusFilter}` : "", searchFilter].filter(Boolean).join(" AND ");
        const rows = auth.system
          ? await env.DB.prepare(`SELECT ${selectedShipmentColumns} FROM shipments s${systemWhere ? ` WHERE ${systemWhere}` : ""} ORDER BY s.created_at DESC LIMIT ${queryLimit} OFFSET ${offset}`).bind(...searchBinds).all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT ${selectedShipmentColumns} FROM shipments s WHERE ${clientWhere} ORDER BY s.created_at DESC LIMIT ${queryLimit} OFFSET ${offset}`).bind(...[...auth.clientIds, ...searchBinds]).all()
            : { results: [] };
        const scopeKey = auth.system ? "system" : [...auth.clientIds].sort().join(",");
        const cachedStatusCounts = shipmentStatusCountsCache.get(scopeKey);
        let statusCounts: Record<string, number>;
        if (cachedStatusCounts && cachedStatusCounts.expiresAt > Date.now()) {
          statusCounts = cachedStatusCounts.counts;
        } else {
          const statusRows = auth.system ? await env.DB.prepare("SELECT status, COUNT(*) AS count FROM shipments GROUP BY status").all<{ status: string | null; count: number }>() : auth.clientIds.size ? await env.DB.prepare(`SELECT status, COUNT(*) AS count FROM shipments WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) GROUP BY status`).bind(...[...auth.clientIds]).all<{ status: string | null; count: number }>() : { results: [] as Array<{ status: string | null; count: number }> };
          statusCounts = Object.fromEntries(statusRows.results.map((item) => [String(item.status ?? "unknown"), Number(item.count ?? 0)]));
          shipmentStatusCountsCache.set(scopeKey, { expiresAt: Date.now() + SHIPMENT_STATUS_COUNTS_CACHE_TTL_MS, counts: statusCounts });
        }
        const totalCount = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
        const pageResults = rows.results.length > pageSize ? rows.results.slice(0, pageSize) : rows.results;
        const pagination = { limit: pageSize, offset, next_offset: offset + pageResults.length, has_more: rows.results.length > pageSize, total: totalCount, status_counts: statusCounts };
        const pageClientIds = [...new Set(pageResults.map((shipment) => String((shipment as Record<string, unknown>).client_id ?? "")).filter(Boolean))];
        const clientNameRows = auth.accessToken && pageClientIds.length
          ? await supabaseGet<{ id: string; legal_name: string }>(env, `client_accounts?id=in.(${pageClientIds.map((clientId) => encodeURIComponent(clientId)).join(",")})&select=id,legal_name`, auth.accessToken)
          : [];
        const clientNames = new Map(clientNameRows.map((client) => [client.id, client.legal_name]));
        const namedPageResults = pageResults.map((shipment) => ({ ...shipment, client_name: clientNames.get(String((shipment as Record<string, unknown>).client_id ?? "")) ?? (shipment as Record<string, unknown>).client_id }));
        if (url.searchParams.get("include_tracking") === "1") {
          const shipments = namedPageResults as Array<Record<string, unknown>>;
          const shipmentIds = shipments.map((shipment) => String(shipment.id));
          const events = shipmentIds.length
            ? await env.DB.prepare(`SELECT shipment_id, status, location, description, created_by_user_id, event_time FROM tracking_events WHERE shipment_id IN (${shipmentIds.map(() => "?").join(",")}) ORDER BY event_time ASC`).bind(...shipmentIds).all()
            : { results: [] };
          const eventsByShipment = new Map<string, Array<Record<string, unknown>>>();
          for (const event of events.results as Array<Record<string, unknown>>) {
            const shipmentId = String(event.shipment_id);
            const current = eventsByShipment.get(shipmentId) ?? [];
            if (current.length < 50) current.push({ ...event, source: event.created_by_user_id });
            eventsByShipment.set(shipmentId, current);
          }
          const data = shipments.map((shipment) => ({ ...shipment, tracking_events: eventsByShipment.get(String(shipment.id)) ?? [] }));
          return json({ ok: true, data, pagination }, 200, headers);
        }
        return json({ ok: true, data: namedPageResults, pagination }, 200, headers);
      }

      if (route === "/shipments/documents/stage" && request.method === "POST") {
        if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment creation scope required", 403, id, headers);
        const payload = await bodyJson(request, 28 * 1024 * 1024);
        const requestHash = await payloadFingerprint(payload);
        const key = request.headers.get("Idempotency-Key");
        if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const endpoint = "POST /v1/shipments/documents/stage";
        const existing = await idempotentResponse(env, key, clientId, endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const documents = Array.isArray(payload.documents) ? payload.documents.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
        if (!documents.length || documents.length > 20) return error("VALIDATION_ERROR", "At least one and no more than 20 invoice documents may be staged", 400, id, headers);
        const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
        const staged: Array<{ object_key: string; name: string; content_type: string; size: number }> = [];
        let totalBytes = 0;
        try {
          for (const document of documents) {
            const name = String(document.name ?? "").trim();
            const contentType = String(document.content_type ?? "").split(";", 1)[0].trim().toLowerCase();
            const encoded = String(document.body_base64 ?? "").replace(/^data:[^,]+,/, "");
            if (!name || name.length > 200 || name.includes("\0") || !allowed.has(contentType) || !encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error("Invoice files must be valid PDF, JPG, or PNG documents");
            let binary: string;
            try { binary = atob(encoded); } catch { throw new Error("Invoice file content is not valid base64"); }
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            totalBytes += bytes.byteLength;
            if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024 || totalBytes > 20 * 1024 * 1024 || !documentSignatureMatches(contentType, bytes)) throw new Error("Invoice files must be valid documents up to 10 MB each and 20 MB total");
            const objectKey = `staged/clients/${clientId}/${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType }, customMetadata: { client_id: clientId, original_filename: name, content_type: contentType, staged_at: new Date().toISOString() } });
            staged.push({ object_key: objectKey, name, content_type: contentType, size: bytes.byteLength });
          }
        } catch (caught) {
          await Promise.all(staged.map((document) => env.FILES.delete(document.object_key).catch(() => undefined)));
          return error("INVOICE_DOCUMENT_INVALID", caught instanceof Error ? caught.message : "Invoice files could not be staged", 400, id, headers);
        }
        const serialized = JSON.stringify({ ok: true, data: { documents: staged }, request_id: id });
        await saveIdempotent(env, key, clientId, endpoint, 201, serialized, requestHash);
        await audit(env, ctx, auth, id, "shipment.invoice_staged", "shipment_document", staged.map((document) => document.object_key).join(","), { client_id: clientId, count: staged.length });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      if (route === "/shipments/preflight" && request.method === "POST") {
        if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment creation scope required", 403, id, headers);
        const payload = await bodyJson(request, 256 * 1024);
        const requestHash = await payloadFingerprint(payload);
        const key = request.headers.get("Idempotency-Key");
        if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const originAddress = shipmentAddress(payload.origin_address);
        const providerAccountId = typeof payload.provider_account_id === "string" ? payload.provider_account_id.trim() : "";
        const warehouseId = typeof payload.warehouse_id === "string" ? payload.warehouse_id.trim() : "";
        const paymentMode = String(payload.payment_mode ?? "prepaid").trim().toLowerCase() === "cod" ? "cod" : "prepaid";
        if (!originAddress || !providerAccountId) return error("VALIDATION_ERROR", "A complete pickup address and Delhivery account are required before confirmation", 400, id, headers);
        const endpoint = "POST /v1/shipments/preflight";
        const existing = await idempotentResponse(env, key, clientId, endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const providerResult = await safeProviderRequest(env, "delhivery", "warehouse_prepare", {
          provider: "delhivery",
          provider_account_id: providerAccountId,
          warehouse_id: warehouseId || undefined,
          origin_address: originAddress,
          origin: `${originAddress.city}, ${originAddress.state}`,
        }, id, clientId, key);
        if (providerResult.status !== "accepted") {
          const reason = String((providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? "Delhivery pickup location is not ready").slice(0, 500);
          const failed = JSON.stringify({ ok: false, error: { code: "PROVIDER_READINESS_FAILED", category: "provider", message: reason, user_safe_message: "The pickup location is not ready with Delhivery yet. Please retry before confirming the booking.", technical_message: reason, request_id: id, retryable: true }, request_id: id });
          await saveIdempotent(env, key, clientId, endpoint, 409, failed, requestHash);
          return new Response(failed, { status: 409, headers: { ...headers, "content-type": "application/json" } });
        }
        const destinationPincode = String((payload.destination_address as Record<string, unknown> | null)?.pincode ?? "").trim();
        const serviceability = await verifyDelhiveryServiceability(env, originAddress.pincode, destinationPincode, providerAccountId, id, clientId, paymentMode);
        if (!serviceability.ok) {
          const reason = serviceability.reason ?? "Delhivery serviceability could not be verified";
          const failed = JSON.stringify({ ok: false, error: { code: "PROVIDER_SERVICEABILITY_FAILED", category: "provider", message: reason, user_safe_message: "Delhivery cannot verify serviceability for this shipment yet. Check the pincodes before confirming.", technical_message: reason, request_id: id, retryable: true }, request_id: id });
          await saveIdempotent(env, key, clientId, endpoint, 409, failed, requestHash);
          return new Response(failed, { status: 409, headers: { ...headers, "content-type": "application/json" } });
        }
        const ready = JSON.stringify({ ok: true, data: { ready: true, provider: "delhivery", provider_status: (providerResult as { providerStatus?: number }).providerStatus ?? 200, warehouse_name: (providerResult as { warehouseName?: string }).warehouseName ?? null, serviceable: true, serviceability_provenance: serviceability.provenance }, request_id: id });
        await saveIdempotent(env, key, clientId, endpoint, 200, ready, requestHash);
        await audit(env, ctx, auth, id, "shipment.provider_readiness", "shipment", warehouseId || "new-warehouse", { client_id: clientId, provider: "delhivery" });
        return new Response(ready, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      if (route === "/shipments" && request.method === "POST") {
        if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment creation scope required", 403, id, headers);
        const payload = await bodyJson(request, 32 * 1024 * 1024);
        const bookingStartedAt = Date.now();
        const requestHash = await payloadFingerprint(payload);
        const description = typeof payload.description === "string" ? payload.description.trim() : "";
        const origin = typeof payload.origin === "string" ? payload.origin.trim() : "";
        const destination = typeof payload.destination === "string" ? payload.destination.trim() : "";
        const requestedOrderId = typeof payload.order_id === "string" ? payload.order_id.trim().slice(0, 80) : "";
        const invoiceReference = String(payload.invoice_reference ?? payload.invoice_number ?? "").trim().slice(0, 80);
        const resolvedOrderId = requestedOrderId || invoiceReference;
        if (!resolvedOrderId) return error("ORDER_ID_REQUIRED", "Order ID or invoice number is required before booking", 400, id, headers);
        payload.order_id = resolvedOrderId;
        const originAddress = shipmentAddress(payload.origin_address);
        const destinationAddress = shipmentAddress(payload.destination_address);
        const weight = Number(payload.total_weight_kg);
        const pieces = Number(payload.pieces);
        const declaredValue = Number(payload.declared_value ?? 0);
        const shipmentDimensions = normalizeShipmentDimensions(payload.dimensions);
        const dimensionsJson = shipmentDimensions.length ? JSON.stringify(shipmentDimensions) : null;
        if (!description || description.length > 500 || !origin || origin.length > 500 || !destination || destination.length > 500) return error("VALIDATION_ERROR", "Description, origin, and destination are required", 400, id, headers);
        if (!originAddress || !destinationAddress) return error("VALIDATION_ERROR", "Complete consignor and consignee addresses are required: name, address, city, state, six-digit pincode, and ten-digit phone", 400, id, headers);
        if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) return error("VALIDATION_ERROR", "Weight must be greater than 0 and within the supported limit", 400, id, headers);
        if (!Number.isInteger(pieces) || pieces < 1 || pieces > 10000) return error("VALIDATION_ERROR", "Pieces must be a whole number between 1 and 10,000", 400, id, headers);
        if (!Number.isFinite(declaredValue) || declaredValue < 0) return error("VALIDATION_ERROR", "Declared value must be a non-negative number", 400, id, headers);
        const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const kycRows = auth.accessToken
          ? await supabaseGet<{ status: string; gst_number: string | null; pan_number: string | null; aadhaar_last4: string | null; phone_verified_at: string | null; kyc_version: number | null }>(env, `client_kyc_profiles?client_id=eq.${encodeURIComponent(clientId)}&select=status,gst_number,pan_number,aadhaar_last4,phone_verified_at,kyc_version&limit=1`, auth.accessToken)
          : [];
        const kyc = kycRows[0];
        const kycTestAccount = await isKycTestAccount(env, auth);
        if ((!kyc || kyc.status !== "approved" || !kyc.gst_number?.trim() || !kyc.pan_number?.trim() || !kyc.aadhaar_last4 || !kyc.phone_verified_at) && !kycTestAccount) return error("KYC_REQUIRED", "Approved Aadhaar, GST, PAN, and OTP-verified mobile number are required before booking shipments", 403, id, headers);
        // Approved KYC remains authoritative for normal clients. The exact
        // allow-listed test account may fall back to request identity fields.
        if (kyc?.gst_number?.trim() && kyc.pan_number?.trim()) {
          payload.client_gst_tin = kyc.gst_number.trim();
          payload.client_gstin = kyc.gst_number.trim();
          payload.client_pan = kyc.pan_number.trim();
          payload.client_pan_number = kyc.pan_number.trim();
        }
        const shipmentGst = kyc?.gst_number?.trim() || String(payload.client_gst_tin ?? payload.client_gstin ?? "").trim() || null;
        const shipmentPan = kyc?.pan_number?.trim() || String(payload.client_pan ?? payload.client_pan_number ?? "").trim() || null;
        const key = request.headers.get("Idempotency-Key");
        if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/shipments", requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const provider = typeof payload.provider === "string" && ["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(payload.provider) ? payload.provider : (hasRole(auth, ["employee", "admin", "super_admin"]) ? "delhivery" : null);
        if ((auth.kind === "api" || hasRole(auth, ["client"])) && provider !== "delhivery") return error("DELHIVERY_B2B_ONLY", "Client shipment booking is currently limited to Delhivery B2B", 409, id, headers);
        let liveServiceabilityProvenance: DelhiveryServiceabilityResult["provenance"] | null = null;
        if (provider === "delhivery") {
          const requestedProviderAccountId = typeof payload.provider_account_id === "string" && payload.provider_account_id.trim() ? payload.provider_account_id.trim() : null;
          const liveProviderAccountId = await resolveDelhiveryProviderAccountId(env, clientId, requestedProviderAccountId);
          if (!liveProviderAccountId) return error("PROVIDER_ACCOUNT_REQUIRED", "An active Delhivery account is required for live serviceability verification", 409, id, headers);
          payload.provider_account_id = liveProviderAccountId;
          const liveServiceability = await verifyDelhiveryServiceability(env, originAddress.pincode, destinationAddress.pincode, liveProviderAccountId, id, clientId, String(payload.payment_mode ?? "prepaid").trim().toLowerCase() === "cod" ? "cod" : "prepaid", weight);
          if (!liveServiceability.ok) return error("PROVIDER_SERVICEABILITY_FAILED", liveServiceability.reason ?? "Delhivery could not verify this route", 409, id, headers, JSON.stringify({ provenance: liveServiceability.provenance, origin: liveServiceability.origin, destination: liveServiceability.destination, route: liveServiceability.route }));
          liveServiceabilityProvenance = liveServiceability.provenance;
        }
        const selectedWarehouseId = typeof payload.warehouse_id === "string" ? payload.warehouse_id.trim() : "";
        if (provider === "delhivery" && selectedWarehouseId) {
          const selectedWarehouse = await env.DB.prepare("SELECT id FROM warehouses WHERE id = ? AND client_id = ? LIMIT 1").bind(selectedWarehouseId, clientId).first<{ id: string }>();
          if (!selectedWarehouse) return error("WAREHOUSE_NOT_FOUND", "The selected pickup warehouse no longer exists for this client. Select it again before booking.", 404, id, headers);
        }
        let stagedInvoiceObjectKeys: string[] = [];
        if (provider === "delhivery" && Array.isArray(payload.invoice_document_refs) && payload.invoice_document_refs.length) {
          const stagedDocuments = await loadStagedInvoiceDocuments(env, clientId, payload.invoice_document_refs);
          if (!stagedDocuments.ok) return error("INVOICE_DOCUMENT_INVALID", stagedDocuments.error, 400, id, headers);
          stagedInvoiceObjectKeys = stagedDocuments.objectKeys;
          payload.invoice_documents = stagedDocuments.documents.map((document) => ({ name: document.name, content_type: document.content_type, body_base64: document.body_base64, invoice_number: invoiceReference }));
          delete payload.invoice_document_refs;
        }
        if (provider === "delhivery" && (!Array.isArray(payload.invoice_documents) || payload.invoice_documents.length < 1)) return error("INVOICE_DOCUMENT_REQUIRED", "Upload at least one invoice document before booking this Delhivery B2B shipment", 400, id, headers);
        const pricingQuoteId = typeof payload.pricing_quote_id === "string" ? payload.pricing_quote_id.trim() : "";
        const submittedPricingQuote = pricingQuoteId ? await env.DB.prepare("SELECT id, version_id, account_scope, origin_zone, destination_zone, chargeable_weight_kg, client_breakdown_json, expires_at FROM pricing_quotes WHERE id = ? AND client_id = ? LIMIT 1").bind(pricingQuoteId, clientId).first<PricingQuoteRecord & { expires_at: string }>() : null;
        if (pricingQuoteId && !submittedPricingQuote) return error("PRICING_QUOTE_NOT_FOUND", "The submitted PSS quote was not found for this client. Request a fresh quote before booking.", 409, id, headers);
        if (pricingQuoteId && submittedPricingQuote && Date.parse(`${submittedPricingQuote.expires_at.replace(" ", "T")}Z`) <= Date.now()) return error("PRICING_QUOTE_EXPIRED", "The submitted PSS quote has expired. Request a fresh quote before booking.", 409, id, headers);
        let pricingQuote: PricingQuoteRecord | null = null;
        const pricingStartedAt = Date.now();
        if (provider === "delhivery") {
          try {
            const recalculatedQuote = await createShipmentPricingQuote(env, clientId, payload, auth.userId ?? `api:${clientId}`);
            if (submittedPricingQuote) {
              const submittedTotal = Number((JSON.parse(submittedPricingQuote.client_breakdown_json) as { total?: number }).total ?? NaN);
              const recalculatedTotal = Number((JSON.parse(recalculatedQuote.client_breakdown_json) as { total?: number }).total ?? NaN);
              const quoteMatches = submittedPricingQuote.version_id === recalculatedQuote.version_id && submittedPricingQuote.account_scope === recalculatedQuote.account_scope && submittedPricingQuote.origin_zone === recalculatedQuote.origin_zone && submittedPricingQuote.destination_zone === recalculatedQuote.destination_zone && Math.abs(Number(submittedPricingQuote.chargeable_weight_kg) - Number(recalculatedQuote.chargeable_weight_kg)) < 0.0001 && Math.abs(submittedTotal - recalculatedTotal) < 0.01;
              if (!quoteMatches) return error("PRICING_QUOTE_STALE", "The PSS quote changed or no longer matches this shipment. Request a fresh quote before booking.", 409, id, headers);
            }
            pricingQuote = recalculatedQuote;
          } catch (caught) { const reason = caught instanceof Error ? caught.message : "PRICING_FAILED"; const knownCodes = new Set(["PRICING_NOT_CONFIGURED", "PRICING_ADDRESS_REQUIRED", "INVALID_ACCOUNT_CODE", "RTO_SOURCE_REQUIRED", "RTO_SOURCE_NOT_FOUND", "RTO_SOURCE_INVALID"]); const code = knownCodes.has(reason) ? reason : "PRICING_INVALID"; return error(code, code === "PRICING_NOT_CONFIGURED" ? "A published Delhivery B2B PSS rate card is not configured for this client" : code === "RTO_SOURCE_REQUIRED" ? "An original shipment is required to price an RTO" : code === "RTO_SOURCE_NOT_FOUND" ? "The original shipment pricing snapshot could not be found" : "The shipment could not be priced using the client PSS rate card", 409, id, headers); }
        }
        const pricingAmount = pricingQuote ? Number((JSON.parse(pricingQuote.client_breakdown_json) as { total?: number }).total ?? 0) : 0;
        const pricingDurationMs = Date.now() - pricingStartedAt;
        if (pricingQuote && pricingAmount <= 0) return error("PRICING_INVALID", "The PSS pricing snapshot is invalid", 409, id, headers);
        if (pricingQuote) {
          const wallet = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN lower(COALESCE(type, '')) IN ('debit', 'charge', 'withdrawal') THEN -ABS(amount) ELSE ABS(amount) END), 0) AS balance FROM wallet_transactions WHERE client_id = ? AND status IN ('posted', 'approved')").bind(clientId).first<{ balance: number }>();
          if (Number(wallet?.balance ?? 0) < pricingAmount) return error("INSUFFICIENT_WALLET_BALANCE", "The client wallet does not have enough balance for this PSS booking", 409, id, headers);
        }
        const shipmentId = crypto.randomUUID();
        const requestedProviderAccountId = typeof payload.provider_account_id === "string" && payload.provider_account_id.trim() ? payload.provider_account_id.trim() : null;
        await env.DB.prepare("INSERT INTO shipments (id, order_id, client_id, created_by_user_id, provider, provider_account_id, client_gst_number, client_pan_number, kyc_version, status, description, origin, destination, origin_address_json, destination_address_json, consignee, total_weight_kg, declared_value, pieces, edd, dimensions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(shipmentId, resolvedOrderId, clientId, auth.userId ?? `api:${clientId}`, provider, requestedProviderAccountId, shipmentGst, shipmentPan, kyc?.kyc_version ?? null, description, origin, destination, JSON.stringify(originAddress), JSON.stringify(destinationAddress), String(destinationAddress.name), weight, declaredValue, pieces, typeof payload.edd === "string" ? payload.edd : null, dimensionsJson).run();
        await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'booked', 'Shipment created', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipmentId, auth.userId ?? `api:${clientId}`).run();
        const storedDocuments = await persistShipmentDocuments(env, clientId, shipmentId, payload.invoice_documents, auth.userId ?? `api:${clientId}`);
        if (!storedDocuments.ok) {
          await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(shipmentId, clientId).run();
          return error("INVOICE_DOCUMENT_INVALID", storedDocuments.error, 400, id, headers);
        }
        if (provider === "delhivery" && payload.eway_document && typeof payload.eway_document === "object") {
          const ewayDocument = payload.eway_document as Record<string, unknown>;
          const storedEway = await persistShipmentDocuments(env, clientId, shipmentId, [{
            ...ewayDocument,
            name: String(ewayDocument.name ?? "eway-bill"),
          }], auth.userId ?? `api:${clientId}`);
          if (!storedEway.ok) {
            await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(shipmentId, clientId).run();
            return error("EWAY_DOCUMENT_INVALID", "The E-Way Bill could not be saved before the Delhivery booking request", 400, id, headers);
          }
          delete payload.eway_document;
        }
        if (stagedInvoiceObjectKeys.length) await Promise.all(stagedInvoiceObjectKeys.map((objectKey) => env.FILES.delete(objectKey).catch(() => undefined)));
        if (pricingQuote) await env.DB.prepare("INSERT INTO weight_reconciliations (id, client_id, shipment_id, declared_weight_kg, declared_volumetric_weight_kg, initial_billable_weight_kg, measured_weight_kg, billable_weight_kg, client_dispute_deadline_at, status) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'pending')").bind(crypto.randomUUID(), clientId, shipmentId, weight, volumetricWeightFromPayload(payload), pricingQuote.chargeable_weight_kg, pricingQuote.chargeable_weight_kg).run();
        if (pricingQuote) await env.DB.prepare("INSERT INTO pricing_shipment_snapshots (id, shipment_id, client_id, quote_id, version_id, account_scope, origin_zone, destination_zone, chargeable_weight_kg, client_breakdown_json, original_client_breakdown_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), shipmentId, clientId, pricingQuote.id, pricingQuote.version_id, pricingQuote.account_scope, pricingQuote.origin_zone, pricingQuote.destination_zone, pricingQuote.chargeable_weight_kg, pricingQuote.client_breakdown_json, pricingQuote.client_breakdown_json).run();
        const retryPayload = provider === "delhivery" ? providerRetryPayload(payload) : null;
        if (retryPayload) {
          await env.DB.prepare("UPDATE shipments SET provider_booking_payload_json = ?, provider_retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
            .bind(JSON.stringify(retryPayload), shipmentId, clientId).run();
        }
        const providerStartedAt = Date.now();
        const providerResult = provider ? await safeProviderRequest(env, provider as CourierProvider, "shipments", { shipment_id: shipmentId, ...payload }, id, clientId, key) : { enabled: false, status: "not_requested" as const };
        console.log(JSON.stringify({ event: "shipment_booking_timing", request_id: id, shipment_id: shipmentId, provider: provider ?? "none", pricing_ms: pricingDurationMs, provider_ms: Date.now() - providerStartedAt, total_ms: Date.now() - bookingStartedAt, provider_result: providerResult.status }));
        const selectedProviderAccountId = (providerResult as { provider_account_id?: string }).provider_account_id;
        if (selectedProviderAccountId) await env.DB.prepare("UPDATE shipments SET provider_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(selectedProviderAccountId, shipmentId, clientId).run();
        if (provider === "delhivery") await env.DB.prepare("INSERT OR REPLACE INTO pricing_provider_costs (id, shipment_id, client_id, provider, provider_account_id, provider_amount, provider_status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), shipmentId, clientId, provider, selectedProviderAccountId ?? null, providerAmount(providerResult), providerResult.status).run();
        if (provider && providerResult.status !== "accepted") {
          const failureReason = String((providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? `The ${provider} shipment was not accepted`).slice(0, 500);
          const providerCode = String((providerResult as { code?: string }).code ?? "") || (provider === "delhivery" && /awaiting provider activation|not active|not (?:been )?configured|warehouse.*activation|pickup.*warehouse.*pending/i.test(failureReason) ? "WAREHOUSE_ACTIVATION_PENDING" : "");
          const warehouseActivationPending = provider === "delhivery" && (providerCode === "WAREHOUSE_ACTIVATION_PENDING" || /warehouse.*not configured|warehouse.*activation|pickup.*warehouse.*pending/i.test(failureReason));
          if (warehouseActivationPending && retryPayload) {
            const queuedReason = `Delhivery rejected the pickup warehouse while it activates: ${failureReason}`.slice(0, 500);
            await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'pending', provider_booking_payload_json = ?, provider_retry_at = datetime('now', '+5 minutes'), provider_retry_count = 0, provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
              .bind(JSON.stringify(retryPayload), queuedReason, shipmentId, clientId).run();
            await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'booked', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
              .bind(crypto.randomUUID(), shipmentId, "Booking queued for automatic retry after Delhivery pickup-warehouse activation", auth.userId ?? `api:${clientId}`).run();
            const queuedResponse = JSON.stringify({ ok: true, data: { id: shipmentId, client_id: clientId, status: "booked", provider, provider_status: "pending", retry_at: "scheduled", message: "Delhivery is activating the pickup warehouse; the booking will retry automatically." }, request_id: id });
            await saveIdempotent(env, key, clientId, "POST /v1/shipments", 202, queuedResponse, requestHash);
            await audit(env, ctx, auth, id, "shipment.provider_retry_queued", "shipment", shipmentId, { client_id: clientId, provider, reason: failureReason });
            return new Response(queuedResponse, { status: 202, headers: { ...headers, "content-type": "application/json" } });
          }
          await env.DB.prepare("UPDATE shipments SET status = 'exception', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(shipmentId, clientId).run();
          await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'exception', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipmentId, `Provider booking failed: ${failureReason}`, auth.userId ?? `api:${clientId}`).run();
          const failureCode = "PROVIDER_REQUEST_FAILED";
          const failedResponse = JSON.stringify({ ok: false, error: { code: failureCode, category: "provider", message: "The shipment could not be booked with the courier. You can retry after checking the provider status.", user_safe_message: "The courier did not accept this booking; retry after correcting the provider issue.", technical_message: failureReason, provider_code: providerCode || failureCode, request_id: id, retryable: true, stale_data: false }, data: { id: shipmentId, client_id: clientId, status: "exception", provider, pricing_amount: null }, request_id: id });
          await saveIdempotent(env, key, clientId, "POST /v1/shipments", 502, failedResponse, requestHash);
          await audit(env, ctx, auth, id, "shipment.provider_failed", "shipment", shipmentId, { client_id: clientId, provider, reason: failureReason });
          return new Response(failedResponse, { status: 502, headers: { ...headers, "content-type": "application/json" } });
        }
        const providerLr = String((providerResult as { lr_number?: string | null }).lr_number ?? "").trim();
        const providerAwb = String((providerResult as { master_awb?: string | null }).master_awb ?? "").trim();
        const providerReference = String((providerResult as { providerReference?: string | null }).providerReference ?? "").trim();
        if (provider === "delhivery" && (!providerLr && !providerAwb && !providerReference)) {
          const providerBookingId = String((providerResult as { providerBookingId?: string | null }).providerBookingId ?? "").trim() || null;
          const timeoutReason = "Delhivery accepted the manifest but did not return an LR/AWB within the synchronous booking window";
          await env.DB.prepare("UPDATE shipments SET provider_booking_id = COALESCE(?, provider_booking_id), provider_sync_status = 'pending', status = 'exception', provider_booking_payload_json = NULL, provider_retry_at = NULL, provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
            .bind(providerBookingId, timeoutReason, shipmentId, clientId).run();
          await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'exception', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
            .bind(crypto.randomUUID(), shipmentId, timeoutReason, auth.userId ?? `api:${clientId}`).run();
          const timeoutResponse = JSON.stringify({ ok: false, error: { code: "PROVIDER_LR_TIMEOUT", category: "provider", message: timeoutReason, user_safe_message: "Delhivery did not return the LR yet. Booking was not confirmed or billed; retry after checking the provider status.", technical_message: timeoutReason, provider_code: "PROVIDER_LR_TIMEOUT", request_id: id, retryable: true, stale_data: false }, data: { id: shipmentId, client_id: clientId, status: "exception", provider, provider_booking_id: providerBookingId, pricing_amount: null }, request_id: id });
          await saveIdempotent(env, key, clientId, "POST /v1/shipments", 504, timeoutResponse, requestHash);
          await audit(env, ctx, auth, id, "shipment.provider_lr_timeout", "shipment", shipmentId, { client_id: clientId, provider, provider_booking_id: providerBookingId });
          return new Response(timeoutResponse, { status: 504, headers: { ...headers, "content-type": "application/json" } });
        }
        if (pricingQuote) {
          const completedBilling = await completeShipmentBilling(env, clientId, shipmentId);
          if (!completedBilling.ok) {
            const billingFailure = "The LR was received, but the PSS wallet transaction could not be completed safely. Contact support before retrying.";
            await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(completedBilling.error, shipmentId, clientId).run();
            const failedBillingResponse = JSON.stringify({ ok: false, error: { code: "BILLING_FAILED", category: "request", message: billingFailure, user_safe_message: billingFailure, technical_message: completedBilling.error, request_id: id, retryable: false, stale_data: false }, data: { id: shipmentId, client_id: clientId, status: "exception", provider, lr_number: providerLr || null, master_awb: providerAwb || null }, request_id: id });
            await saveIdempotent(env, key, clientId, "POST /v1/shipments", 409, failedBillingResponse, requestHash);
            await audit(env, ctx, auth, id, "shipment.billing_failed", "shipment", shipmentId, { client_id: clientId, provider, reason: completedBilling.error });
            return new Response(failedBillingResponse, { status: 409, headers: { ...headers, "content-type": "application/json" } });
          }
        }
        // Return only provider-owned references. Delhivery may assign the LR
        // asynchronously, so read persisted courier values after the provider call.
        const bookedShipment = await env.DB.prepare("SELECT tracking_number, lr_number, provider_reference FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(shipmentId, clientId).first<{ tracking_number: string | null; lr_number: string | null; provider_reference: string | null }>();
        const serialized = JSON.stringify({ ok: true, data: { id: shipmentId, client_id: clientId, status: "booked", provider, tracking_number: bookedShipment?.tracking_number ?? null, lr_number: bookedShipment?.lr_number ?? null, provider_reference: bookedShipment?.provider_reference ?? null, pricing_amount: pricingAmount || null, provider_status: providerResult.status, ...(liveServiceabilityProvenance ? { serviceability_provenance: liveServiceabilityProvenance } : {}) }, request_id: id });
        await saveIdempotent(env, key, clientId, "POST /v1/shipments", 201, serialized, requestHash);
        await audit(env, ctx, auth, id, "shipment.created", "shipment", shipmentId, { client_id: clientId, provider });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const shipmentRetry = route.match(/^\/shipments\/([^/]+)\/retry-booking$/);
      if (shipmentRetry && request.method === "POST") {
        if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment booking permission required", 403, id, headers);
        const shipment = await env.DB.prepare("SELECT id, client_id, provider, provider_account_id, status, provider_reference, tracking_number, lr_number, master_awb, provider_booking_id, order_id, description, origin, destination, origin_address_json, destination_address_json, consignee, total_weight_kg, declared_value, pieces, dimensions_json, edd, client_gst_number, client_pan_number, kyc_version, provider_booking_payload_json FROM shipments WHERE id = ? LIMIT 1").bind(shipmentRetry[1]).first<Record<string, unknown>>();
        if (!shipment || !canAccessClient(auth, String(shipment.client_id))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const shipmentClientId = String(shipment.client_id);
        if (String(shipment.provider ?? "").toLowerCase() !== "delhivery") return error("PROVIDER_UNSUPPORTED", "Only Delhivery bookings can be retried from this panel", 409, id, headers);
        if (String(shipment.status ?? "").toLowerCase() !== "exception") return error("CONFLICT", "Only failed shipments can be retried", 409, id, headers);
        if ([shipment.provider_reference, shipment.tracking_number, shipment.lr_number, shipment.master_awb, shipment.provider_booking_id].some((value) => String(value ?? "").trim())) return error("CONFLICT", "This shipment already has a Delhivery reference. Refresh it instead of retrying the booking.", 409, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const requestHash = await payloadFingerprint({ shipment_id: shipment.id, retry: true });
        const endpoint = `POST /v1/shipments/${shipment.id}/retry-booking`;
        const existing = await idempotentResponse(env, key, shipmentClientId, endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const savedPayload = parseJsonRecord(String(shipment.provider_booking_payload_json ?? ""));
        const originAddress = parseJsonRecord(String(shipment.origin_address_json ?? ""));
        const destinationAddress = parseJsonRecord(String(shipment.destination_address_json ?? ""));
        if (!originAddress || !destinationAddress) return error("RETRY_DATA_INCOMPLETE", "The failed shipment is missing a complete pickup or delivery address", 409, id, headers);
        const payload = savedPayload ?? {
          client_id: shipmentClientId,
          provider: "delhivery",
          provider_account_id: shipment.provider_account_id,
          order_id: shipment.order_id,
          invoice_reference: shipment.order_id,
          description: shipment.description,
          origin: shipment.origin,
          destination: shipment.destination,
          origin_address: originAddress,
          destination_address: destinationAddress,
          consignee: shipment.consignee,
          total_weight_kg: shipment.total_weight_kg,
          declared_value: shipment.declared_value,
          pieces: shipment.pieces,
          dimensions: parseJsonArray(String(shipment.dimensions_json ?? "")),
          client_gst_tin: shipment.client_gst_number,
          client_gstin: shipment.client_gst_number,
          client_pan: shipment.client_pan_number,
          client_pan_number: shipment.client_pan_number,
          kyc_version: shipment.kyc_version,
          edd: shipment.edd,
        } as Record<string, unknown>;
        payload.shipment_id = shipment.id;
        payload.provider = "delhivery";
        payload.provider_account_id = shipment.provider_account_id ?? payload.provider_account_id;
        let invoiceDocuments: Array<Record<string, unknown>>;
        try {
          invoiceDocuments = await loadShipmentInvoiceDocumentsForRetry(env, shipmentClientId, String(shipment.id), payload);
        } catch (caught) {
          const reason = caught instanceof Error ? caught.message : "retry_invoice_documents_missing";
          return error("INVOICE_DOCUMENT_REQUIRED", "The original invoice document is unavailable. Upload the invoice again before retrying this booking.", 409, id, headers, JSON.stringify({ technical_message: reason }));
        }
        await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'pending', provider_booking_payload_json = ?, provider_retry_at = NULL, provider_last_error = NULL, provider_retry_count = provider_retry_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
          .bind(JSON.stringify(providerRetryPayload(payload)), shipment.id, shipmentClientId).run();
        await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'booked', 'Manual booking retry initiated', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
          .bind(crypto.randomUUID(), shipment.id, auth.userId ?? `api:${shipmentClientId}`).run();
        const providerResult = await safeProviderRequest(env, "delhivery", "shipments", { shipment_id: shipment.id, ...payload, invoice_documents: invoiceDocuments, provider_account_id: shipment.provider_account_id ?? payload.provider_account_id }, id, shipmentClientId, key, 25000);
        if (providerResult.status !== "accepted") {
          const reason = String((providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? "Delhivery did not accept the booking retry").slice(0, 500);
          const activationPending = /awaiting provider activation|not active|not configured|has not been configured|warehouse.*configured/i.test(reason);
          if (activationPending) {
            await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'pending', provider_retry_at = datetime('now', '+5 minutes'), provider_retry_count = provider_retry_count + 1, provider_last_error = ?, provider_booking_payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?")
              .bind(reason, JSON.stringify(providerRetryPayload(payload)), shipment.id, shipmentClientId).run();
            await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'booked', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
              .bind(crypto.randomUUID(), shipment.id, "Delhivery is still activating the pickup warehouse; automatic retry scheduled", auth.userId ?? `api:${shipmentClientId}`).run();
            const pending = JSON.stringify({ ok: true, data: { id: shipment.id, status: "booked", provider_status: "pending", message: "Delhivery is still activating the pickup warehouse; the booking will retry automatically." }, request_id: id });
            await saveIdempotent(env, key, shipmentClientId, endpoint, 202, pending, requestHash);
            return new Response(pending, { status: 202, headers: { ...headers, "content-type": "application/json" } });
          }
          await env.DB.prepare("UPDATE shipments SET status = 'exception', provider_sync_status = 'failed', provider_last_error = ?, provider_booking_payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(reason, JSON.stringify(providerRetryPayload(payload)), shipment.id, shipmentClientId).run();
          await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'exception', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipment.id, `Booking retry failed: ${reason}`, auth.userId ?? `api:${shipmentClientId}`).run();
          const failed = JSON.stringify({ ok: false, error: { code: "PROVIDER_REQUEST_FAILED", category: "provider", message: "Delhivery still did not accept this booking.", user_safe_message: "Delhivery still did not accept this booking. The shipment remains retryable.", technical_message: reason, provider_code: (providerResult as { code?: string }).code ?? "PROVIDER_REQUEST_FAILED", request_id: id, retryable: true }, data: { id: shipment.id, status: "exception" }, request_id: id });
          await saveIdempotent(env, key, shipmentClientId, endpoint, 502, failed, requestHash);
          return new Response(failed, { status: 502, headers: { ...headers, "content-type": "application/json" } });
        }
        const providerLr = String((providerResult as { lr_number?: string | null }).lr_number ?? "").trim();
        const providerAwb = String((providerResult as { master_awb?: string | null }).master_awb ?? "").trim();
        const providerReference = String((providerResult as { providerReference?: string | null }).providerReference ?? "").trim();
        const providerBookingId = String((providerResult as { providerBookingId?: string | null }).providerBookingId ?? "").trim();
        const hasReference = Boolean(providerLr || providerAwb || providerReference || providerBookingId);
        if (!hasReference) {
          const pending = JSON.stringify({ ok: true, data: { id: shipment.id, status: "booked", provider_status: "pending", message: "Delhivery accepted the retry and is still issuing the LR." }, request_id: id });
          await saveIdempotent(env, key, shipmentClientId, endpoint, 202, pending, requestHash);
          return new Response(pending, { status: 202, headers: { ...headers, "content-type": "application/json" } });
        }
        const snapshot = await env.DB.prepare("SELECT 1 AS present FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(shipment.id, shipmentClientId).first<{ present: number }>();
        if (snapshot) {
          const billing = await completeShipmentBilling(env, shipmentClientId, String(shipment.id));
          if (!billing.ok) return error("BILLING_FAILED", "Delhivery accepted the booking, but the PSS wallet transaction could not be completed safely. Contact support before retrying.", 409, id, headers);
        }
        await env.DB.prepare("UPDATE shipments SET status = 'booked', provider_sync_status = 'confirmed', provider_booking_payload_json = NULL, provider_retry_at = NULL, provider_last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(shipment.id, shipmentClientId).run();
        const success = JSON.stringify({ ok: true, data: { id: shipment.id, status: "booked", lr_number: providerLr || null, master_awb: providerAwb || null, provider_reference: providerReference || null, provider_booking_id: providerBookingId || null, provider_status: "accepted" }, request_id: id });
        await saveIdempotent(env, key, shipmentClientId, endpoint, 200, success, requestHash);
        await audit(env, ctx, auth, id, "shipment.provider_retry_succeeded", "shipment", String(shipment.id), { client_id: shipmentClientId, provider: "delhivery" });
        return new Response(success, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      const shipmentUpdate = route.match(/^\/shipments\/([^/]+)$/);
      if (shipmentUpdate && request.method === "PATCH") {
        if (!hasRole(auth, ["employee", "admin", "super_admin"]) && !hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment update permission required", 403, id, headers);
        const current = await env.DB.prepare("SELECT client_id, status, weight_override_kg FROM shipments WHERE id = ? LIMIT 1").bind(shipmentUpdate[1]).first<{ client_id: string; status: string; weight_override_kg: number | null }>();
        if (!current || !canAccessClient(auth, current.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const payload = await bodyJson(request);
        const clientActor = hasRole(auth, ["client"]) && !hasRole(auth, ["employee", "admin", "super_admin"]);
        if (clientActor && Object.keys(payload).some((field) => field !== "status")) return error("FORBIDDEN", "Clients may only cancel their own shipment", 403, id, headers);
        const requestHash = await payloadFingerprint(payload);
        const allowed = ["provider", "provider_reference", "tracking_number", "lr_number", "status", "description", "origin", "destination", "consignee", "total_weight_kg", "declared_value", "pieces", "edd", "delivered_at"] as const;
        const updates = allowed.filter((field) => typeof payload[field] === "string" || typeof payload[field] === "number").map((field) => ({ field, value: payload[field] }));
        if (!updates.length) return error("VALIDATION_ERROR", "A supported shipment update is required", 400, id, headers);
        if (payload.provider !== undefined && payload.provider !== null && !new Set(["delhivery", "ekart", "trackon", "xpressbees", "rivigo"]).has(String(payload.provider))) return error("VALIDATION_ERROR", "Unsupported shipment provider", 400, id, headers);
        const status = payload.status === undefined ? null : String(payload.status).toLowerCase();
        if (status && !["booked", "picked_up", "in_transit", "out_for_delivery", "delivered", "cancelled", "exception", "rto"].includes(status)) return error("VALIDATION_ERROR", "Unsupported shipment status", 400, id, headers);
        if (status && !validShipmentTransition(String(current.status).toLowerCase(), status)) return error("CONFLICT", `Shipment cannot transition from ${current.status} to ${status}`, 409, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `PATCH /v1/shipments/${shipmentUpdate[1]}`; const existing = await idempotentResponse(env, key, current.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const normalized = updates;
        const weightUpdate = normalized.find((update) => update.field === "total_weight_kg");
        if (weightUpdate && (!Number.isFinite(Number(weightUpdate.value)) || Number(weightUpdate.value) <= 0)) return error("VALIDATION_ERROR", "Weight must be greater than 0", 400, id, headers);
        const weightMeta = weightUpdate ? ", weight_override_kg = ?, weight_source = 'manual', weight_updated_at = CURRENT_TIMESTAMP" : "";
        const deliveredClause = status === "delivered" ? ", delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)" : "";
        await env.DB.prepare(`UPDATE shipments SET ${normalized.map((update) => `${update.field} = ?`).join(", ")}${weightMeta}, updated_at = CURRENT_TIMESTAMP${deliveredClause} WHERE id = ?`).bind(...normalized.map((update) => update.value), ...(weightUpdate ? [Number(weightUpdate.value)] : []), shipmentUpdate[1]).run();
        if (status) await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipmentUpdate[1], status, "Shipment updated", auth.userId ?? `api:${current.client_id}`).run();
        await audit(env, ctx, auth, id, "shipment.updated", "shipment", shipmentUpdate[1], { client_id: current.client_id, fields: normalized.map((update) => update.field) });
        const serialized = JSON.stringify({ ok: true, data: { id: shipmentUpdate[1], ...Object.fromEntries(normalized.map((update) => [update.field, update.value])), ...(status === "delivered" ? { delivered_at: "CURRENT_TIMESTAMP" } : {}) }, request_id: id }); await saveIdempotent(env, key, current.client_id, endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      if (shipmentUpdate && request.method === "DELETE") {
        if (!hasRole(auth, ["employee", "admin", "super_admin"]) && !hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment deletion permission required", 403, id, headers);
        const current = await env.DB.prepare("SELECT id, client_id, status, provider_reference, tracking_number, lr_number FROM shipments WHERE id = ? LIMIT 1").bind(shipmentUpdate[1]).first<{ id: string; client_id: string; status: string; provider_reference: string | null; tracking_number: string | null; lr_number: string | null }>();
        if (!current || !canAccessClient(auth, current.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        if (!new Set(["cancelled", "exception"]).has(String(current.status).toLowerCase())) return error("CONFLICT", "Only cancelled or failed shipments can be deleted", 409, id, headers);
        if (current.lr_number || current.tracking_number || current.provider_reference) return error("CONFLICT", "A shipment with a courier reference cannot be deleted", 409, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const requestHash = await payloadFingerprint({ id: shipmentUpdate[1], deleted: true });
        const endpoint = `DELETE /v1/shipments/${shipmentUpdate[1]}`;
        const existing = await idempotentResponse(env, key, current.client_id, endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.batch([
          env.DB.prepare("DELETE FROM pickup_request_shipments WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("UPDATE pickup_requests SET shipment_id = NULL WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM tracking_events WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM shipment_documents WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM pricing_provider_costs WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM pricing_shipment_snapshots WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM weight_reconciliation_tickets WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM weight_reconciliations WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM pricing_overrides WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM billing_line_items WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM billing_amendments WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM billing_records WHERE shipment_id = ? AND client_id = ?").bind(current.id, current.client_id),
          env.DB.prepare("DELETE FROM cod_remittances WHERE shipment_id = ? AND client_id = ?").bind(current.id, current.client_id),
          env.DB.prepare("DELETE FROM return_shipments WHERE shipment_id = ?").bind(current.id),
          env.DB.prepare("DELETE FROM shipments WHERE id = ? AND client_id = ?").bind(current.id, current.client_id),
        ]);
        await audit(env, ctx, auth, id, "shipment.deleted", "shipment", current.id, { client_id: current.client_id, status: current.status });
        const serialized = JSON.stringify({ ok: true, data: { id: current.id, deleted: true }, request_id: id });
        await saveIdempotent(env, key, current.client_id, endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      const trackingPost = route.match(/^\/shipments\/([^/]+)\/tracking$/);
      if (trackingPost && request.method === "POST") {
        if (!hasRole(auth, ["employee", "admin", "super_admin"])) return error("FORBIDDEN", "Employee or administrator role required", 403, id, headers);
        const shipment = await env.DB.prepare("SELECT client_id, status FROM shipments WHERE id = ? LIMIT 1").bind(trackingPost[1]).first<{ client_id: string; status: string }>();
        if (!shipment || !canAccessClient(auth, shipment.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const payload = await bodyJson(request);
        const requestHash = await payloadFingerprint(payload);
        const nextStatus = typeof payload.status === "string" ? payload.status.trim().toLowerCase().replaceAll(" ", "_") : "";
        if (!nextStatus || !shipmentTransitions[nextStatus]) return error("VALIDATION_ERROR", "A supported tracking status is required", 400, id, headers);
        if (!validShipmentTransition(String(shipment.status).toLowerCase(), nextStatus)) return error("CONFLICT", `Shipment cannot transition from ${shipment.status} to ${nextStatus}`, 409, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, shipment.client_id, `POST /v1/shipments/${trackingPost[1]}/tracking`, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), trackingPost[1], nextStatus, String(payload.location ?? ""), String(payload.note ?? ""), auth.userId ?? `api:${shipment.client_id}`).run();
        await env.DB.prepare("UPDATE shipments SET status = ?, updated_at = CURRENT_TIMESTAMP, delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END WHERE id = ?").bind(nextStatus, nextStatus, trackingPost[1]).run();
        await audit(env, ctx, auth, id, "shipment.tracking_updated", "shipment", trackingPost[1], { status: nextStatus });
        const serialized = JSON.stringify({ ok: true, data: { shipment_id: trackingPost[1], status: nextStatus }, request_id: id }); await saveIdempotent(env, key, shipment.client_id, `POST /v1/shipments/${trackingPost[1]}/tracking`, 201, serialized, requestHash);
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const shipmentDocuments = route.match(/^\/shipments\/([^/]+)\/documents$/);
      if (shipmentDocuments && request.method === "GET") {
        if (!hasScope(auth, "documents.read")) return error("FORBIDDEN", "Document read scope required", 403, id, headers);
        const shipment = await env.DB.prepare("SELECT client_id FROM shipments WHERE id = ? LIMIT 1").bind(shipmentDocuments[1]).first<{ client_id: string }>();
        if (!shipment || !canAccessClient(auth, shipment.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const documents = await env.DB.prepare("SELECT id, shipment_id, original_filename, content_type, file_size_bytes, uploaded_by_user_id, created_at FROM shipment_documents WHERE shipment_id = ? ORDER BY created_at DESC").bind(shipmentDocuments[1]).all();
        return json({ ok: true, data: documents.results }, 200, headers);
      }

      const shipmentArtifact = route.match(/^\/shipments\/([^/]+)\/(label|sticker|lr-copy|document)$/);
      if (shipmentArtifact && request.method === "GET") {
        if (!hasScope(auth, "tracking.read") && !hasScope(auth, "documents.read")) return error("FORBIDDEN", "Tracking or document read scope required", 403, id, headers);
         let shipment = await env.DB.prepare("SELECT s.id, s.client_id, s.provider, s.pss_reference, s.lr_number, s.master_awb, s.tracking_number, s.provider_reference, s.provider_booking_id, s.provider_account_id, s.pieces, (SELECT pr.provider_reference FROM pickup_requests pr WHERE pr.shipment_id = s.id AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference FROM shipments s WHERE s.id = ? LIMIT 1").bind(shipmentArtifact[1]).first<{ id: string; client_id: string; provider: string | null; pss_reference: string | null; lr_number: string | null; master_awb: string | null; tracking_number: string | null; provider_reference: string | null; provider_booking_id: string | null; provider_account_id: string | null; pieces: number | null; pickup_reference: string | null }>();
        if (!shipment || !canAccessClient(auth, shipment.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        if (shipment.provider !== "delhivery") return error("UNSUPPORTED_PROVIDER_OPERATION", "Provider documents are currently available only for Delhivery", 409, id, headers);
        const url = new URL(request.url);
        const kind = shipmentArtifact[2];
        const operation = kind === "lr-copy" ? "lr_copy" : kind === "document" ? "document" : "labels";
        const requestedSize = url.searchParams.get("size") ?? (kind === "sticker" ? "3x2" : "a4");
        if (operation === "labels" && !["a4", "4x2", "4x2.5", "3x2"].includes(requestedSize)) return error("INVALID_REQUEST", "Delhivery label size must be a4, 4x2, 4x2.5, or 3x2", 400, id, headers);
        if (!shipment.lr_number && !shipment.master_awb && shipment.provider_booking_id) {
          await safeProviderRequest(env, "delhivery", "shipment_status", {
            shipment_id: shipment.id,
            provider_booking_id: shipment.provider_booking_id,
            tracking_number: shipment.tracking_number,
            lr_number: shipment.lr_number,
            provider_reference: shipment.provider_reference,
            provider_account_id: shipment.provider_account_id,
          }, id, shipment.client_id);
          shipment = await env.DB.prepare("SELECT s.id, s.client_id, s.provider, s.pss_reference, s.lr_number, s.master_awb, s.tracking_number, s.provider_reference, s.provider_booking_id, s.provider_account_id, s.pieces, (SELECT pr.provider_reference FROM pickup_requests pr WHERE pr.shipment_id = s.id AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference FROM shipments s WHERE s.id = ? LIMIT 1").bind(shipmentArtifact[1]).first<typeof shipment>();
        }
        if (!shipment) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        // Delhivery's B2B label endpoint validates its path parameter as an
        // active LR number (LRN), not the master AWB. LR copy/document also
        // use the LR number. Keep the PUR and master AWB out of these paths.
         const providerReference = operation === "labels" || operation === "lr_copy" || operation === "document"
           ? shipment.lr_number
           : shipment.lr_number ?? shipment.master_awb;
         if (!providerReference) return error("PROVIDER_REFERENCE_UNAVAILABLE", operation === "lr_copy" || operation === "document" ? "The Delhivery LR/LRN is not available yet" : "The Delhivery LR/AWB is not available yet", 409, id, headers);
        const referenceCandidates = operation === "labels"
          ? [String(shipment.lr_number ?? "").trim()].filter(Boolean)
          : Array.from(new Set([shipment.lr_number, shipment.master_awb, shipment.tracking_number, shipment.provider_reference].map((value) => String(value ?? "").trim()).filter(Boolean)));
        if (operation === "labels") {
          const storedLabelArtifacts = await loadStoredDelhiveryLabels(env, shipment.id, String(providerReference), requestedSize);
          if (storedLabelArtifacts.length) return json({ ok: true, data: { enabled: true, status: "accepted", providerStatus: 200, artifact: { artifacts: storedLabelArtifacts, content_type: "application/pdf", copies: storedLabelArtifacts.length, source: "delhivery_label_callback" } } }, 200, headers);
        }
        let providerResult = await safeProviderRequest(env, "delhivery", operation, { shipment_id: shipment.id, tracking_number: providerReference, provider_reference: providerReference, provider_account_id: shipment.provider_account_id, label_size: requestedSize, boxes: Math.max(1, Number(shipment.pieces ?? 1)), lr_copy_type: url.searchParams.get("lr_copy_type") ?? undefined, doc_type: url.searchParams.get("doc_type") ?? "LM_POD" }, id, shipment.client_id);
        if (operation === "labels" && !isProviderPdfArtifact(providerResult.artifact)) {
          // Delhivery's B2B UI generates a PDF task separately from the
          // label-link endpoint. Try only the documented PDF job contract
          // after the documented label-link request. Do not fan out through
          // browser-only and legacy routes: four size checks multiplied by
          // those fallbacks left the client menu spinning for too long and
          // could create duplicate provider print jobs.
          // Delhivery accounts are split between the documented B2B host and
          // the legacy LTL client host. The native One UI uses the latter for
          // some accounts, so retry the same PDF job contract there as well.
          const labelVariants = ["pdf", "pdf_alt", "legacy_alt"];
          for (const labelApiVariant of labelVariants) {
            for (const candidate of referenceCandidates) {
              if (labelApiVariant === "legacy" && candidate === providerReference) continue;
              const retryResult = await safeProviderRequest(env, "delhivery", operation, { shipment_id: shipment.id, tracking_number: candidate, provider_reference: candidate, provider_account_id: shipment.provider_account_id, label_size: requestedSize, label_api_variant: labelApiVariant, boxes: Math.max(1, Number(shipment.pieces ?? 1)), lr_copy_type: url.searchParams.get("lr_copy_type") ?? undefined, doc_type: url.searchParams.get("doc_type") ?? "LM_POD" }, id, shipment.client_id);
              if (isProviderPdfArtifact(retryResult.artifact)) { providerResult = retryResult; break; }
            }
            if (isProviderPdfArtifact(providerResult.artifact)) break;
          }
        }
        return json({ ok: true, data: providerResult }, 200, headers);
      }

      const shipmentGet = route.match(/^\/shipments\/([^/]+)(?:\/tracking)?$/);
      if (shipmentGet && request.method === "GET") {
        if (!hasScope(auth, route.endsWith("/tracking") ? "tracking.read" : "shipments.read")) return error("FORBIDDEN", "Shipment read scope required", 403, id, headers);
        const internalShipmentView = hasRole(auth, ["employee", "admin", "super_admin"]) || auth.system;
        const sensitiveShipmentView = auth.system || hasScope(auth, "shipments.sensitive.read");
        let shipment = await env.DB.prepare(`SELECT id, pss_reference, client_id, tracking_number, lr_number, master_awb, box_awbs_json, provider_booking_id, provider_pickup_id, provider_sync_status, status, provider, ${sensitiveShipmentView ? "provider_account_id, provider_reference," : "provider_reference,"} (SELECT pr.provider_reference FROM pickup_requests pr WHERE pr.shipment_id = shipments.id AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference, (SELECT pr.status FROM pickup_requests pr WHERE pr.shipment_id = shipments.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_status, (SELECT pr.requested_date FROM pickup_requests pr WHERE pr.shipment_id = shipments.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_scheduled_date, (SELECT pr.requested_time_slot FROM pickup_requests pr WHERE pr.shipment_id = shipments.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_time_slot, (SELECT c.provider_status FROM pricing_provider_costs c WHERE c.shipment_id = shipments.id LIMIT 1) AS provider_confirmation_status, description, origin, destination, ${sensitiveShipmentView ? "origin_address_json, destination_address_json, consignee, declared_value," : "NULL AS origin_address_json, NULL AS destination_address_json, NULL AS consignee, NULL AS declared_value,"} total_weight_kg, pieces, edd, delivered_at, created_at, updated_at FROM shipments WHERE (id = ? OR pss_reference = ?) LIMIT 1`).bind(shipmentGet[1], shipmentGet[1]).first<Record<string, unknown> & { client_id: string; provider: string | null; tracking_number: string | null; provider_reference?: string | null; provider_booking_id?: string | null; provider_account_id?: string | null; lr_number?: string | null; master_awb?: string | null }>();
        if (shipment) {
          const weight = await env.DB.prepare("SELECT weight_override_kg, weight_source, weight_updated_at FROM shipments WHERE id = ? LIMIT 1").bind(String(shipment.id)).first<{ weight_override_kg: number | null; weight_source: string | null; weight_updated_at: string | null }>();
          shipment = { ...shipment, ...weight };
        }
        if (!shipment || !canAccessClient(auth, shipment.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        if (url.searchParams.get("refresh_provider") === "1" && shipment.provider === "delhivery" && !shipment.lr_number && !shipment.master_awb && shipment.provider_booking_id) {
          const refreshProviderAccountId = typeof shipment.provider_account_id === "string"
            ? shipment.provider_account_id
            : (await env.DB.prepare("SELECT provider_account_id FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(String(shipment.id), shipment.client_id).first<{ provider_account_id: string | null }>())?.provider_account_id ?? null;
          await safeProviderRequest(env, "delhivery", "shipment_status", { shipment_id: String(shipment.id), provider_booking_id: shipment.provider_booking_id, tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: refreshProviderAccountId }, id, shipment.client_id);
          shipment = await env.DB.prepare(`SELECT id, pss_reference, client_id, tracking_number, lr_number, master_awb, box_awbs_json, provider_booking_id, provider_pickup_id, provider_sync_status, status, provider, ${sensitiveShipmentView ? "provider_account_id, provider_reference," : "provider_reference,"} (SELECT pr.provider_reference FROM pickup_requests pr WHERE pr.shipment_id = shipments.id AND pr.provider_reference IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS pickup_reference, (SELECT pr.status FROM pickup_requests pr WHERE pr.shipment_id = shipments.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_status, (SELECT pr.requested_date FROM pickup_requests pr WHERE pr.shipment_id = shipments.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_scheduled_date, (SELECT pr.requested_time_slot FROM pickup_requests pr WHERE pr.shipment_id = shipments.id ORDER BY pr.created_at DESC LIMIT 1) AS pickup_time_slot, (SELECT c.provider_status FROM pricing_provider_costs c WHERE c.shipment_id = shipments.id LIMIT 1) AS provider_confirmation_status, description, origin, destination, ${sensitiveShipmentView ? "origin_address_json, destination_address_json, consignee, declared_value," : "NULL AS origin_address_json, NULL AS destination_address_json, NULL AS consignee, NULL AS declared_value,"} total_weight_kg, pieces, edd, delivered_at, created_at, updated_at FROM shipments WHERE id = ? LIMIT 1`).bind(shipment.id).first<typeof shipment>() ?? shipment;
        }
        if (shipment) {
          const weight = await env.DB.prepare("SELECT weight_override_kg, weight_source, weight_updated_at FROM shipments WHERE id = ? LIMIT 1").bind(String(shipment.id)).first<{ weight_override_kg: number | null; weight_source: string | null; weight_updated_at: string | null }>();
          shipment = { ...shipment, ...weight };
        }
        if (route.endsWith("/tracking")) {
          const provider = ["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(String(shipment.provider)) ? shipment.provider as CourierProvider : null;
          // Client-facing shipment reads intentionally omit provider_account_id from
          // the response, but the provider lookup must still use the shipment's
          // assigned Delhivery account. Without this lookup, tracking falls back to
          // DELHIVERY_DEFAULT_ACCOUNT_NAME and can incorrectly report not_configured.
          const providerAccountId = typeof shipment.provider_account_id === "string"
            ? shipment.provider_account_id
            : (await env.DB.prepare("SELECT provider_account_id FROM shipments WHERE id = ? LIMIT 1").bind(String(shipment.id)).first<{ provider_account_id: string | null }>())?.provider_account_id ?? null;
          if (provider === "delhivery" && !shipment.lr_number && !shipment.master_awb && shipment.provider_booking_id) {
            await safeProviderRequest(env, provider, "shipment_status", {
              shipment_id: String(shipment.id),
              provider_booking_id: shipment.provider_booking_id,
              tracking_number: shipment.tracking_number,
              lr_number: shipment.lr_number,
              provider_reference: shipment.provider_reference,
              provider_account_id: providerAccountId,
            }, id, shipment.client_id);
          }
          const providerResult = provider ? await safeProviderRequest(env, provider, "tracking", { shipment_id: String(shipment.id), tracking_number: shipment.tracking_number, lr_number: shipment.lr_number, provider_reference: shipment.provider_reference, provider_account_id: providerAccountId }, id, shipment.client_id) : { enabled: false, status: "not_requested" as const };
          // safeProviderRequest persists a new normalized event before returning.
          // Read the timeline after that provider call so the Client receives the
          // picked-up/in-transit event in the same response.
          const events = await env.DB.prepare("SELECT * FROM tracking_events WHERE shipment_id = ? ORDER BY event_time ASC").bind(String(shipment.id)).all();
          return json({ ok: true, data: events.results, provider_status: providerResult.status }, 200, headers);
        }
        const clientName = auth.accessToken
          ? (await supabaseGet<{ id: string; legal_name: string }>(env, `client_accounts?id=eq.${encodeURIComponent(shipment.client_id)}&select=id,legal_name`, auth.accessToken))[0]?.legal_name
          : undefined;
        return json({ ok: true, data: { ...shipment, client_name: clientName ?? shipment.client_id } }, 200, headers);
      }

      if (route === "/pickup-slots" && request.method === "GET") {
        if (!hasScope(auth, "pickups.read")) return error("FORBIDDEN", "Pickup read scope required", 403, id, headers);
        const query = new URL(request.url).searchParams;
        const requestedProvider = String(query.get("provider") ?? "delhivery").trim().toLowerCase();
        const requestedAccountId = String(query.get("provider_account_id") ?? "").trim();
        const requestedPincode = String(query.get("pincode") ?? "").trim();
        const requestedClient = requireClient(auth, query.get("client_id"));
        if (requestedProvider !== "delhivery") return error("UNSUPPORTED_PROVIDER", "Provider-backed pickup availability is not configured for this courier", 409, id, headers);
        if (!requestedAccountId || !/^\d{6}$/.test(requestedPincode)) return error("VALIDATION_ERROR", "Provider account and a valid pickup PIN code are required", 400, id, headers);
        if (!requestedClient || !canAccessClient(auth, requestedClient)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const account = await env.DB.prepare("SELECT pa.id FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.id = ? AND pa.provider = ? AND pa.status = 'active' AND (pa.client_id = ? OR (p.client_id = ? AND p.enabled = 1)) LIMIT 1").bind(requestedClient, requestedAccountId, requestedProvider, requestedClient, requestedClient).first<{ id: string }>();
        if (!account) return error("PROVIDER_ACCOUNT_UNAVAILABLE", "The selected courier account is not active for this client", 409, id, headers);
        const liveServiceability = await verifyDelhiveryServiceability(env, requestedPincode, requestedPincode, account.id, id, requestedClient);
        if (!liveServiceability.ok) return error("PROVIDER_SERVICEABILITY_FAILED", liveServiceability.reason ?? "Delhivery could not verify this pickup pincode", 409, id, headers, JSON.stringify({ provenance: liveServiceability.provenance, origin: liveServiceability.origin }));
         // Delhivery does not publish a first-mile slot-availability route for
         // B2B. The old implementation called an internal panel endpoint
         // (/web/api/company/configurations/...) which returns 404 in
         // production before a slot request is even attempted. Return valid
         // request windows and let Delhivery accept or reschedule them during
         // the actual booking/pickup request.
         return json({ ok: true, data: delhiveryRequestedPickupSlots() }, 200, headers);
      }

      if (route === "/pickups" && request.method === "GET") {
        if (!hasScope(auth, "pickups.read")) return error("FORBIDDEN", "Pickup read scope required", 403, id, headers);
         const pickupColumns = "id, client_id, shipment_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, contact_email, city, state, pincode, country, pieces, total_weight_kg, status, assigned_to_user_id, notes, provider, provider_account_id, warehouse_id, provider_reference, provider_status, provider_picked_count, provider_expected_count, provider_status_synced_at, provider_status_detail, provider_request_id, provider_slot_id, provider_error_code, idempotency_key, failure_reason, created_at, updated_at, (SELECT COUNT(*) FROM pickup_request_shipments prs WHERE prs.pickup_id = pickup_requests.id) AS shipment_count";
        const rows = auth.system ? await env.DB.prepare(`SELECT ${pickupColumns} FROM pickup_requests ORDER BY created_at DESC, id DESC LIMIT 200`).all() : auth.clientIds.size ? await env.DB.prepare(`SELECT ${pickupColumns} FROM pickup_requests WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY created_at DESC, id DESC LIMIT 200`).bind(...auth.clientIds).all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }

      if (route === "/pickup-candidates" && request.method === "GET") {
        if (!hasScope(auth, "pickups.create")) return error("FORBIDDEN", "Pickup creation scope required", 403, id, headers);
        const clientId = requireClient(auth, url.searchParams.get("client_id"));
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const provider = String(url.searchParams.get("provider") ?? "").trim().toLowerCase();
        const providerAccountId = String(url.searchParams.get("provider_account_id") ?? "").trim();
        const pincode = String(url.searchParams.get("pincode") ?? "").trim();
        if (!provider || !providerAccountId) return error("VALIDATION_ERROR", "Provider and provider account are required", 400, id, headers);
        const conditions = ["s.client_id = ?", "s.status = 'booked'", "s.provider = ?", "s.provider_account_id = ?", "NOT EXISTS (SELECT 1 FROM pickup_request_shipments prs JOIN pickup_requests pr ON pr.id = prs.pickup_id WHERE prs.shipment_id = s.id AND pr.status NOT IN ('cancelled', 'completed', 'failed'))"];
        const binds: unknown[] = [clientId, provider, providerAccountId];
        if (pincode) { conditions.push("json_extract(s.origin_address_json, '$.pincode') = ?"); binds.push(pincode); }
        const rows = await env.DB.prepare(`SELECT s.id, s.pss_reference, s.order_id, s.tracking_number, s.lr_number, s.master_awb, s.provider_reference, s.origin_address_json, s.origin, s.total_weight_kg, s.pieces, s.created_at FROM shipments s WHERE ${conditions.join(" AND ")} ORDER BY s.created_at ASC LIMIT 200`).bind(...binds).all<Record<string, unknown>>();
        return json({ ok: true, data: rows.results.map((row) => { let origin: Record<string, unknown> = {}; try { origin = JSON.parse(String(row.origin_address_json ?? "{}")) as Record<string, unknown>; } catch { origin = {}; } return { ...row, origin_address: origin, awb: row.master_awb ?? row.tracking_number ?? row.provider_reference ?? row.lr_number ?? null }; }) }, 200, headers);
      }

      if (route === "/pickups" && request.method === "POST") {
        if (!hasScope(auth, "pickups.create")) return error("FORBIDDEN", "Pickup creation scope required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const provider = ["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(String(payload.provider)) ? payload.provider as CourierProvider : null;
        if (!provider) return error("VALIDATION_ERROR", "Select a courier before scheduling the pickup", 400, id, headers);
         const requestedDateInput = payload.requested_date ?? payload.scheduled_date;
         const requestedWindowInput = payload.requested_time_slot ?? payload.window;
         const pickupAddressInput = payload.pickup_address ?? payload.location;
         if (typeof requestedDateInput !== "string" || !requestedDateInput.trim()) return error("VALIDATION_ERROR", "Pickup date is required", 400, id, headers);
         if (!validPickupDate(requestedDateInput.trim())) return error("VALIDATION_ERROR", "Pickup date must use a valid YYYY-MM-DD date", 400, id, headers);
         if (typeof pickupAddressInput !== "string" || !pickupAddressInput.trim()) return error("VALIDATION_ERROR", "Pickup address is required", 400, id, headers);
        if (typeof payload.contact_name !== "string" || !payload.contact_name.trim()) return error("VALIDATION_ERROR", "Pickup contact name is required", 400, id, headers);
        const normalizedContactPhone = normalizePickupPhone(payload.contact_phone);
        if (!normalizedContactPhone) return error("VALIDATION_ERROR", "Pickup contact phone must contain a valid ten-digit number", 400, id, headers);
        if (payload.contact_email !== undefined && payload.contact_email !== null && (typeof payload.contact_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact_email.trim()))) return error("VALIDATION_ERROR", "Pickup contact email is invalid", 400, id, headers);
        if (typeof payload.city !== "string" || !payload.city.trim()) return error("VALIDATION_ERROR", "Pickup city is required", 400, id, headers);
        if (typeof payload.state !== "string" || !payload.state.trim()) return error("VALIDATION_ERROR", "Pickup state is required", 400, id, headers);
        if (typeof payload.country !== "string" || !payload.country.trim()) return error("VALIDATION_ERROR", "Pickup country is required", 400, id, headers);
        if (typeof payload.pincode !== "string" || !/^\d{6}$/.test(payload.pincode.trim())) return error("VALIDATION_ERROR", "A valid six-digit pickup PIN code is required", 400, id, headers);
         if (typeof requestedWindowInput !== "string" || !requestedWindowInput.trim()) return error("VALIDATION_ERROR", "Pickup time window is required", 400, id, headers);
         const normalizedScheduledDate = providerSafePickupDate(requestedDateInput);
        const shipment = typeof payload.shipment_id === "string" ? await env.DB.prepare("SELECT provider, provider_account_id, tracking_number, provider_reference FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(payload.shipment_id, clientId).first<{ provider: string | null; provider_account_id: string | null; tracking_number: string | null; provider_reference: string | null }>() : null;
        if (payload.shipment_id !== undefined && !shipment) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        if (shipment?.provider && shipment.provider !== provider) return error("VALIDATION_ERROR", "The pickup courier must match the shipment courier", 409, id, headers);
        const pickupAwbNumbers = normalizePickupAwbNumbers(payload.awb_number ?? payload.master_awb);
        const isManifestSelection = payload.selection_mode === "manifested" || Array.isArray(payload.shipment_ids) === true;
        // Standalone pickups may be location-only. Delhivery can accept the
        // pickup location and package count without pre-booked shipments or
        // AWBs; AWBs remain optional when the client has them available.
        const providerAccountId = typeof payload.provider_account_id === "string" && payload.provider_account_id.trim() ? payload.provider_account_id.trim() : shipment?.provider_account_id ?? null;
        if (!providerAccountId) return error("VALIDATION_ERROR", "Select an active courier account before scheduling the pickup", 400, id, headers);
        const providerAccount = await env.DB.prepare(`SELECT pa.id FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.id = ? AND pa.provider = ? AND pa.status = 'active' AND (pa.client_id = ? OR (p.client_id = ? AND p.enabled = 1)) LIMIT 1`).bind(clientId, providerAccountId, provider, clientId, clientId).first<{ id: string }>();
        if (!providerAccount) return error("PROVIDER_ACCOUNT_UNAVAILABLE", "The selected courier account is not active for this client", 409, id, headers);
        if (provider === "delhivery") {
          const liveServiceability = await verifyDelhiveryServiceability(env, payload.pincode.trim(), payload.pincode.trim(), providerAccountId, id, clientId);
          if (!liveServiceability.ok) return error("PROVIDER_SERVICEABILITY_FAILED", liveServiceability.reason ?? "Delhivery could not verify this pickup pincode", 409, id, headers, JSON.stringify({ provenance: liveServiceability.provenance, origin: liveServiceability.origin }));
        }
        const piecesValue = Number(payload.pieces);
        if (!isManifestSelection && (!Number.isInteger(piecesValue) || piecesValue < 1)) return error("VALIDATION_ERROR", "Pickup pieces must be a positive whole number", 400, id, headers);
        const pieces = piecesValue;
        const totalWeight = Number(payload.weight ?? payload.total_weight_kg);
        if (!isManifestSelection && (!Number.isFinite(totalWeight) || totalWeight <= 0)) return error("VALIDATION_ERROR", "Total pickup weight must be greater than zero", 400, id, headers);
        const warehouseId = typeof payload.warehouse_id === "string" && payload.warehouse_id.trim() ? payload.warehouse_id.trim() : null;
        if (warehouseId) {
          const savedWarehouse = await env.DB.prepare("SELECT id FROM warehouses WHERE id = ? AND client_id = ? LIMIT 1").bind(warehouseId, clientId).first<{ id: string }>();
          if (!savedWarehouse) return error("WAREHOUSE_NOT_FOUND", "The selected pickup warehouse is not saved for this client", 404, id, headers);
        }
         const providerPayload: Record<string, unknown> = { ...payload, provider, provider_account_id: providerAccountId, awb_number: pickupAwbNumbers, scheduled_date: normalizedScheduledDate, requested_date: normalizedScheduledDate, window: String(requestedWindowInput), requested_time_slot: String(requestedWindowInput), location: String(pickupAddressInput).trim(), pickup_address: String(pickupAddressInput).trim(), contact_phone: normalizedContactPhone, pieces, weight: totalWeight };
        if (payload.shipment_id !== undefined && !(await shipmentBelongsToClient(env, payload.shipment_id, clientId))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
         if (payload.provider_managed === true && !shipment) return error("VALIDATION_ERROR", "Provider-managed pickup requests must be linked to a shipment", 400, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/pickups", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const manifestShipmentIds = payload.selection_mode === "manifested" || Array.isArray(payload.shipment_ids)
          ? Array.from(new Set((Array.isArray(payload.shipment_ids) ? payload.shipment_ids : []).filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())))
          : [];
        if (payload.selection_mode === "manifested" && !manifestShipmentIds.length) return error("VALIDATION_ERROR", "Select at least one manifested shipment for this pickup", 400, id, headers);
        if (manifestShipmentIds.length > 100) return error("VALIDATION_ERROR", "A pickup request can include at most 100 shipments", 400, id, headers);
        if (manifestShipmentIds.length) {
          const placeholders = manifestShipmentIds.map(() => "?").join(",");
          const selectedRows = await env.DB.prepare(`SELECT id, provider, provider_account_id, status, tracking_number, lr_number, master_awb, provider_reference, origin_address_json, total_weight_kg, pieces FROM shipments WHERE client_id = ? AND id IN (${placeholders})`).bind(clientId, ...manifestShipmentIds).all<Record<string, unknown>>();
          if (selectedRows.results.length !== manifestShipmentIds.length) return error("NOT_FOUND", "One or more selected shipments do not belong to this client", 404, id, headers);
          if (selectedRows.results.some((row) => row.status !== "booked")) return error("SHIPMENT_NOT_READY", "Only booked shipments that are not already on an active pickup can be selected", 409, id, headers);
          if (selectedRows.results.some((row) => String(row.provider ?? "") !== provider || String(row.provider_account_id ?? "") !== providerAccountId)) return error("VALIDATION_ERROR", "All selected shipments must use the selected courier account", 409, id, headers);
          const normalizedPickupAddress = String(pickupAddressInput).toLowerCase().replace(/[^a-z0-9]/g, "");
          const mismatchedLocation = selectedRows.results.some((row) => { try { const origin = JSON.parse(String(row.origin_address_json ?? "{}")) as Record<string, unknown>; const originLine = String(origin.line ?? origin.address_line1 ?? origin.address ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""); return !originLine || !normalizedPickupAddress.includes(originLine) || String(origin.pincode ?? "").trim() !== String(payload.pincode).trim() || String(origin.city ?? "").trim().toLowerCase() !== String(payload.city).trim().toLowerCase() || String(origin.state ?? "").trim().toLowerCase() !== String(payload.state).trim().toLowerCase(); } catch { return true; } });
          if (mismatchedLocation) return error("PICKUP_LOCATION_MISMATCH", "Selected shipments must come from the pickup location and PIN code shown in this request", 409, id, headers);
          const active = await env.DB.prepare(`SELECT prs.shipment_id FROM pickup_request_shipments prs JOIN pickup_requests pr ON pr.id = prs.pickup_id WHERE prs.client_id = ? AND prs.shipment_id IN (${placeholders}) AND pr.status NOT IN ('cancelled', 'completed', 'failed') LIMIT 1`).bind(clientId, ...manifestShipmentIds).first<{ shipment_id: string }>();
          if (active) return error("SHIPMENT_ALREADY_ASSIGNED", "One or more selected shipments already belong to an active pickup request", 409, id, headers);
          const awbs = Array.from(new Set(selectedRows.results.flatMap((row) => normalizePickupAwbNumbers(row.master_awb ?? row.tracking_number ?? row.provider_reference ?? row.lr_number))));
          if (provider === "delhivery" && !awbs.length) return error("PROVIDER_REFERENCE_UNAVAILABLE", "Selected shipments do not have a Delhivery AWB yet", 409, id, headers);
          const selectedPieces = selectedRows.results.reduce((sum, row) => sum + Math.max(1, Number(row.pieces ?? 1)), 0);
          const selectedWeight = selectedRows.results.reduce((sum, row) => sum + Math.max(0, Number(row.total_weight_kg ?? 0)), 0);
          const pickupId = crypto.randomUUID();
          await env.DB.prepare("INSERT INTO pickup_requests (id, shipment_id, client_id, created_by_user_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, contact_email, city, state, pincode, country, pieces, total_weight_kg, status, provider, provider_account_id, warehouse_id, provider_status, provider_slot_id, provider_awb_numbers_json, idempotency_key, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, 'pending', ?, ?, ?, ?)").bind(pickupId, manifestShipmentIds[0], clientId, auth.userId ?? `api:${clientId}`, normalizedScheduledDate, String(requestedWindowInput), String(pickupAddressInput).trim(), String(payload.contact_name).trim(), normalizedContactPhone, typeof payload.contact_email === "string" ? payload.contact_email.trim() : null, String(payload.city).trim(), String(payload.state).trim(), payload.pincode.trim(), String(payload.country).trim(), selectedPieces, selectedWeight, provider, providerAccountId, warehouseId, typeof payload.provider_slot_id === "string" ? payload.provider_slot_id.trim() : null, JSON.stringify(awbs), key, typeof payload.notes === "string" ? payload.notes.trim().slice(0, 2000) : "Manifested shipments pickup").run();
          for (const shipmentId of manifestShipmentIds) await env.DB.prepare("INSERT INTO pickup_request_shipments (pickup_id, shipment_id, client_id) VALUES (?, ?, ?)").bind(pickupId, shipmentId, clientId).run();
          const providerResult = await safeProviderRequest(env, provider, "pickups", { ...providerPayload, pickup_id: pickupId, shipment_ids: manifestShipmentIds, awb_number: awbs, pieces: selectedPieces, weight: selectedWeight, provider_managed: true }, id, clientId, key);
          const providerReference = (providerResult as { providerReference?: string | null }).providerReference ?? null;
          const providerStatus = (providerResult as { providerStatus?: string | number | null }).providerStatus ?? providerResult.status;
          const providerErrorMessage = (providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? null;
          await recordPickupAttempt(env, { pickupId, clientId, provider, providerAccountId, requestId: id, idempotencyKey: key, requestedDate: normalizedScheduledDate, requestedWindow: String(requestedWindowInput), status: providerResult.status, providerStatus, providerReference, providerErrorCode: providerResult.status === "accepted" ? null : providerResult.status, errorMessage: providerErrorMessage }).catch(() => undefined);
          if (providerResult.status !== "accepted") {
            const failureReason = String(providerErrorMessage ?? `The ${provider} pickup was not accepted`).slice(0, 500);
            await env.DB.prepare("UPDATE pickup_requests SET status = 'failed', provider_status = ?, provider_request_id = ?, provider_error_code = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(String(providerStatus), id, String(providerResult.status), failureReason, pickupId, clientId).run();
            const failedResponse = JSON.stringify({ ok: false, error: { code: "PROVIDER_REQUEST_FAILED", category: "provider", message: failureReason, user_safe_message: `The ${provider} pickup was not accepted.`, technical_message: failureReason, request_id: id, retryable: true }, data: { id: pickupId, status: "failed" }, request_id: id });
            await saveIdempotent(env, key, clientId, "POST /v1/pickups", 502, failedResponse, requestHash);
            return new Response(failedResponse, { status: 502, headers: { ...headers, "content-type": "application/json" } });
          }
          const pickupStatus = (providerResult as { providerPending?: boolean }).providerPending ? "provider_pending" : "scheduled";
          const acceptedDate = (providerResult as { acceptedDate?: string | null }).acceptedDate ?? normalizedScheduledDate;
          const acceptedWindow = (providerResult as { acceptedWindow?: string | null }).acceptedWindow ?? String(requestedWindowInput);
          await env.DB.prepare("UPDATE pickup_requests SET status = ?, provider_status = ?, provider_request_id = ?, provider_reference = COALESCE(?, provider_reference), requested_date = ?, requested_time_slot = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(pickupStatus, String(providerStatus), id, providerReference, acceptedDate, acceptedWindow, pickupId, clientId).run();
          if (providerReference) await env.DB.prepare(`UPDATE shipments SET provider_pickup_id = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND id IN (${placeholders})`).bind(providerReference, clientId, ...manifestShipmentIds).run();
          const serialized = JSON.stringify({ ok: true, data: { id: pickupId, client_id: clientId, status: pickupStatus, provider, provider_account_id: providerAccountId, provider_reference: providerReference, shipment_ids: manifestShipmentIds, shipment_count: manifestShipmentIds.length, requested_date: acceptedDate, requested_time_slot: acceptedWindow }, request_id: id });
          await saveIdempotent(env, key, clientId, "POST /v1/pickups", 201, serialized, requestHash); await audit(env, ctx, auth, id, "pickup.created", "pickup", pickupId, { client_id: clientId, provider, shipment_count: manifestShipmentIds.length });
          return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
        }
        if (payload.provider_managed === true && typeof payload.shipment_id === "string" && shipment) {
          const grouped = await ensureManifestPickupGroup(env, { shipmentId: payload.shipment_id, clientId, provider, providerAccountId, warehouseId, payload: providerPayload, requestId: id, idempotencyKey: key });
          const groupedResponse = JSON.stringify({ ok: grouped.ok, data: { id: grouped.id, client_id: clientId, status: grouped.status, provider, provider_account_id: providerAccountId, provider_reference: grouped.providerReference ?? null, grouped: grouped.grouped ?? false }, ...(grouped.ok ? {} : { error: { code: "PROVIDER_REQUEST_FAILED", category: "provider", message: grouped.error, user_safe_message: `The ${provider} pickup was not accepted. Retry it after correcting the provider issue.`, technical_message: grouped.error, provider_code: "PROVIDER_REQUEST_FAILED", request_id: id, retryable: true, stale_data: false } }), request_id: id });
          await saveIdempotent(env, key, clientId, "POST /v1/pickups", grouped.ok ? 201 : 502, groupedResponse, requestHash);
          return new Response(groupedResponse, { status: grouped.ok ? 201 : 502, headers: { ...headers, "content-type": "application/json" } });
        }
        const pickupId = crypto.randomUUID();
         await env.DB.prepare("INSERT INTO pickup_requests (id, shipment_id, client_id, created_by_user_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, contact_email, city, state, pincode, country, pieces, total_weight_kg, status, provider, provider_account_id, warehouse_id, provider_status, provider_slot_id, provider_awb_numbers_json, idempotency_key, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, 'pending', ?, ?, ?, ?)").bind(pickupId, typeof payload.shipment_id === "string" ? payload.shipment_id : null, clientId, auth.userId ?? `api:${clientId}`, normalizedScheduledDate, String(requestedWindowInput), String(pickupAddressInput).trim(), String(payload.contact_name).trim(), normalizedContactPhone, typeof payload.contact_email === "string" ? payload.contact_email.trim() : null, typeof payload.city === "string" ? payload.city.trim() : null, typeof payload.state === "string" ? payload.state.trim() : null, payload.pincode.trim(), typeof payload.country === "string" && payload.country.trim() ? payload.country.trim() : "India", pieces, totalWeight, provider, providerAccountId, warehouseId, typeof payload.provider_slot_id === "string" ? payload.provider_slot_id.trim() : null, JSON.stringify(pickupAwbNumbers), key, typeof payload.notes === "string" ? payload.notes.trim().slice(0, 2000) : null).run();
          const providerResult = provider ? await safeProviderRequest(env, provider, "pickups", { pickup_id: pickupId, shipment_id: providerPayload.shipment_id, tracking_number: shipment?.tracking_number, provider_reference: shipment?.provider_reference, provider_account_id: providerPayload.provider_account_id ?? shipment?.provider_account_id, ...providerPayload }, id, clientId, key) : { enabled: false, status: "not_requested" as const };
         const providerReference = (providerResult as { providerReference?: string | null }).providerReference ?? null;
         const providerSlotId = (providerResult as { providerSlotId?: string | null }).providerSlotId ?? (typeof payload.provider_slot_id === "string" ? payload.provider_slot_id.trim() : null);
         const acceptedDate = (providerResult as { acceptedDate?: string | null }).acceptedDate ?? normalizedScheduledDate;
         const acceptedWindow = (providerResult as { acceptedWindow?: string | null }).acceptedWindow ?? String(requestedWindowInput);
        const providerStatus = (providerResult as { providerStatus?: string | number | null }).providerStatus ?? providerResult.status;
        const providerErrorCode = (providerResult as { error_code?: string | null }).error_code ?? (providerResult.status === "accepted" ? null : providerResult.status);
        const providerErrorMessage = (providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? null;
         await recordPickupAttempt(env, { pickupId, clientId, provider, providerAccountId, requestId: id, idempotencyKey: key, requestedDate: normalizedScheduledDate, requestedWindow: String(requestedWindowInput), status: providerResult.status, providerStatus, providerReference, providerErrorCode, errorMessage: providerErrorMessage }).catch(() => undefined);
        if (provider && providerResult.status !== "accepted") {
          const failureReason = String((providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? `The ${provider} pickup request was not accepted`).slice(0, 500);
          await env.DB.prepare("UPDATE pickup_requests SET status = 'failed', provider_status = ?, provider_request_id = ?, provider_error_code = ?, failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(String(providerStatus), id, String(providerErrorCode ?? "provider_request_failed"), failureReason, pickupId, clientId).run();
          const failedResponse = JSON.stringify({ ok: false, error: { code: "PROVIDER_REQUEST_FAILED", category: "provider", message: failureReason, user_safe_message: `The ${provider} pickup was not accepted. The request is marked failed and can be retried after correcting the provider issue.`, technical_message: failureReason, provider_code: String(providerErrorCode ?? "provider_request_failed"), request_id: id, retryable: true, stale_data: false }, data: { id: pickupId, client_id: clientId, status: "failed", provider, provider_status: providerResult.status, provider_reference: providerReference }, request_id: id });
          await saveIdempotent(env, key, clientId, "POST /v1/pickups", 502, failedResponse, requestHash);
          await audit(env, ctx, auth, id, "pickup.provider_failed", "pickup", pickupId, { client_id: clientId, provider, reason: failureReason });
          return new Response(failedResponse, { status: 502, headers: { ...headers, "content-type": "application/json" } });
        }
         const pickupStatus = (providerResult as { providerPending?: boolean }).providerPending ? "provider_pending" : "scheduled";
         await env.DB.prepare("UPDATE pickup_requests SET status = ?, provider_status = ?, provider_request_id = ?, provider_error_code = ?, provider_reference = COALESCE(?, provider_reference), provider_slot_id = COALESCE(?, provider_slot_id), requested_date = ?, requested_time_slot = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(pickupStatus, String(providerStatus), id, null, providerReference, providerSlotId, acceptedDate, acceptedWindow, pickupId, clientId).run();
          if (typeof payload.shipment_id === "string" && providerReference) await env.DB.prepare("UPDATE shipments SET provider_pickup_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(providerReference, payload.shipment_id, clientId).run();
          const serialized = JSON.stringify({ ok: true, data: { id: pickupId, client_id: clientId, status: pickupStatus, provider, provider_account_id: providerAccountId, provider_status: providerStatus, provider_reference: providerReference, requested_date: acceptedDate, requested_time_slot: acceptedWindow, scheduled_date: acceptedDate, window: acceptedWindow, rescheduled: acceptedDate !== requestedDateInput }, request_id: id });
        await saveIdempotent(env, key, clientId, "POST /v1/pickups", 201, serialized, requestHash); await audit(env, ctx, auth, id, "pickup.created", "pickup", pickupId, { client_id: clientId });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const pickupMatch = route.match(/^\/pickups\/([^/]+)$/);
      if (pickupMatch && request.method === "GET") {
        if (!hasScope(auth, "pickups.read")) return error("FORBIDDEN", "Pickup read scope required", 403, id, headers);
        const internalPickupView = hasRole(auth, ["employee", "admin", "super_admin"]) || auth.system;
         const pickup = await env.DB.prepare(`SELECT id, client_id, shipment_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, contact_email, city, state, pincode, country, pieces, total_weight_kg, status, assigned_to_user_id, notes, provider, provider_account_id, warehouse_id, provider_reference, provider_status, provider_error_code, provider_slot_id, idempotency_key, failure_reason, ${internalPickupView ? "provider_request_id," : ""} created_at, updated_at FROM pickup_requests WHERE id = ? LIMIT 1`).bind(pickupMatch[1]).first<{ client_id: string }>();
        if (!pickup || !canAccessClient(auth, pickup.client_id)) return error("NOT_FOUND", "Pickup not found", 404, id, headers);
         const attempts = await env.DB.prepare("SELECT id, requested_date, requested_time_slot, status, provider_status, provider_reference, provider_error_code, error_message, created_at FROM pickup_request_attempts WHERE pickup_id = ? ORDER BY created_at DESC LIMIT 25").bind(pickupMatch[1]).all();
         return json({ ok: true, data: { ...pickup, attempts: attempts.results } }, 200, headers);
      }
      if (pickupMatch && request.method === "PATCH") {
        const pickup = await env.DB.prepare("SELECT client_id, shipment_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, contact_email, city, state, pincode, country, pieces, total_weight_kg, warehouse_id, provider_awb_numbers_json, assigned_to_user_id, failure_reason, provider, provider_account_id, provider_reference FROM pickup_requests WHERE id = ? LIMIT 1").bind(pickupMatch[1]).first<{ client_id: string; shipment_id?: string | null; requested_date: string; requested_time_slot?: string | null; pickup_address: string; contact_name: string; contact_phone: string; contact_email?: string | null; city?: string | null; state?: string | null; pincode?: string | null; country?: string | null; pieces?: number | null; total_weight_kg?: number | null; warehouse_id?: string | null; provider_awb_numbers_json?: string | null; assigned_to_user_id?: string | null; failure_reason?: string | null; provider?: string | null; provider_account_id?: string | null; provider_reference?: string | null }>();
        if (!pickup || !canAccessClient(auth, pickup.client_id)) return error("NOT_FOUND", "Pickup not found", 404, id, headers);
        const staffUpdate = hasRole(auth, ["employee", "admin", "super_admin"]);
        const payload = await bodyJson(request);
        const requestHash = await payloadFingerprint(payload);
        // Accept the canonical pickup lifecycle names while retaining the
        // legacy aliases used by older internal callers.
        const allowedStatuses = new Set(["draft", "requested", "provider_pending", "scheduled", "rescheduled", "not_picked", "driver_assigned", "en_route", "picked_up", "completed", "cancelled", "failed", "assigned", "in_transit"]);
        if (payload.status !== undefined && (typeof payload.status !== "string" || !allowedStatuses.has(payload.status))) return error("VALIDATION_ERROR", "Unsupported pickup status", 400, id, headers);
        const clientCancel = !staffUpdate && payload.status === "cancelled" && Object.keys(payload).every((key) => key === "status") && hasScope(auth, "pickups.read");
        const clientReschedule = !staffUpdate && (payload.retry === true || payload.requested_date !== undefined || payload.requested_time_slot !== undefined) && hasScope(auth, "pickups.manage");
        if (!staffUpdate && !hasScope(auth, "pickups.manage") && !clientCancel) return error("FORBIDDEN", "Pickup update permission required", 403, id, headers);
        if (!staffUpdate && !clientCancel && !clientReschedule) return error("FORBIDDEN", "Client users may only cancel or reschedule their own pickup", 403, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `PATCH /v1/pickups/${pickupMatch[1]}`; const existing = await idempotentResponse(env, idempotencyKey, pickup.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const updates: string[] = []; const values: unknown[] = [];
        if (typeof payload.status === "string") {
          const normalizedStatus = payload.status === "assigned" ? "driver_assigned" : payload.status === "in_transit" ? "en_route" : payload.status;
          updates.push("status = ?"); values.push(normalizedStatus);
        }
        const wantsProviderRetry = payload.retry === true || payload.requested_date !== undefined || payload.requested_time_slot !== undefined;
        if (wantsProviderRetry) {
          if (!pickup.provider || !pickup.provider_account_id) return error("PROVIDER_ACCOUNT_UNAVAILABLE", "This pickup has no active provider account and cannot be retried", 409, id, headers);
          const retryAccount = await env.DB.prepare("SELECT pa.id FROM provider_accounts pa LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? WHERE pa.id = ? AND pa.provider = ? AND pa.status = 'active' AND (pa.client_id = ? OR (p.client_id = ? AND p.enabled = 1)) LIMIT 1").bind(pickup.client_id, pickup.provider_account_id, pickup.provider, pickup.client_id, pickup.client_id).first<{ id: string }>();
          if (!retryAccount) return error("PROVIDER_ACCOUNT_UNAVAILABLE", "The pickup courier account is no longer active for this client", 409, id, headers);
          if (pickup.provider === "delhivery") {
            if (!pickup.pincode || !/^\d{6}$/.test(String(pickup.pincode).trim())) return error("VALIDATION_ERROR", "This pickup does not have a valid six-digit pickup PIN code", 409, id, headers);
            const liveServiceability = await verifyDelhiveryServiceability(env, String(pickup.pincode).trim(), String(pickup.pincode).trim(), pickup.provider_account_id, id, pickup.client_id);
            if (!liveServiceability.ok) return error("PROVIDER_SERVICEABILITY_FAILED", liveServiceability.reason ?? "Delhivery could not verify this pickup pincode", 409, id, headers, JSON.stringify({ provenance: liveServiceability.provenance, origin: liveServiceability.origin }));
          }
          if (payload.requested_date !== undefined && (typeof payload.requested_date !== "string" || !validPickupDate(payload.requested_date.trim()))) return error("VALIDATION_ERROR", "Pickup date must use a valid YYYY-MM-DD date", 400, id, headers);
          const requestedDate = typeof payload.requested_date === "string" && payload.requested_date.trim() ? providerSafePickupDate(payload.requested_date.trim()) : pickup.requested_date;
          const requestedWindow = typeof payload.requested_time_slot === "string" && payload.requested_time_slot.trim() ? payload.requested_time_slot.trim() : pickup.requested_time_slot ?? "";
           const manifestManaged = Boolean(pickup.shipment_id && pickup.provider === "delhivery");
           const providerResult = manifestManaged
             ? { enabled: true, status: "accepted" as const, providerStatus: "manifest_managed", providerPending: true, providerReference: pickup.provider_reference ?? null }
           : await safeProviderRequest(env, pickup.provider as CourierProvider, "pickups", { pickup_id: pickupMatch[1], shipment_id: pickup.shipment_id, provider_account_id: pickup.provider_account_id, provider_reference: pickup.provider_reference, awb_number: (() => { try { return JSON.parse(pickup.provider_awb_numbers_json ?? "[]"); } catch { return []; } })(), scheduled_date: requestedDate, window: requestedWindow, location: pickup.pickup_address, contact_name: pickup.contact_name, contact_phone: pickup.contact_phone, contact_email: pickup.contact_email, city: pickup.city, state: pickup.state, pincode: pickup.pincode, country: pickup.country, pieces: pickup.pieces, weight: pickup.total_weight_kg }, id, pickup.client_id, request.headers.get("Idempotency-Key") ?? undefined);
          const retryProviderReference = (providerResult as { providerReference?: string | null }).providerReference ?? null;
          const retryProviderSlotId = (providerResult as { providerSlotId?: string | null }).providerSlotId ?? null;
          const retryProviderStatus = (providerResult as { providerStatus?: string | number | null }).providerStatus ?? providerResult.status;
          const retryErrorCode = (providerResult as { error_code?: string | null }).error_code ?? (providerResult.status === "accepted" ? null : providerResult.status);
          const retryErrorMessage = (providerResult as { error?: string; reason?: string }).error ?? (providerResult as { reason?: string }).reason ?? null;
          await recordPickupAttempt(env, { pickupId: pickupMatch[1], clientId: pickup.client_id, provider: pickup.provider, providerAccountId: pickup.provider_account_id, requestId: id, idempotencyKey: idempotencyKey, requestedDate, requestedWindow, status: providerResult.status, providerStatus: retryProviderStatus, providerReference: retryProviderReference, providerErrorCode: retryErrorCode, errorMessage: retryErrorMessage }).catch(() => undefined);
          if (providerResult.status !== "accepted") {
            const retryFailure = String(retryErrorMessage ?? "The provider did not accept the pickup retry").slice(0, 500);
            await env.DB.prepare("UPDATE pickup_requests SET status = 'failed', provider_status = ?, provider_error_code = ?, failure_reason = ?, provider_request_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(String(retryProviderStatus), String(retryErrorCode ?? "provider_request_failed"), retryFailure, id, pickupMatch[1], pickup.client_id).run();
            return error("PROVIDER_REQUEST_FAILED", retryFailure, 502, id, headers);
          }
           const retryStatus = (providerResult as { providerPending?: boolean }).providerPending ? "provider_pending" : "scheduled";
          updates.push("requested_date = ?", "requested_time_slot = ?", "status = ?", "provider_status = ?", "provider_error_code = ?", "provider_reference = COALESCE(provider_reference, ?)", "provider_slot_id = COALESCE(?, provider_slot_id)", "failure_reason = ?"); values.push(requestedDate, requestedWindow, retryStatus, String(retryProviderStatus), null, retryProviderReference, retryProviderSlotId, null);
        }
        if (staffUpdate && payload.assigned_to_user_id !== undefined) { if (payload.assigned_to_user_id !== null && typeof payload.assigned_to_user_id !== "string") return error("VALIDATION_ERROR", "Assigned employee must be a user ID", 400, id, headers); if (!(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, pickup.client_id))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers); updates.push("assigned_to_user_id = ?"); values.push(payload.assigned_to_user_id || null); }
        if (staffUpdate && payload.failure_reason !== undefined) { if (payload.failure_reason !== null && typeof payload.failure_reason !== "string") return error("VALIDATION_ERROR", "Failure reason must be text", 400, id, headers); updates.push("failure_reason = ?"); values.push(typeof payload.failure_reason === "string" ? payload.failure_reason.trim() || null : null); }
        if (staffUpdate && payload.provider_reference !== undefined) { if (payload.provider_reference !== null && typeof payload.provider_reference !== "string") return error("VALIDATION_ERROR", "Provider reference must be text", 400, id, headers); updates.push("provider_reference = ?"); values.push(payload.provider_reference || null); }
        if (!updates.length) return error("VALIDATION_ERROR", "A pickup status, retry/reschedule, assignment, failure reason, or provider reference is required", 400, id, headers);
        await env.DB.prepare(`UPDATE pickup_requests SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...values, pickupMatch[1]).run(); const changed = Object.fromEntries(updates.map((field, index) => [field.split(" = ")[0], values[index]])); await audit(env, ctx, auth, id, "pickup.updated", "pickup", pickupMatch[1], { ...changed, client_id: pickup.client_id });
        const serialized = JSON.stringify({ ok: true, data: { id: pickupMatch[1], ...changed }, request_id: id }); await saveIdempotent(env, idempotencyKey, pickup.client_id, endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      if (route === "/documents" && request.method === "POST") {
        if (!hasScope(auth, "documents.manage")) return error("FORBIDDEN", "Document upload scope required", 403, id, headers);
        const payload = await bodyJson(request, 12 * 1024 * 1024); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        const shipmentId = typeof payload.shipment_id === "string" ? payload.shipment_id.trim() : null; const name = String(payload.name ?? "").trim(); const contentType = String(payload.content_type ?? "application/octet-stream").split(";", 1)[0].trim().toLowerCase(); const encoded = typeof payload.body_base64 === "string" ? payload.body_base64 : "";
        const allowedContentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv", "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
        if (!clientId || !canAccessClient(auth, clientId) || !shipmentId || !name || !encoded) return error("VALIDATION_ERROR", "Client, shipment, name, and file content are required", 400, id, headers);
        if (name.length > 200 || name.includes("\0")) return error("VALIDATION_ERROR", "Filename is invalid or too long", 400, id, headers);
        if (!allowedContentTypes.has(contentType)) return error("UNSUPPORTED_MEDIA_TYPE", "This document type is not supported", 415, id, headers);
        const shipmentOwner = await env.DB.prepare("SELECT client_id FROM shipments WHERE id = ? LIMIT 1").bind(shipmentId).first<{ client_id: string }>();
        if (!shipmentOwner || shipmentOwner.client_id !== clientId) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = "POST /v1/documents"; const existing = await idempotentResponse(env, idempotencyKey, clientId, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        if (encoded.length > 14 * 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "Document is too large", 413, id, headers);
        const base64 = encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) return error("VALIDATION_ERROR", "File content is not valid base64", 400, id, headers);
        let binary: string;
        try { binary = atob(base64); } catch { return error("VALIDATION_ERROR", "File content is not valid base64", 400, id, headers); }
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)); if (bytes.byteLength > 10 * 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "Document is larger than 10 MB", 413, id, headers);
        if (!documentSignatureMatches(contentType, bytes)) return error("VALIDATION_ERROR", "File content does not match the declared document type", 400, id, headers);
        const documentId = crypto.randomUUID(); const objectKey = `clients/${clientId}/shipments/${shipmentId}/${documentId}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType } });
        try {
          await env.DB.prepare("INSERT INTO shipment_documents (id, shipment_id, client_id, object_key, original_filename, content_type, file_size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(documentId, shipmentId, clientId, objectKey, name, contentType, bytes.byteLength, auth.userId ?? `api:${clientId}`).run();
        } catch (caught) {
          await env.FILES.delete(objectKey).catch(() => undefined);
          throw caught;
        }
        await audit(env, ctx, auth, id, "document.created", "document", documentId, { client_id: clientId, shipment_id: shipmentId });
        const serialized = JSON.stringify({ ok: true, data: { id: documentId, shipment_id: shipmentId, name, size: bytes.byteLength }, request_id: id }); await saveIdempotent(env, idempotencyKey, clientId, endpoint, 201, serialized, requestHash);
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      const documentMatch = route.match(/^\/documents\/([^/]+)$/);
      if (documentMatch && request.method === "GET") {
        if (!hasScope(auth, "documents.read")) return error("FORBIDDEN", "Document read scope required", 403, id, headers);
        const row = await env.DB.prepare("SELECT object_key, client_id, content_type FROM shipment_documents WHERE id = ? LIMIT 1").bind(documentMatch[1]).first<{ object_key: string; client_id: string; content_type: string }>();
        if (!row || !canAccessClient(auth, row.client_id)) return error("NOT_FOUND", "Document not found", 404, id, headers);
        const object = await env.FILES.get(row.object_key); if (!object) return error("NOT_FOUND", "Document not found", 404, id, headers);
        return new Response(object.body, { headers: withCors(request, env, { "content-type": object.httpMetadata?.contentType ?? row.content_type, "cache-control": "private, no-store", "content-disposition": "attachment" }) });
      }

      if (route === "/dashboard/summary" && request.method === "GET") {
        const view = url.searchParams.get("view")?.trim().toLowerCase() ?? "";
        const requestedCollections = new Set((url.searchParams.get("collections") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
        const includeCollection = (key: string) => requestedCollections.size === 0 || requestedCollections.has(key);
        const permissionFingerprint = [...auth.permissions].sort().join(",");
        const scopeKey = `${auth.userId ?? auth.clientId ?? "anonymous"}:${auth.audience}:${auth.system ? "system" : [...auth.clientIds].sort().join(",")}:${permissionFingerprint}:${view}:${[...requestedCollections].sort().join(",")}`;
        const cachedSummary = dashboardSummaryCache.get(scopeKey);
        if (cachedSummary && cachedSummary.expiresAt > Date.now()) return json({ ok: true, data: cachedSummary.data, request_id: id }, 200, headers);
        const internalSummaryView = auth.system || hasScope(auth, "shipments.sensitive.read");

        if (view === "overview") {
          const clientIds = [...auth.clientIds];
          const clientPlaceholders = clientIds.map(() => "?").join(",");
          const scopedWhere = (extra = "") => auth.system
            ? (extra ? ` WHERE ${extra}` : "")
            : clientIds.length
              ? ` WHERE client_id IN (${clientPlaceholders})${extra ? ` AND ${extra}` : ""}`
              : " WHERE 1 = 0";
          const scoped = (sql: string, extra = "") => {
            const statement = env.DB.prepare(`${sql}${scopedWhere(extra)}`);
            return auth.system || !clientIds.length ? statement : statement.bind(...clientIds);
          };
          const overviewEntries: Array<{ key: string; statement: ReturnType<typeof env.DB.prepare> }> = [];
          const addOverview = (key: string, scope: string, sql: string, extra: string) => {
            if (hasScope(auth, scope)) overviewEntries.push({ key, statement: scoped(sql, extra) });
          };
          addOverview("shipments", "shipments.read", "SELECT id, client_id, provider, provider_reference, status, origin, destination, total_weight_kg, pieces, edd, delivered_at, created_at FROM shipments", "edd IS NOT NULL AND (date(edd) < date('now') OR (delivered_at IS NOT NULL AND date(delivered_at) > date(edd))) AND lower(COALESCE(status, '')) NOT IN ('delivered', 'cancelled') ORDER BY edd ASC LIMIT 20");
          addOverview("pickups", "pickups.read", "SELECT id, shipment_id, client_id, requested_date, requested_time_slot, pickup_address, status, created_at, updated_at FROM pickup_requests", "lower(COALESCE(status, '')) NOT IN ('completed', 'cancelled') ORDER BY requested_date ASC LIMIT 100");
          addOverview("billing", "billing.read", "SELECT id, client_id, shipment_id, invoice_number, amount, currency, status, due_date, created_at FROM billing_records", "lower(COALESCE(status, '')) = 'pending' ORDER BY created_at DESC LIMIT 100");
          addOverview("wallet", "wallet.read", "SELECT id, client_id, type, amount, balance_after, reference, status, created_at FROM wallet_transactions", "1 = 1 ORDER BY created_at DESC LIMIT 1");
          addOverview("exceptions", "cases.read", "SELECT id, shipment_id, client_id, category, severity, title, details, status, assigned_to_user_id, created_at, updated_at FROM exception_cases", "lower(COALESCE(status, '')) NOT IN ('resolved', 'closed') ORDER BY updated_at DESC LIMIT 8");
          addOverview("ndr", "cases.read", "SELECT id, shipment_id, client_id, reason, attempt, deadline, status, assigned_to_user_id, created_at, updated_at FROM ndr_cases", "lower(COALESCE(status, '')) NOT IN ('resolved', 'closed', 'delivered', 'cancelled') ORDER BY updated_at DESC LIMIT 8");
          addOverview("activity", "activity.read", "SELECT id, actor_user_id, client_id, shipment_id, action, entity_type, entity_id, created_at FROM activity_events", "1 = 1 ORDER BY created_at DESC LIMIT 12");
          const overviewResults = overviewEntries.length ? await env.DB.batch<Record<string, unknown>>(overviewEntries.map(({ statement }) => statement)) : [];
          const overviewRowsFor = (key: string) => {
            const index = overviewEntries.findIndex((entry) => entry.key === key);
            return index < 0 ? [] : (overviewResults[index]?.results ?? []) as Record<string, unknown>[];
          };
          const delayedShipments = overviewRowsFor("shipments");
          const pickups = overviewRowsFor("pickups");
          const billing = overviewRowsFor("billing");
          const wallet = overviewRowsFor("wallet");
          const exceptions = overviewRowsFor("exceptions");
          const ndr = overviewRowsFor("ndr");
          const activity = overviewRowsFor("activity");
          const shipmentScope = auth.system ? "" : clientIds.length ? ` WHERE client_id IN (${clientPlaceholders})` : " WHERE 1 = 0";
          const shipmentParams = auth.system ? [] : clientIds;
          const stats = hasScope(auth, "shipments.read") ? await env.DB.batch<Record<string, unknown>>([
            env.DB.prepare(`SELECT COUNT(*) AS total FROM shipments${shipmentScope}`).bind(...shipmentParams),
            env.DB.prepare(`SELECT status, COUNT(*) AS count FROM shipments${shipmentScope} GROUP BY status`).bind(...shipmentParams),
            env.DB.prepare(`SELECT COUNT(*) AS count FROM shipments${shipmentScope}${shipmentScope ? " AND" : " WHERE"} edd IS NOT NULL AND date(edd) < date('now') AND lower(COALESCE(status, '')) NOT IN ('delivered', 'cancelled')`).bind(...shipmentParams),
            env.DB.prepare(`SELECT COALESCE(provider, 'unknown') AS provider, COUNT(*) AS count FROM shipments${shipmentScope} GROUP BY provider`).bind(...shipmentParams),
          ]) : [];
          const shipmentStats = { total: Number(stats[0]?.results?.[0]?.total ?? 0), delayed: Number(stats[2]?.results?.[0]?.count ?? 0), statuses: {} as Record<string, number>, providers: {} as Record<string, number> };
          for (const row of stats[1]?.results ?? []) shipmentStats.statuses[String(row.status ?? "unknown")] = Number(row.count ?? 0);
          for (const row of stats[3]?.results ?? []) shipmentStats.providers[String(row.provider ?? "unknown")] = Number(row.count ?? 0);
          const notificationCount = hasScope(auth, "notifications.read")
            ? auth.system
              ? await env.DB.prepare("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0").first<{ count: number }>()
              : clientIds.length
                ? await env.DB.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0 AND (client_id IN (${clientPlaceholders}) OR recipient_user_id = ?)`).bind(...clientIds, auth.userId ?? "").first<{ count: number }>()
                : { count: 0 }
            : { count: 0 };
          const data = {
            shipments: delayedShipments,
            pickups,
            billing,
            wallet,
            exceptions,
            ndr,
            activity,
            shipment_stats: shipmentStats,
            unread_notification_count: Number(notificationCount?.count ?? 0),
            overview: true,
          };
          dashboardSummaryCache.set(scopeKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, data });
          return json({ ok: true, data, request_id: id }, 200, headers);
        }

        const summaryColumns: Record<string, string> = {
          shipments: internalSummaryView ? "id, client_id, provider, provider_reference, status, origin, destination, consignee, total_weight_kg, pieces, edd, delivered_at, created_at" : "id, client_id, provider, status, origin, destination, consignee, total_weight_kg, pieces, edd, delivered_at, created_at",
          pickup_requests: "id, shipment_id, client_id, requested_date, requested_time_slot, pickup_address, status, created_at, updated_at",
          billing_records: "id, client_id, shipment_id, invoice_number, amount, currency, status, due_date, created_at",
          wallet_transactions: "id, client_id, type, amount, balance_after, reference, status, created_at",
          exception_cases: "id, shipment_id, client_id, category, severity, title, details, status, assigned_to_user_id, created_at, updated_at",
          ndr_cases: "id, shipment_id, client_id, reason, attempt, deadline, status, assigned_to_user_id, created_at, updated_at",
          activity_events: "id, actor_user_id, client_id, shipment_id, action, entity_type, entity_id, created_at",
          return_shipments: internalSummaryView ? "id, shipment_id, client_id, reason, status, provider_reference, created_at, updated_at" : "id, shipment_id, client_id, reason, status, created_at, updated_at",
          support_tickets: "id, client_id, shipment_id, assigned_to_user_id, title, description, priority, status, created_at, updated_at",
          notifications: "id, recipient_user_id, client_id, shipment_id, category, title, message, type, is_read, created_at",
          tasks: "id, client_id, shipment_id, title, description, priority, status, assigned_to_user_id, due_at, created_at, updated_at",
        };
        type SummaryStatement = ReturnType<typeof env.DB.prepare>;
        const entries: Array<{ key: string; statement: SummaryStatement }> = [];
        const addCollection = (key: string, table: string, order: string, scope: string) => {
          if (!includeCollection(key) || !hasScope(auth, scope)) return;
          const columns = summaryColumns[table] ?? "*";
          const collectionLimit = " LIMIT 100";
          if (auth.system) {
            entries.push({ key, statement: env.DB.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${order}${collectionLimit}`) });
            return;
          }
          if (!auth.clientIds.size) return;
          const placeholders = [...auth.clientIds].map(() => "?").join(",");
          entries.push({ key, statement: env.DB.prepare(`SELECT ${columns} FROM ${table} WHERE client_id IN (${placeholders}) ORDER BY ${order}${collectionLimit}`).bind(...auth.clientIds) });
        };
        addCollection("shipments", "shipments", "created_at DESC", "shipments.read");
        addCollection("pickups", "pickup_requests", "requested_date DESC", "pickups.read");
        addCollection("billing", "billing_records", "created_at DESC", "billing.read");
        addCollection("wallet", "wallet_transactions", "created_at DESC", "wallet.read");
        addCollection("exceptions", "exception_cases", "updated_at DESC", "cases.read");
        addCollection("ndr", "ndr_cases", "updated_at DESC", "cases.read");
        addCollection("activity", "activity_events", "created_at DESC", "activity.read");
        addCollection("returns", "return_shipments", "updated_at DESC", "cases.read");
        addCollection("tickets", "support_tickets", "updated_at DESC", "tickets.read");
        if (includeCollection("notifications") && hasScope(auth, "notifications.read")) {
          if (auth.system) entries.push({ key: "notifications", statement: env.DB.prepare("SELECT id, recipient_user_id, client_id, shipment_id, category, title, message, type, is_read, created_at FROM notifications ORDER BY created_at DESC LIMIT 100") });
          else if (auth.clientIds.size) entries.push({ key: "notifications", statement: env.DB.prepare(`SELECT id, recipient_user_id, client_id, shipment_id, category, title, message, type, is_read, created_at FROM notifications WHERE (client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR recipient_user_id = ?) ORDER BY created_at DESC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "") });
        }
        if (includeCollection("tasks") && hasScope(auth, "tasks.read")) {
          if (auth.system) entries.push({ key: "tasks", statement: env.DB.prepare("SELECT id, client_id, shipment_id, title, description, priority, status, assigned_to_user_id, due_at, created_at, updated_at FROM tasks ORDER BY due_at ASC LIMIT 100") });
          else if (auth.clientIds.size) entries.push({ key: "tasks", statement: env.DB.prepare(`SELECT id, client_id, shipment_id, title, description, priority, status, assigned_to_user_id, due_at, created_at, updated_at FROM tasks WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR assigned_to_user_id = ? ORDER BY due_at ASC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "") });
        }
        if (includeCollection("preferences") && auth.userId) entries.push({ key: "preferences", statement: env.DB.prepare("SELECT email_notifications, task_reminders, compact_layout FROM employee_preferences WHERE user_id = ? LIMIT 1").bind(auth.userId) });
        const batchResults = entries.length ? await env.DB.batch<Record<string, unknown>>(entries.map(({ statement }) => statement)) : [];
        const rowsFor = (key: string) => {
          const index = entries.findIndex((entry) => entry.key === key);
          return index < 0 ? [] : (batchResults[index]?.results ?? []) as Record<string, unknown>[];
        };
        const shipments = rowsFor("shipments");
        const pickups = rowsFor("pickups");
        const billing = rowsFor("billing");
        const wallet = rowsFor("wallet");
        const exceptions = rowsFor("exceptions");
        const ndr = rowsFor("ndr");
        const activity = rowsFor("activity");
        const returns = rowsFor("returns");
        const tickets = rowsFor("tickets");
        const notifications = rowsFor("notifications");
        const tasks = rowsFor("tasks");
        const preferences = rowsFor("preferences")[0] ?? null;
        const shipmentStats = { total: 0, delayed: 0, statuses: {} as Record<string, number>, providers: {} as Record<string, number> };
        if (hasScope(auth, "shipments.read")) {
          const shipmentScope = auth.system ? "" : auth.clientIds.size ? ` WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")})` : " WHERE 1 = 0";
          const shipmentParams = auth.system ? [] : [...auth.clientIds];
          const stats = await env.DB.batch<Record<string, unknown>>([
            env.DB.prepare(`SELECT COUNT(*) AS total FROM shipments${shipmentScope}`).bind(...shipmentParams),
            env.DB.prepare(`SELECT status, COUNT(*) AS count FROM shipments${shipmentScope} GROUP BY status`).bind(...shipmentParams),
            env.DB.prepare(`SELECT COUNT(*) AS count FROM shipments${shipmentScope}${shipmentScope ? " AND" : " WHERE"} edd IS NOT NULL AND date(edd) < date('now') AND lower(COALESCE(status, '')) NOT IN ('delivered', 'cancelled')`).bind(...shipmentParams),
            env.DB.prepare(`SELECT COALESCE(provider, 'unknown') AS provider, COUNT(*) AS count FROM shipments${shipmentScope} GROUP BY provider`).bind(...shipmentParams),
          ]);
          shipmentStats.total = Number(stats[0]?.results?.[0]?.total ?? 0);
          shipmentStats.delayed = Number(stats[2]?.results?.[0]?.count ?? 0);
          for (const row of stats[1]?.results ?? []) shipmentStats.statuses[String(row.status ?? "unknown")] = Number(row.count ?? 0);
          for (const row of stats[3]?.results ?? []) shipmentStats.providers[String(row.provider ?? "unknown")] = Number(row.count ?? 0);
        }
        const data = {
          shipments,
          pickups,
          billing,
          wallet,
          exceptions,
          ndr,
          activity,
          returns,
          tickets,
          notifications,
          tasks,
          preferences,
          shipment_stats: shipmentStats,
          permissions: [...auth.permissions],
        };
        dashboardSummaryCache.set(scopeKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, data });
        return json({ ok: true, data, request_id: id }, 200, headers);
      }

      if (route === "/reports/shipments" && request.method === "GET") {
        if (!hasScope(auth, "reports.read")) return error("FORBIDDEN", "Report read scope required", 403, id, headers);
        const summarySql = "SELECT status, COUNT(*) AS shipments, SUM(CASE WHEN edd IS NOT NULL AND date(COALESCE(delivered_at, CURRENT_TIMESTAMP)) > date(edd) THEN 1 ELSE 0 END) AS delayed FROM shipments";
        const detailSql = "SELECT id, client_id, tracking_number, status, edd, delivered_at, CASE WHEN edd IS NULL THEN 0 ELSE MAX(0, CAST(julianday(date(COALESCE(delivered_at, CURRENT_TIMESTAMP))) - julianday(date(edd)) AS INTEGER)) END AS delay_days FROM shipments";
        const summary = auth.system
          ? await env.DB.prepare(`${summarySql} GROUP BY status ORDER BY status`).all()
          : auth.clientIds.size
            ? await env.DB.prepare(`${summarySql} WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) GROUP BY status ORDER BY status`).bind(...auth.clientIds).all()
            : { results: [] };
        const details = auth.system
          ? await env.DB.prepare(`${detailSql} ORDER BY created_at DESC`).all()
          : auth.clientIds.size
            ? await env.DB.prepare(`${detailSql} WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY created_at DESC`).bind(...auth.clientIds).all()
            : { results: [] };
        return json({ ok: true, data: summary.results, details: details.results }, 200, headers);
      }

      // Serve the client report through one authenticated D1 batch. The
      // previous UI fan-out made this view wait on seven independent calls.
      if (route === "/reports/client-complete" && request.method === "GET") {
        if (!hasScope(auth, "reports.read")) return error("FORBIDDEN", "Report read scope required", 403, id, headers);
        const clientIds = [...auth.clientIds];
        const columnsByTable: Record<string, string> = {
          shipments: "id, client_id, tracking_number, status, provider, origin, destination, consignee, total_weight_kg, edd, delivered_at, created_at",
          pickup_requests: "id, client_id, requested_date, requested_time_slot, pickup_address, status, notes, created_at",
          billing_records: "id, client_id, shipment_id, amount, status, created_at",
          ndr_cases: "id, client_id, shipment_id, reason, attempt, deadline, status, notes, created_at",
          exception_cases: "id, client_id, shipment_id, category, severity, title, details, status, created_at",
          weight_reconciliations: "id, client_id, shipment_id, measured_weight_kg, billable_weight_kg, status, updated_at, created_at",
        };
        const scoped = (table: string) => auth.system
          ? env.DB.prepare(`SELECT ${columnsByTable[table] ?? "*"} FROM ${table} ORDER BY created_at DESC`)
          : clientIds.length
            ? env.DB.prepare(`SELECT ${columnsByTable[table] ?? "*"} FROM ${table} WHERE client_id IN (${clientIds.map(() => "?").join(",")}) ORDER BY created_at DESC`).bind(...clientIds)
            : null;
        const entries: Array<{ key: string; statement: ReturnType<typeof env.DB.prepare> }> = [];
        const add = (key: string, table: string, scope: string) => {
          if (!hasScope(auth, scope)) return;
          const statement = scoped(table);
          if (statement) entries.push({ key, statement });
        };
        add("shipments", "shipments", "shipments.read");
        add("pickups", "pickup_requests", "pickups.read");
        add("billing", "billing_records", "billing.read");
        add("ndr", "ndr_cases", "cases.read");
        add("exceptions", "exception_cases", "cases.read");
        add("weights", "weight_reconciliations", "weight.read");
        const results = entries.length ? await env.DB.batch<Record<string, unknown>>(entries.map(({ statement }) => statement)) : [];
        const rowsFor = (key: string) => {
          const index = entries.findIndex((entry) => entry.key === key);
          return index < 0 ? [] : (results[index]?.results ?? []) as Record<string, unknown>[];
        };
        const shipments = rowsFor("shipments");
        const details = shipments.map((row) => {
          const edd = typeof row.edd === "string" ? row.edd : null;
          const deliveredAt = typeof row.delivered_at === "string" ? row.delivered_at : null;
          const end = new Date(deliveredAt ?? new Date().toISOString()).getTime();
          const due = edd ? new Date(edd).getTime() : NaN;
          const delayDays = Number.isFinite(due) && Number.isFinite(end) ? Math.max(0, Math.floor((end - due) / 86400000)) : 0;
          return { id: row.id, client_id: row.client_id, tracking_number: row.tracking_number ?? null, status: row.status ?? null, edd, delivered_at: deliveredAt, delay_days: delayDays };
        });
        return json({ ok: true, data: { shipments, pickups: rowsFor("pickups"), billing: rowsFor("billing"), ndr: rowsFor("ndr"), exceptions: rowsFor("exceptions"), weights: rowsFor("weights"), shipment_report: { details } }, request_id: id }, 200, headers);
      }

      if (route === "/tickets" && request.method === "GET") { if (!hasScope(auth, "tickets.read")) return error("FORBIDDEN", "Ticket read permission required", 403, id, headers); await refreshTicketEscalations(env); const rows = auth.system ? await env.DB.prepare("SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 100").all() : auth.clientIds.size ? await env.DB.prepare(`SELECT * FROM support_tickets WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT 100`).bind(...auth.clientIds).all() : { results: [] }; return json({ ok: true, data: rows.results }, 200, headers); }
      if (route === "/notifications" && request.method === "GET") { if (!hasScope(auth, "notifications.read")) return error("FORBIDDEN", "Notification read permission required", 403, id, headers); const rows = auth.system ? await env.DB.prepare("SELECT *, is_read, recipient_user_id FROM notifications ORDER BY created_at DESC LIMIT 100").all() : auth.clientIds.size ? await env.DB.prepare(`SELECT *, is_read, recipient_user_id FROM notifications WHERE (client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR recipient_user_id = ?) ORDER BY created_at DESC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "").all() : { results: [] }; return json({ ok: true, data: rows.results }, 200, headers); }
      const collectionRoutes: Record<string, { table: string; scope: string; order: string }> = {
        "/tickets": { table: "support_tickets", scope: "tickets.read", order: "updated_at DESC" },
        "/notifications": { table: "notifications", scope: "notifications.read", order: "created_at DESC" },
        "/ndr": { table: "ndr_cases", scope: "cases.read", order: "updated_at DESC" },
        "/exceptions": { table: "exception_cases", scope: "cases.read", order: "updated_at DESC" },
        "/returns": { table: "return_shipments", scope: "cases.read", order: "updated_at DESC" },
        "/warehouses": { table: "warehouses", scope: "addresses.manage", order: "updated_at DESC" },
        "/addresses": { table: "client_addresses", scope: "addresses.manage", order: "updated_at DESC" },
        "/billing": { table: "billing_records", scope: "billing.read", order: "created_at DESC" },
        "/wallet": { table: "wallet_transactions", scope: "wallet.read", order: "created_at DESC" },
        "/cod-remittances": { table: "cod_remittances", scope: "cod.read", order: "created_at DESC" },
        "/weight-reconciliation": { table: "weight_reconciliations", scope: "weight.read", order: "updated_at DESC" },
      };
      if (route === "/warehouses" && request.method === "GET") {
        if (!hasScope(auth, "addresses.manage")) return error("FORBIDDEN", "Permission required", 403, id, headers);
        const rows = auth.system
          ? await env.DB.prepare("SELECT * FROM warehouses ORDER BY updated_at DESC").all<Record<string, unknown>>()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT * FROM warehouses WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY updated_at DESC`).bind(...auth.clientIds).all<Record<string, unknown>>()
            : { results: [] as Record<string, unknown>[] };
        const seen = new Set<string>();
        const data = rows.results.filter((row) => {
          const identity = ["client_id", "provider_account_id", "address", "city", "state", "pincode", "contact", "contact_name"].map((field) => normalizeWarehouseIdentityPart(row[field])).join("|");
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
        return json({ ok: true, data }, 200, headers);
      }
      if (route === "/billing" && request.method === "GET") {
        if (!hasScope(auth, "billing.read")) return error("FORBIDDEN", "Permission required", 403, id, headers);
        const shipmentColumns = "s.pss_reference AS shipment_pss_reference, s.tracking_number, s.lr_number, s.master_awb, s.origin AS shipment_origin, s.destination AS shipment_destination, s.origin_address_json AS shipment_origin_address_json, s.destination_address_json AS shipment_destination_address_json, s.consignee AS shipment_consignee, s.description AS shipment_description, s.total_weight_kg, s.declared_value, s.pieces, s.edd, s.dimensions_json, s.created_at AS shipment_created_at";
        const days = Number(url.searchParams.get("days"));
        const dateClause = Number.isInteger(days) && days >= 1 && days <= 90 ? " AND datetime(b.created_at) >= datetime('now', ?)" : "";
        const dateBind = dateClause ? [`-${days} days`] : [];
        const rows = auth.system
          ? await env.DB.prepare(`SELECT b.*, ps.account_scope, ps.origin_zone, ps.destination_zone, ps.chargeable_weight_kg, ps.client_breakdown_json, ${shipmentColumns.replaceAll("s.", "sh.")}, w.provider_weight_received_at, w.client_dispute_deadline_at FROM billing_records b LEFT JOIN pricing_shipment_snapshots ps ON ps.shipment_id = b.shipment_id LEFT JOIN shipments sh ON sh.id = b.shipment_id LEFT JOIN weight_reconciliations w ON w.shipment_id = b.shipment_id WHERE 1 = 1${dateClause} ORDER BY b.created_at DESC`).bind(...dateBind).all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT b.*, ps.account_scope, ps.origin_zone, ps.destination_zone, ps.chargeable_weight_kg, ps.client_breakdown_json, ${shipmentColumns.replaceAll("s.", "sh.")}, w.provider_weight_received_at, w.client_dispute_deadline_at FROM billing_records b LEFT JOIN pricing_shipment_snapshots ps ON ps.shipment_id = b.shipment_id LEFT JOIN shipments sh ON sh.id = b.shipment_id LEFT JOIN weight_reconciliations w ON w.shipment_id = b.shipment_id WHERE b.client_id IN (${[...auth.clientIds].map(() => "?").join(",")})${dateClause} ORDER BY b.created_at DESC`).bind(...auth.clientIds, ...dateBind).all()
            : { results: [] };
        const data = await Promise.all(rows.results.map(async (row) => { const record = row as Record<string, unknown>; let pricing: unknown = null; if (typeof record.client_breakdown_json === "string") { try { pricing = JSON.parse(record.client_breakdown_json); } catch { pricing = null; } } const adjustments = record.shipment_id ? await env.DB.prepare("SELECT component_code, previous_amount, new_amount, reason, actor_user_id, created_at FROM pricing_overrides WHERE shipment_id = ? ORDER BY created_at ASC").bind(record.shipment_id).all() : { results: [] }; const amendments = record.shipment_id ? await env.DB.prepare("SELECT id, amendment_type, previous_amount, new_amount, reason, weight_received_at, ticket_deadline_at, actor_user_id, created_at FROM billing_amendments WHERE shipment_id = ? ORDER BY created_at ASC").bind(record.shipment_id).all() : { results: [] }; const lineItems = record.id ? await env.DB.prepare("SELECT id, code, label, amount, marker, display_order, created_at FROM billing_line_items WHERE billing_id = ? ORDER BY display_order ASC, code ASC").bind(record.id).all() : { results: [] }; const safe = { ...record }; delete safe.client_breakdown_json; const parseJson = (value: unknown) => { if (typeof value !== "string") return value ?? null; try { return JSON.parse(value); } catch { return null; } }; return { ...safe, pricing, line_items: lineItems.results, adjustments: adjustments.results, amendments: amendments.results, shipment_origin_address: parseJson(record.shipment_origin_address_json), shipment_destination_address: parseJson(record.shipment_destination_address_json), dimensions: parseJson(record.dimensions_json) }; }));
        return json({ ok: true, data }, 200, headers);
      }
      if (route === "/weight-reconciliation" && request.method === "GET") {
        if (!hasScope(auth, "weight.read")) return error("FORBIDDEN", "Permission required", 403, id, headers);
        const clientColumns = "w.id, w.client_id, w.shipment_id, w.declared_weight_kg, w.declared_volumetric_weight_kg, w.initial_billable_weight_kg, w.measured_weight_kg, w.courier_billed_weight_kg, w.billable_weight_kg, w.status, w.provider_weight_received_at, w.client_dispute_deadline_at, w.created_at, w.updated_at, w.client_dispute_deadline_at AS ticket_deadline_at, t.id AS ticket_id, t.status AS ticket_status, t.reason AS ticket_reason";
        const employeeColumns = `${clientColumns}, w.provider_dispute_status`;
        const internalColumns = `${employeeColumns}, w.provider_recovery_amount, w.retained_recovery_amount, t.client_credit_amount`;
        const columns = hasScope(auth, "provider_cost.view") || hasScope(auth, "weight_dispute.resolve") ? internalColumns : hasRole(auth, ["employee", "admin", "super_admin"]) ? employeeColumns : clientColumns;
        const rows = auth.system ? await env.DB.prepare(`SELECT ${columns} FROM weight_reconciliations w LEFT JOIN weight_reconciliation_tickets t ON t.reconciliation_id = w.id ORDER BY w.updated_at DESC`).all() : auth.clientIds.size ? await env.DB.prepare(`SELECT ${columns} FROM weight_reconciliations w LEFT JOIN weight_reconciliation_tickets t ON t.reconciliation_id = w.id WHERE w.client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY w.updated_at DESC`).bind(...auth.clientIds).all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      const collection = collectionRoutes[route];
      if (collection && request.method === "GET") {
        if (!hasScope(auth, collection.scope)) return error("FORBIDDEN", "Permission required", 403, id, headers);
        const internalCollectionView = hasRole(auth, ["employee", "admin", "super_admin"]) || auth.system;
        const select = collection.table === "return_shipments" && !internalCollectionView
          ? "id, shipment_id, client_id, reason, status, created_at, updated_at"
          : "*";
        const unlimitedCollection = ["ndr_cases", "exception_cases", "return_shipments"].includes(collection.table);
        const collectionLimit = unlimitedCollection ? "" : " LIMIT 100";
        const rows = auth.system ? await env.DB.prepare(`SELECT ${select} FROM ${collection.table} ORDER BY ${collection.order}${collectionLimit}`).all() : auth.clientIds.size ? await env.DB.prepare(`SELECT ${select} FROM ${collection.table} WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY ${collection.order}${collectionLimit}`).bind(...auth.clientIds).all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      if ((route === "/billing" || route === "/wallet") && request.method === "POST") {
        const scope = route === "/billing" ? "billing.manage" : "wallet.manage";
        if (!hasScope(auth, scope) || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Administrator finance permission required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        if (route === "/billing" && payload.shipment_id !== undefined && !(await shipmentBelongsToClient(env, payload.shipment_id, clientId))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const amount = Number(payload.amount); if (!Number.isFinite(amount) || amount <= 0) return error("VALIDATION_ERROR", "A positive amount is required", 400, id, headers);
        if (route === "/wallet" && !["credit", "debit"].includes(String(payload.type ?? "").trim().toLowerCase())) return error("VALIDATION_ERROR", "Wallet type must be credit or debit", 400, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `POST /v1${route}`; const existing = await idempotentResponse(env, key, clientId, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const recordId = crypto.randomUUID();
        if (route === "/billing") {
          await env.DB.prepare("INSERT INTO billing_records (id, client_id, shipment_id, invoice_number, amount, status, due_date) VALUES (?, ?, ?, ?, ?, 'pending', ?)").bind(recordId, clientId, typeof payload.shipment_id === "string" ? payload.shipment_id : null, typeof payload.invoice_number === "string" ? payload.invoice_number : `INV-${recordId.slice(0, 8).toUpperCase()}`, amount, typeof payload.due_date === "string" ? payload.due_date : null).run();
        } else {
          await env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, ?, ?, ?, 'pending', 0)").bind(recordId, clientId, String(payload.type).trim().toLowerCase(), amount, typeof payload.reference === "string" ? payload.reference : `ADJ-${recordId.slice(0, 8).toUpperCase()}`).run();
          await recalculateWalletBalances(env, clientId);
        }
        await audit(env, ctx, auth, id, `${route.slice(1)}.created`, route.slice(1), recordId, { client_id: clientId, amount });
        const serialized = JSON.stringify({ ok: true, data: { id: recordId, client_id: clientId, amount, status: "pending" }, request_id: id }); await saveIdempotent(env, key, clientId, endpoint, 201, serialized, requestHash);
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      if ((route === "/warehouses" || route === "/addresses") && request.method === "POST") {
        if (!hasScope(auth, "addresses.manage")) return error("FORBIDDEN", "Address management permission required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `POST /v1${route}`; const existing = await idempotentResponse(env, key, clientId, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const recordId = crypto.randomUUID();
        let providerStatus: string | null = null;
        let providerError: string | null = null;
        if (route === "/warehouses") {
          if (typeof payload.name !== "string" || typeof payload.address !== "string") return error("VALIDATION_ERROR", "Warehouse name and address are required", 400, id, headers);
          if (typeof payload.pincode !== "string" || !/^\d{6}$/.test(payload.pincode.trim())) return error("VALIDATION_ERROR", "A valid six-digit warehouse PIN code is required", 400, id, headers);
          const requestedProviderAccountId = typeof payload.provider_account_id === "string" && payload.provider_account_id.trim() ? payload.provider_account_id.trim() : null;
          const providerAccountId = await resolveDelhiveryProviderAccountId(env, clientId, requestedProviderAccountId);
          if (!providerAccountId) return error("PROVIDER_ACCOUNT_NOT_ALLOWED", "An active Delhivery account is required for warehouse creation", 409, id, headers);
          const liveServiceability = await verifyDelhiveryServiceability(env, payload.pincode.trim(), payload.pincode.trim(), providerAccountId, id, clientId);
          if (!liveServiceability.ok) return error("PROVIDER_SERVICEABILITY_FAILED", liveServiceability.reason ?? "Delhivery could not verify this warehouse pickup pincode", 409, id, headers, JSON.stringify({ provenance: liveServiceability.provenance, origin: liveServiceability.origin }));
          const duplicate = await env.DB.prepare("SELECT id, client_id, name, provider, provider_account_id, provider_status, provider_error FROM warehouses WHERE client_id = ? AND lower(trim(COALESCE(provider_account_id, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(address)) = lower(trim(?)) AND lower(trim(COALESCE(city, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(state, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(pincode, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(contact, ''))) = lower(trim(COALESCE(?, ''))) AND lower(trim(COALESCE(contact_name, ''))) = lower(trim(COALESCE(?, ''))) ORDER BY updated_at DESC LIMIT 1").bind(clientId, providerAccountId, payload.address, String(payload.city ?? ""), String(payload.state ?? ""), String(payload.pincode ?? ""), String(payload.contact ?? ""), String(payload.contact_name ?? "")).first<{ id: string; client_id: string; name: string; provider: string | null; provider_account_id: string | null; provider_status: string | null; provider_error: string | null }>();
          if (duplicate) {
            const serialized = JSON.stringify({ ok: true, data: duplicate, deduplicated: true, request_id: id });
            await saveIdempotent(env, key, clientId, endpoint, 200, serialized, requestHash);
            return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
          }
          await env.DB.prepare("INSERT INTO warehouses (id, client_id, name, address, city, state, pincode, contact, contact_name, provider, provider_account_id, provider_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delhivery', ?, 'pending')").bind(recordId, clientId, payload.name, payload.address, String(payload.city ?? ""), String(payload.state ?? ""), String(payload.pincode ?? ""), String(payload.contact ?? ""), String(payload.contact_name ?? ""), providerAccountId).run();
          const context = await delhiveryWarehouseProviderContext(env, clientId, providerAccountId, id, 30000);
          if (!context.ok) {
            providerStatus = "failed";
            providerError = context.error;
            delhiveryWarehouseLog(id, "account_context_failed", { requested_account_id: providerAccountId, error: providerError });
            await env.DB.prepare("UPDATE warehouses SET provider_status = 'failed', provider_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(providerError, recordId, clientId).run();
          } else {
            delhiveryWarehouseLog(id, "account_context_ready", { account_id: context.accountId, account_name: context.accountName });
            const sync = await ensureDelhiveryWarehouse(env, clientId, context.token, {
              name: String(payload.name),
              line: payload.address,
              city: String(payload.city ?? ""),
              state: String(payload.state ?? ""),
              pincode: String(payload.pincode ?? ""),
              phone: String(payload.contact ?? ""),
            }, id, 30000, context.base, context.accountId, recordId, context.warehouseApiToken);
            if (!sync.ok) {
              providerStatus = "failed";
              providerError = sync.error;
              await env.DB.prepare("UPDATE warehouses SET provider_status = 'failed', provider_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(providerError, recordId, clientId).run();
            } else {
              const saved = await env.DB.prepare("SELECT provider_status, provider_error FROM warehouses WHERE id = ? AND client_id = ? LIMIT 1").bind(recordId, clientId).first<{ provider_status: string | null; provider_error: string | null }>();
              providerStatus = saved?.provider_status ?? "pending";
              providerError = saved?.provider_error ?? null;
            }
          }
        } else {
          if (typeof payload.label !== "string" || typeof payload.address !== "string") return error("VALIDATION_ERROR", "Address label and address are required", 400, id, headers);
          const addressKind = payload.address_kind === "consignee" ? "consignee" : "consignor";
          await env.DB.prepare("INSERT INTO client_addresses (id, client_id, label, address_kind, contact_name, phone, address, city, state, pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(recordId, clientId, payload.label, addressKind, String(payload.contact_name ?? ""), String(payload.phone ?? ""), payload.address, String(payload.city ?? ""), String(payload.state ?? ""), String(payload.pincode ?? "")).run();
        }
        await audit(env, ctx, auth, id, `${route.slice(1)}.created`, route.slice(1, -1), recordId, { client_id: clientId });
        const serialized = JSON.stringify({ ok: true, data: { id: recordId, client_id: clientId, ...(route === "/warehouses" ? { provider: "delhivery", provider_status: providerStatus, provider_error: providerError } : {}) }, request_id: id }); await saveIdempotent(env, key, clientId, endpoint, 201, serialized, requestHash);
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/returns" && request.method === "POST") {
        if (!hasScope(auth, "cases.manage")) return error("FORBIDDEN", "Returns management permission required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId) || typeof payload.shipment_id !== "string" || typeof payload.reason !== "string") return error("VALIDATION_ERROR", "Shipment and return reason are required", 400, id, headers);
        if (!(await shipmentBelongsToClient(env, payload.shipment_id, clientId))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/returns", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const returnId = crypto.randomUUID(); await env.DB.prepare("INSERT INTO return_shipments (id, shipment_id, client_id, reason, status, provider_reference) VALUES (?, ?, ?, ?, 'requested', ?)").bind(returnId, payload.shipment_id, clientId, payload.reason, typeof payload.provider_reference === "string" ? payload.provider_reference : null).run();
        const serialized = JSON.stringify({ ok: true, data: { id: returnId, status: "requested" }, request_id: id }); await saveIdempotent(env, key, clientId, "POST /v1/returns", 201, serialized, requestHash); await audit(env, ctx, auth, id, "return.created", "return", returnId, { client_id: clientId, shipment_id: payload.shipment_id }); return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      if ((route === "/ndr" || route === "/exceptions") && request.method === "POST") {
        if (!hasScope(auth, "cases.manage")) return error("FORBIDDEN", "Case management scope required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId) || typeof payload.shipment_id !== "string" || !payload.shipment_id.trim()) return error("VALIDATION_ERROR", "Shipment and client scope are required", 400, id, headers);
        if (!(await shipmentBelongsToClient(env, payload.shipment_id, clientId))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `POST /v1${route}`; const existing = await idempotentResponse(env, key, clientId, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const caseId = crypto.randomUUID();
        if (route === "/ndr") {
          if (typeof payload.reason !== "string" || !payload.reason.trim()) return error("VALIDATION_ERROR", "NDR reason is required", 400, id, headers);
          if (!(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, clientId))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers);
          await env.DB.prepare("INSERT INTO ndr_cases (id, shipment_id, client_id, reason, attempt, deadline, status, notes, assigned_to_user_id) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)").bind(caseId, payload.shipment_id.trim(), clientId, payload.reason.trim(), Math.max(Number(payload.attempt ?? 1), 1), typeof payload.deadline === "string" ? payload.deadline : null, typeof payload.notes === "string" ? payload.notes : null, typeof payload.assigned_to_user_id === "string" ? payload.assigned_to_user_id : null).run();
        } else {
          if (typeof payload.category !== "string" || !payload.category.trim() || typeof payload.title !== "string" || !payload.title.trim()) return error("VALIDATION_ERROR", "Exception category and title are required", 400, id, headers);
          if (!(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, clientId))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers);
          await env.DB.prepare("INSERT INTO exception_cases (id, shipment_id, client_id, category, severity, title, details, status, assigned_to_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)").bind(caseId, payload.shipment_id.trim(), clientId, payload.category.trim(), String(payload.severity ?? "medium"), payload.title.trim(), typeof payload.details === "string" ? payload.details : null, typeof payload.assigned_to_user_id === "string" ? payload.assigned_to_user_id : null).run();
        }
        const serialized = JSON.stringify({ ok: true, data: { id: caseId, client_id: clientId, shipment_id: payload.shipment_id, status: "new" }, request_id: id });
        await saveIdempotent(env, key, clientId, endpoint, 201, serialized, requestHash); await audit(env, ctx, auth, id, `${route.slice(1)}.created`, route.slice(1, -1), caseId, { client_id: clientId, shipment_id: payload.shipment_id });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      if (route === "/tickets/messages" && request.method === "GET") {
        if (!hasScope(auth, "tickets.read")) return error("FORBIDDEN", "Ticket read permission required", 403, id, headers);
        const rows = auth.system
          ? await env.DB.prepare("SELECT m.id, m.ticket_id, m.author_user_id, m.body AS message, m.created_at FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id ORDER BY m.created_at ASC LIMIT 1000").all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT m.id, m.ticket_id, m.author_user_id, m.body AS message, m.created_at FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id WHERE t.client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY m.created_at ASC LIMIT 1000`).bind(...auth.clientIds).all()
            : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      const ticketMessages = route.match(/^\/tickets\/([^/]+)\/messages$/);
      if (ticketMessages && request.method === "GET") {
        if (!hasScope(auth, "tickets.read")) return error("FORBIDDEN", "Ticket read permission required", 403, id, headers);
        const ticket = await env.DB.prepare("SELECT client_id FROM support_tickets WHERE id = ? LIMIT 1").bind(ticketMessages[1]).first<{ client_id: string }>();
        if (!ticket || !canAccessClient(auth, ticket.client_id)) return error("NOT_FOUND", "Ticket not found", 404, id, headers);
        const messages = await env.DB.prepare("SELECT id, ticket_id, author_user_id, body AS message, created_at FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC LIMIT 500").bind(ticketMessages[1]).all();
        return json({ ok: true, data: messages.results }, 200, headers);
      }
      if (ticketMessages && ticketMessages[1] && request.method === "POST") {
        if (!hasScope(auth, "tickets.create")) return error("FORBIDDEN", "Ticket reply permission required", 403, id, headers);
        const ticket = await env.DB.prepare("SELECT client_id FROM support_tickets WHERE id = ? LIMIT 1").bind(ticketMessages[1]).first<{ client_id: string }>();
        if (!ticket || !canAccessClient(auth, ticket.client_id)) return error("NOT_FOUND", "Ticket not found", 404, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); if (typeof payload.message !== "string" || !payload.message.trim()) return error("VALIDATION_ERROR", "Message is required", 400, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `POST /v1/tickets/${ticketMessages[1]}/messages`; const existing = await idempotentResponse(env, idempotencyKey, ticket.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const messageId = crypto.randomUUID(); await env.DB.prepare("INSERT INTO support_messages (id, ticket_id, author_user_id, body) VALUES (?, ?, ?, ?)").bind(messageId, ticketMessages[1], auth.userId ?? `api:${ticket.client_id}`, payload.message.trim()).run();
        await env.DB.prepare("UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(ticketMessages[1]).run();
        await audit(env, ctx, auth, id, "ticket.message_created", "ticket", ticketMessages[1], { client_id: ticket.client_id });
        const serialized = JSON.stringify({ ok: true, data: { id: messageId, ticket_id: ticketMessages[1] }, request_id: id }); await saveIdempotent(env, idempotencyKey, ticket.client_id, endpoint, 201, serialized, requestHash);
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      if (route === "/tickets" && request.method === "POST") {
        if (!hasScope(auth, "tickets.create")) return error("FORBIDDEN", "Ticket creation scope required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        if (typeof payload.title !== "string" || typeof payload.description !== "string") return error("VALIDATION_ERROR", "Ticket title and description are required", 400, id, headers);
        const priority = String(payload.priority ?? "normal").trim().toLowerCase();
        if (!["normal", "high", "urgent"].includes(priority)) return error("VALIDATION_ERROR", "Ticket priority must be normal, high, or urgent", 400, id, headers);
        if (payload.shipment_id !== undefined && !(await shipmentBelongsToClient(env, payload.shipment_id, clientId))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/tickets", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const ticketId = crypto.randomUUID(); await env.DB.prepare("INSERT INTO support_tickets (id, client_id, shipment_id, title, description, priority, status, sla_due_at, escalation_state, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, 'open', datetime(CURRENT_TIMESTAMP, CASE ? WHEN 'urgent' THEN '+4 hours' WHEN 'high' THEN '+8 hours' ELSE '+24 hours' END), 'normal', ?)").bind(ticketId, clientId, typeof payload.shipment_id === "string" ? payload.shipment_id : null, payload.title.trim(), payload.description.trim(), priority, priority, auth.userId ?? `api:${clientId}`).run();
        const serialized = JSON.stringify({ ok: true, data: { id: ticketId, client_id: clientId, status: "open", priority, escalation_state: "normal" }, request_id: id }); await saveIdempotent(env, key, clientId, "POST /v1/tickets", 201, serialized, requestHash);
        await audit(env, ctx, auth, id, "ticket.created", "ticket", ticketId, { client_id: clientId });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const weightTicket = route.match(/^\/weight-reconciliation\/([^/]+)\/ticket$/);
      if (weightTicket && request.method === "POST") {
        if (!hasScope(auth, "tickets.create")) return error("FORBIDDEN", "Weight ticket permission required", 403, id, headers);
        const reconciliation = await env.DB.prepare("SELECT id, client_id, shipment_id, client_dispute_deadline_at FROM weight_reconciliations WHERE id = ? LIMIT 1").bind(weightTicket[1]).first<{ id: string; client_id: string; shipment_id: string; client_dispute_deadline_at: string | null }>();
        if (!reconciliation || !canAccessClient(auth, reconciliation.client_id)) return error("NOT_FOUND", "Weight reconciliation record not found", 404, id, headers);
        const openTicket = await env.DB.prepare("SELECT id, status, deadline_at FROM weight_reconciliation_tickets WHERE reconciliation_id = ? LIMIT 1").bind(reconciliation.id).first<{ id: string; status: string; deadline_at: string }>();
        if (openTicket) return json({ ok: true, data: openTicket }, 200, headers);
        const payload = await bodyJson(request); const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
        if (!reason) return error("VALIDATION_ERROR", "A reason is required for a weight ticket", 400, id, headers);
        const deadline = reconciliation.client_dispute_deadline_at ? { deadline_at: reconciliation.client_dispute_deadline_at } : null;
        if (!deadline?.deadline_at) return error("WEIGHT_TICKET_NOT_AVAILABLE", "The courier weight has not been received yet", 409, id, headers);
        if (Date.parse(`${deadline.deadline_at.replace(" ", "T")}Z`) <= Date.now()) return error("WEIGHT_TICKET_WINDOW_CLOSED", "The 24-hour weight-ticket window has closed", 409, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const requestHash = await payloadFingerprint(payload); const endpoint = `POST /v1/weight-reconciliation/${reconciliation.id}/ticket`; const existing = await idempotentResponse(env, key, reconciliation.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const ticketId = crypto.randomUUID(); await env.DB.prepare("INSERT INTO weight_reconciliation_tickets (id, reconciliation_id, shipment_id, client_id, reason, deadline_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(ticketId, reconciliation.id, reconciliation.shipment_id, reconciliation.client_id, reason, deadline.deadline_at, auth.userId ?? `api:${reconciliation.client_id}`).run();
        const serialized = JSON.stringify({ ok: true, data: { id: ticketId, reconciliation_id: reconciliation.id, shipment_id: reconciliation.shipment_id, status: "open", deadline_at: deadline.deadline_at }, request_id: id }); await saveIdempotent(env, key, reconciliation.client_id, endpoint, 201, serialized, requestHash); await audit(env, ctx, auth, id, "weight_ticket.created", "weight_reconciliation", reconciliation.id, { client_id: reconciliation.client_id, ticket_id: ticketId, reason }); return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const weightResolution = route.match(/^\/weight-reconciliation\/([^/]+)\/resolve$/);
      const providerWeightUpdate = route.match(/^\/weight-reconciliation\/([^/]+)\/provider-update$/);
      if (providerWeightUpdate && request.method === "POST") {
        if (!hasScope(auth, "weight.manage")) return error("FORBIDDEN", "Provider weight access required", 403, id, headers);
        const reconciliation = await env.DB.prepare("SELECT id, client_id, shipment_id FROM weight_reconciliations WHERE id = ? LIMIT 1").bind(providerWeightUpdate[1]).first<{ id: string; client_id: string; shipment_id: string }>();
        if (!reconciliation || !canAccessClient(auth, reconciliation.client_id)) return error("NOT_FOUND", "Weight reconciliation not found", 404, id, headers);
        const payload = await bodyJson(request); const measured = Number(payload.measured_weight_kg); const courierBilled = payload.courier_billed_weight_kg === undefined ? measured : Number(payload.courier_billed_weight_kg); const reason = typeof payload.reason === "string" ? payload.reason.trim() : "Courier weight update";
        if (!Number.isFinite(measured) || measured <= 0 || !Number.isFinite(courierBilled) || courierBilled <= 0 || !reason) return error("VALIDATION_ERROR", "Measured and courier billed weights plus a reason are required", 400, id, headers);
        const providerStatus = payload.raise_provider_dispute === true ? "dispute_pending" : "received"; const actor = auth.userId ?? `api:${reconciliation.client_id}`;
        let invoiceAdjustment = 0;
        let amendedInvoiceAmount: number | null = null;
        let repricedQuote: PricingQuoteRecord | null = null;
        const currentBilling = await env.DB.prepare("SELECT id, amount FROM billing_records WHERE shipment_id = ? AND client_id = ? ORDER BY created_at ASC LIMIT 1").bind(reconciliation.shipment_id, reconciliation.client_id).first<{ id: string; amount: number }>();
        const currentSnapshot = await env.DB.prepare("SELECT id, version_id, account_scope FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(reconciliation.shipment_id, reconciliation.client_id).first<{ id: string; version_id: string; account_scope: PricingAccount }>();
        if (currentBilling && currentSnapshot) {
          const shipment = await env.DB.prepare("SELECT origin_address_json, destination_address_json, declared_value, provider_account_id FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(reconciliation.shipment_id, reconciliation.client_id).first<{ origin_address_json: string; destination_address_json: string; declared_value: number; provider_account_id: string | null }>();
          if (shipment) {
            try {
              const originAddress = JSON.parse(shipment.origin_address_json) as Record<string, unknown>;
              const destinationAddress = JSON.parse(shipment.destination_address_json) as Record<string, unknown>;
              repricedQuote = await createShipmentPricingQuote(env, reconciliation.client_id, { origin_address: originAddress, destination_address: destinationAddress, total_weight_kg: courierBilled, declared_value: Number(shipment.declared_value ?? 0), account_code: currentSnapshot.account_scope, provider_account_id: shipment.provider_account_id ?? undefined }, `weight-reconciliation:${reconciliation.id}`, currentSnapshot.version_id);
              const recalculatedAmount = Number((JSON.parse(repricedQuote.client_breakdown_json) as { total?: number }).total ?? 0);
              const currentAmount = Number(currentBilling.amount ?? 0);
              amendedInvoiceAmount = Math.max(currentAmount, recalculatedAmount);
              invoiceAdjustment = Math.max(amendedInvoiceAmount - currentAmount, 0);
            } catch {
              repricedQuote = null;
            }
          }
        }
        const statements = [env.DB.prepare("UPDATE weight_reconciliations SET measured_weight_kg = ?, courier_billed_weight_kg = ?, provider_weight_received_at = CURRENT_TIMESTAMP, client_dispute_deadline_at = datetime(CURRENT_TIMESTAMP, '+24 hours'), provider_dispute_status = ?, status = CASE WHEN status = 'resolved' THEN status ELSE 'measured' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(measured, courierBilled, providerStatus, reconciliation.id)];
        if (invoiceAdjustment > 0 && currentBilling && currentSnapshot && repricedQuote && amendedInvoiceAmount !== null) {
          statements.push(
            env.DB.prepare("UPDATE billing_records SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(amendedInvoiceAmount, currentBilling.id),
            env.DB.prepare("UPDATE pricing_shipment_snapshots SET client_breakdown_json = ? WHERE id = ?").bind(repricedQuote.client_breakdown_json, currentSnapshot.id),
            env.DB.prepare("DELETE FROM billing_line_items WHERE billing_id = ?").bind(currentBilling.id),
            ...billingLineItemStatements(env, currentBilling.id, reconciliation.shipment_id, reconciliation.client_id, repricedQuote.client_breakdown_json),
            env.DB.prepare("INSERT INTO pricing_overrides (id, shipment_id, client_id, billing_id, component_code, previous_amount, new_amount, reason, actor_user_id) VALUES (?, ?, ?, ?, 'weight_reconciliation_debit', ?, ?, ?, ?)").bind(crypto.randomUUID(), reconciliation.shipment_id, reconciliation.client_id, currentBilling.id, Number(currentBilling.amount), amendedInvoiceAmount, reason, actor),
            env.DB.prepare("INSERT INTO billing_amendments (id, billing_id, shipment_id, client_id, amendment_type, previous_amount, new_amount, reason, weight_received_at, ticket_deadline_at, actor_user_id) VALUES (?, ?, ?, ?, 'courier_weight_debit', ?, ?, ?, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+24 hours'), ?)").bind(crypto.randomUUID(), currentBilling.id, reconciliation.shipment_id, reconciliation.client_id, Number(currentBilling.amount), amendedInvoiceAmount, reason, actor),
            env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, 'debit', ?, ?, 'posted', 0)").bind(crypto.randomUUID(), reconciliation.client_id, invoiceAdjustment, `WEIGHT-DEBIT-${reconciliation.shipment_id}`),
          );
        }
        await env.DB.batch(statements);
        if (invoiceAdjustment > 0) await recalculateWalletBalances(env, reconciliation.client_id);
        if (repricedQuote) await env.DB.prepare("DELETE FROM pricing_quotes WHERE id = ?").bind(repricedQuote.id).run();
        await audit(env, ctx, auth, id, "provider_weight.updated", "weight_reconciliation", reconciliation.id, { client_id: reconciliation.client_id, shipment_id: reconciliation.shipment_id, measured_weight_kg: measured, courier_billed_weight_kg: courierBilled, provider_dispute_status: providerStatus, reason, actor_user_id: actor });
        return json({ ok: true, data: { reconciliation_id: reconciliation.id, shipment_id: reconciliation.shipment_id, measured_weight_kg: measured, courier_billed_weight_kg: courierBilled, provider_weight_received_at: new Date().toISOString(), client_dispute_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), provider_dispute_status: providerStatus, invoice_adjustment_amount: invoiceAdjustment, invoice_amount: amendedInvoiceAmount, status: "measured" } }, 200, headers);
      }
      if (weightResolution && request.method === "POST") {
        if (!hasScope(auth, "weight_dispute.resolve")) return error("FORBIDDEN", "Weight resolution permission required", 403, id, headers);
        const reconciliation = await env.DB.prepare("SELECT id, client_id, shipment_id, status, provider_dispute_status, provider_recovery_amount FROM weight_reconciliations WHERE id = ? LIMIT 1").bind(weightResolution[1]).first<{ id: string; client_id: string; shipment_id: string; status: string; provider_dispute_status: string | null; provider_recovery_amount: number | null }>();
        if (!reconciliation || !canAccessClient(auth, reconciliation.client_id)) return error("NOT_FOUND", "Weight reconciliation not found", 404, id, headers);
        if (reconciliation.status === "resolved") return error("CONFLICT", "This weight reconciliation has already been resolved", 409, id, headers);
        const ticket = await env.DB.prepare("SELECT id, status FROM weight_reconciliation_tickets WHERE reconciliation_id = ? LIMIT 1").bind(reconciliation.id).first<{ id: string; status: string }>();
        if (ticket && ticket.status !== "open") return error("CONFLICT", "This client weight ticket has already been resolved", 409, id, headers);
        if (!ticket && reconciliation.provider_dispute_status === "recovered") return error("CONFLICT", "Provider recovery has already been recorded for this reconciliation", 409, id, headers);
        const payload = await bodyJson(request); const reason = typeof payload.reason === "string" ? payload.reason.trim() : ""; const measured = Number(payload.measured_weight_kg); const clientCredit = Number(payload.client_credit_amount ?? 0); const providerRecovery = Number(payload.provider_recovery_amount ?? 0);
        if (!reason || !Number.isFinite(measured) || measured <= 0 || !Number.isFinite(clientCredit) || clientCredit < 0 || !Number.isFinite(providerRecovery) || providerRecovery < 0) return error("VALIDATION_ERROR", "Measured weight, non-negative amounts, and a resolution reason are required", 400, id, headers);
        if (!ticket && clientCredit > 0) return error("CONFLICT", "A client weight ticket is required before issuing a client credit", 409, id, headers);
        if (!ticket && providerRecovery <= 0) return error("CONFLICT", "Record a provider recovery or open a client weight ticket before resolving this record", 409, id, headers);
        // Client billing resolution and provider recovery are independent decisions.
        // A valid client ticket may be credited even while Delhivery recovery is
        // pending or unavailable; any recovered amount not credited to the client
        // remains PSS-retained.
        const effectiveProviderRecovery = Math.max(providerRecovery, Number(reconciliation.provider_recovery_amount ?? 0));
        const retained = Math.max(effectiveProviderRecovery - clientCredit, 0); const actor = auth.userId ?? `api:${reconciliation.client_id}`;
        const billing = clientCredit > 0 ? await env.DB.prepare("SELECT id, amount FROM billing_records WHERE shipment_id = ? AND client_id = ? ORDER BY created_at ASC LIMIT 1").bind(reconciliation.shipment_id, reconciliation.client_id).first<{ id: string; amount: number }>() : null;
        if (clientCredit > 0 && !billing) return error("NOT_FOUND", "Invoice not found for the weight credit", 404, id, headers);
        const adjustedBillingAmount = billing ? Math.max(Number(billing.amount) - clientCredit, 0) : null;
        const snapshot = clientCredit > 0 ? await env.DB.prepare("SELECT id, client_breakdown_json FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(reconciliation.shipment_id, reconciliation.client_id).first<{ id: string; client_breakdown_json: string }>() : null;
        if (clientCredit > 0 && !snapshot) return error("NOT_FOUND", "Pricing snapshot not found for the weight credit", 404, id, headers);
        let adjustedSnapshotJson: string | null = null;
        if (snapshot) {
          try {
            const breakdown = JSON.parse(snapshot.client_breakdown_json) as { lines?: Array<{ code: string; label: string; amount: number; marker?: "*" }>; subtotal?: number; total?: number };
            const lines = Array.isArray(breakdown.lines) ? breakdown.lines : [];
            lines.push({ code: "weight_reconciliation_credit", label: "Weight reconciliation credit", amount: -clientCredit });
            breakdown.lines = lines;
            breakdown.subtotal = Math.max(Math.round((Number(breakdown.subtotal ?? 0) - clientCredit) * 100) / 100, 0);
            breakdown.total = Math.max(Math.round((Number(breakdown.total ?? billing?.amount ?? 0) - clientCredit) * 100) / 100, 0);
            adjustedSnapshotJson = JSON.stringify(breakdown);
          } catch { return error("CONFLICT", "The pricing snapshot is invalid", 409, id, headers); }
        }
        await env.DB.batch([
          env.DB.prepare("UPDATE weight_reconciliations SET measured_weight_kg = ?, billable_weight_kg = ?, provider_recovery_amount = ?, retained_recovery_amount = ?, provider_dispute_status = CASE WHEN ? > 0 THEN 'recovered' ELSE provider_dispute_status END, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(measured, measured, effectiveProviderRecovery, retained, effectiveProviderRecovery, ticket ? "resolved" : "measured", reconciliation.id),
          ...(ticket ? [env.DB.prepare("UPDATE weight_reconciliation_tickets SET status = 'resolved', resolved_by_user_id = ?, resolution_reason = ?, client_credit_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE reconciliation_id = ?").bind(actor, reason, clientCredit, reconciliation.id)] : []),
          ...(billing && adjustedBillingAmount !== null ? [
            env.DB.prepare("UPDATE billing_records SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(adjustedBillingAmount, billing.id),
            env.DB.prepare("INSERT INTO pricing_overrides (id, shipment_id, client_id, billing_id, component_code, previous_amount, new_amount, reason, actor_user_id) VALUES (?, ?, ?, ?, 'weight_reconciliation_credit', ?, ?, ?, ?)").bind(crypto.randomUUID(), reconciliation.shipment_id, reconciliation.client_id, billing.id, Number(billing.amount), adjustedBillingAmount, reason, actor),
            env.DB.prepare("INSERT INTO billing_amendments (id, billing_id, shipment_id, client_id, amendment_type, previous_amount, new_amount, reason, actor_user_id) VALUES (?, ?, ?, ?, 'client_weight_credit', ?, ?, ?, ?)").bind(crypto.randomUUID(), billing.id, reconciliation.shipment_id, reconciliation.client_id, Number(billing.amount), adjustedBillingAmount, reason, actor),
          ] : []),
          ...(snapshot && adjustedSnapshotJson && billing ? [
            env.DB.prepare("UPDATE pricing_shipment_snapshots SET client_breakdown_json = ? WHERE id = ?").bind(adjustedSnapshotJson, snapshot.id),
            env.DB.prepare("DELETE FROM billing_line_items WHERE billing_id = ?").bind(billing.id),
            ...billingLineItemStatements(env, billing.id, reconciliation.shipment_id, reconciliation.client_id, adjustedSnapshotJson),
          ] : []),
          ...(clientCredit > 0 ? [env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, 'credit', ?, ?, 'posted', 0)").bind(crypto.randomUUID(), reconciliation.client_id, clientCredit, `WEIGHT-CREDIT-${reconciliation.shipment_id}`)] : []),
          ...(providerRecovery > 0 ? [env.DB.prepare("INSERT INTO pricing_provider_recoveries (id, shipment_id, client_id, reconciliation_id, provider, recovered_amount, client_credit_amount, retained_amount, reason, actor_user_id) VALUES (?, ?, ?, ?, 'delhivery', ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), reconciliation.shipment_id, reconciliation.client_id, reconciliation.id, providerRecovery, clientCredit, retained, reason, actor)] : []),
        ]);
        if (clientCredit > 0) await recalculateWalletBalances(env, reconciliation.client_id);
        await audit(env, ctx, auth, id, ticket ? "weight_ticket.resolved" : "provider_weight.recovered", "weight_reconciliation", reconciliation.id, { client_id: reconciliation.client_id, shipment_id: reconciliation.shipment_id, measured_weight_kg: measured, client_credit_amount: clientCredit, provider_recovery_amount: effectiveProviderRecovery, retained_amount: retained, client_ticket: Boolean(ticket), reason });
        return json({ ok: true, data: { reconciliation_id: reconciliation.id, shipment_id: reconciliation.shipment_id, status: ticket ? "resolved" : "measured", measured_weight_kg: measured, client_credit_amount: clientCredit, provider_recovery_amount: effectiveProviderRecovery, retained_amount: retained } }, 200, headers);
      }

      const entityUpdate = route.match(/^\/(tickets|ndr|exceptions|returns|warehouses|addresses|billing|wallet|cod-remittances|weight-reconciliation)\/([^/]+)$/);
      if (entityUpdate && request.method === "PATCH") {
        const map: Record<string, string> = { tickets: "support_tickets", ndr: "ndr_cases", exceptions: "exception_cases", returns: "return_shipments", warehouses: "warehouses", addresses: "client_addresses", billing: "billing_records", wallet: "wallet_transactions", "cod-remittances": "cod_remittances", "weight-reconciliation": "weight_reconciliations" };
        if ((entityUpdate[1] === "billing" || entityUpdate[1] === "wallet") && !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Administrator finance permission required", 403, id, headers);
        const table = map[entityUpdate[1]]; const current = await env.DB.prepare(`SELECT client_id FROM ${table} WHERE id = ? LIMIT 1`).bind(entityUpdate[2]).first<{ client_id: string }>();
        const scopeByEntity: Record<string, string> = { billing: "billing.manage", wallet: "wallet.manage", "cod-remittances": "cod.manage", "weight-reconciliation": "weight.manage" };
        if (!current || !canAccessClient(auth, current.client_id) || (scopeByEntity[entityUpdate[1]] && !hasScope(auth, scopeByEntity[entityUpdate[1]])) || (!scopeByEntity[entityUpdate[1]] && entityUpdate[1] !== "warehouses" && entityUpdate[1] !== "addresses" && !hasRole(auth, ["employee", "admin", "super_admin"]))) return error("NOT_FOUND", "Record not found", 404, id, headers);
        const payload = await bodyJson(request); const financeStatuses: Record<string, string[]> = { billing: ["pending", "approved", "paid", "void", "cancelled"], wallet: ["pending", "approved", "posted", "rejected", "void"] }; const requestedStatus = payload.status === undefined ? undefined : String(payload.status); if (requestedStatus !== undefined && financeStatuses[entityUpdate[1]] && !financeStatuses[entityUpdate[1]].includes(requestedStatus)) return error("VALIDATION_ERROR", "Invalid finance record status", 400, id, headers); if (entityUpdate[1] === "weight-reconciliation" && (typeof payload.reason !== "string" || !payload.reason.trim())) return error("VALIDATION_ERROR", "A reason is required for weight-record changes", 400, id, headers); const requestHash = await payloadFingerprint(payload); const allowedFields = entityUpdate[1] === "warehouses" ? ["name", "address", "city", "state", "pincode", "contact", "contact_name"] : entityUpdate[1] === "addresses" ? ["label", "address_kind", "contact_name", "phone", "address", "city", "state", "pincode"] : entityUpdate[1] === "weight-reconciliation" ? ["status", "measured_weight_kg", "billable_weight_kg"] : entityUpdate[1] === "wallet" ? ["status"] : entityUpdate[1] === "cod-remittances" ? ["status", "settled_at"] : entityUpdate[1] === "ndr" ? ["status", "assigned_to_user_id", "deadline", "notes", "attempt"] : entityUpdate[1] === "exceptions" ? ["status", "assigned_to_user_id", "severity", "details"] : entityUpdate[1] === "returns" ? ["status", "provider_reference"] : ["status", "assigned_to_user_id", "priority"]; if ((entityUpdate[1] === "ndr" || entityUpdate[1] === "exceptions" || entityUpdate[1] === "tickets") && payload.assigned_to_user_id !== undefined && !(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, current.client_id))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers); const updates = allowedFields.filter((field) => typeof payload[field] === "string" || typeof payload[field] === "number").map((field) => ({ field, value: field === "address_kind" && payload[field] !== "consignee" ? "consignor" : payload[field] }));
        if (!updates.length) return error("VALIDATION_ERROR", "A supported update is required", 400, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `PATCH /v1/${entityUpdate[1]}/${entityUpdate[2]}`; const existing = await idempotentResponse(env, idempotencyKey, current.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const timestampClause = entityUpdate[1] === "wallet" ? "" : ", updated_at = CURRENT_TIMESTAMP";
        await env.DB.prepare(`UPDATE ${table} SET ${updates.map((update) => `${update.field} = ?`).join(", ")}${timestampClause} WHERE id = ?`).bind(...updates.map((update) => update.value), entityUpdate[2]).run();
        if (entityUpdate[1] === "wallet") await recalculateWalletBalances(env, current.client_id);
        await audit(env, ctx, auth, id, `${entityUpdate[1]}.updated`, entityUpdate[1], entityUpdate[2], { client_id: current.client_id, fields: updates.map((update) => update.field) });
        const serialized = JSON.stringify({ ok: true, data: { id: entityUpdate[2], ...Object.fromEntries(updates.map((update) => [update.field, update.value])) }, request_id: id }); await saveIdempotent(env, idempotencyKey, current.client_id, endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (entityUpdate && request.method === "DELETE" && (entityUpdate[1] === "warehouses" || entityUpdate[1] === "addresses") && hasScope(auth, "addresses.manage")) {
        const map: Record<string, string> = { warehouses: "warehouses", addresses: "client_addresses" }; const table = map[entityUpdate[1]];
        const current = await env.DB.prepare(`SELECT client_id FROM ${table} WHERE id = ? LIMIT 1`).bind(entityUpdate[2]).first<{ client_id: string }>();
        if (!current || !canAccessClient(auth, current.client_id)) return error("NOT_FOUND", "Record not found", 404, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const requestHash = await payloadFingerprint({ id: entityUpdate[2], deleted: true });
        const endpoint = `DELETE /v1/${entityUpdate[1]}/${entityUpdate[2]}`; const existing = await idempotentResponse(env, idempotencyKey, current.client_id, endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(entityUpdate[2]).run();
        await audit(env, ctx, auth, id, `${entityUpdate[1]}.deleted`, entityUpdate[1], entityUpdate[2], { client_id: current.client_id });
        const serialized = JSON.stringify({ ok: true, data: { id: entityUpdate[2], deleted: true }, request_id: id }); await saveIdempotent(env, idempotencyKey, current.client_id, endpoint, 200, serialized, requestHash);
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      if (route === "/rate-quotes" && request.method === "POST") {
        return error("LEGACY_PROVIDER_QUOTES_DISABLED", "Courier/provider rates are not exposed. Use the PSS Delhivery B2B pricing endpoint.", 410, id, headers);
      }
      if (route === "/pricing/quotes" && request.method === "POST") {
        if (!hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Quote scope required", 403, id, headers);
        const payload = await bodyJson(request);
        const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        // Client users never choose a courier account. The account is an
        // internal routing concern; all non-04/non-08 Delhivery accounts use
        // the shared Namo/other client matrix. Internal pricing previews may
        // still select 04 or 08 for verification.
        const internalPricingRequest = auth.system || hasRole(auth, ["employee", "admin", "super_admin"]);
        let selectedProviderAccountName = "";
        let accountValue = internalPricingRequest ? String(payload.account_code ?? "").trim().toLowerCase() : "other";
        if (typeof payload.provider_account_id === "string" && payload.provider_account_id.trim()) {
          await ensureDefaultClientProviderPolicies(env, clientId, auth.userId ?? `client:${clientId}`);
           const providerAccount = await env.DB.prepare(`SELECT pa.account_name FROM provider_accounts pa JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ? AND p.enabled = 1 WHERE pa.id = ? AND pa.provider = 'delhivery' AND pa.status = 'active' AND (pa.client_id = ? OR p.client_id = ?) LIMIT 1`).bind(clientId, payload.provider_account_id.trim(), clientId, clientId).first<{ account_name: string }>();
          if (!providerAccount) return error("PROVIDER_ACCOUNT_NOT_ASSIGNED", "This Delhivery account is not assigned to the client", 403, id, headers);
          selectedProviderAccountName = String(providerAccount.account_name ?? "");
          accountValue = delhiveryPricingAccountFromName(selectedProviderAccountName);
        }
        if (!accountValue) accountValue = "other";
        if (!["04", "08", "other"].includes(accountValue)) return error("VALIDATION_ERROR", "Delhivery B2B account must be 04, 08, or other", 400, id, headers);
        const rto = payload.rto === true;
        const rtoSourceId = typeof payload.rto_of_shipment_id === "string" ? payload.rto_of_shipment_id.trim() : typeof payload.original_shipment_id === "string" ? payload.original_shipment_id.trim() : "";
        const rtoSource = rto ? await env.DB.prepare("SELECT account_scope, origin_zone, destination_zone, chargeable_weight_kg, client_breakdown_json FROM pricing_shipment_snapshots WHERE shipment_id = ? AND client_id = ? LIMIT 1").bind(rtoSourceId, clientId).first<{ account_scope: PricingAccount; origin_zone: string; destination_zone: string; chargeable_weight_kg: number; client_breakdown_json: string }>() : null;
        if (rto && !rtoSourceId) return error("RTO_SOURCE_REQUIRED", "An original shipment is required to price an RTO", 409, id, headers);
        if (rto && !rtoSource) return error("RTO_SOURCE_NOT_FOUND", "The original shipment pricing snapshot could not be found", 409, id, headers);
        const account: PricingAccount = (rtoSource?.account_scope ?? accountValue) as PricingAccount;
        const originPincode = String(payload.origin_pincode ?? "").trim();
        const destinationPincode = String(payload.destination_pincode ?? "").trim();
        if (!/^\d{6}$/.test(originPincode) || !/^\d{6}$/.test(destinationPincode)) return error("VALIDATION_ERROR", "Pickup and delivery pincodes must be six digits", 400, id, headers);
        const actualWeightKg = Number(payload.actual_weight_kg);
        const volumetricWeightKg = payload.volumetric_weight_kg === undefined ? 0 : Number(payload.volumetric_weight_kg);
        const invoiceValue = payload.invoice_value === undefined ? 0 : Number(payload.invoice_value);
        const previewOnly = payload.preview_only === true;
        if (!Number.isFinite(actualWeightKg) || actualWeightKg <= 0 || !Number.isFinite(volumetricWeightKg) || volumetricWeightKg < 0 || !Number.isFinite(invoiceValue) || invoiceValue < 0) return error("VALIDATION_ERROR", "Valid weight and invoice values are required", 400, id, headers);
        const liveProviderAccountId = await resolveDelhiveryProviderAccountId(env, clientId, typeof payload.provider_account_id === "string" ? payload.provider_account_id : null);
        if (!liveProviderAccountId) return error("PROVIDER_ACCOUNT_REQUIRED", "An active Delhivery account is required for live serviceability verification", 409, id, headers);
        const paymentMode = String(payload.payment_mode ?? "prepaid").trim().toLowerCase() === "cod" ? "cod" : "prepaid";
        const liveServiceability = await verifyDelhiveryServiceability(env, originPincode, destinationPincode, liveProviderAccountId, id, clientId, paymentMode, actualWeightKg);
        if (!liveServiceability.ok) return error("PROVIDER_SERVICEABILITY_FAILED", liveServiceability.reason ?? "Delhivery could not verify this route", 409, id, headers, JSON.stringify({ provenance: liveServiceability.provenance, origin: liveServiceability.origin, destination: liveServiceability.destination }));
        const version = await env.DB.prepare("SELECT id, minimum_weight_kg, gst_percent FROM pricing_versions WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active' AND datetime(effective_at) <= CURRENT_TIMESTAMP ORDER BY datetime(effective_at) DESC LIMIT 1").bind(clientId).first<{ id: string; minimum_weight_kg: number; gst_percent: number }>();
        const activeVersion = version ?? await ensureDefaultClientPricing(env, clientId, auth.userId ?? `api:${clientId}`);
        if (!activeVersion) return error("PRICING_NOT_CONFIGURED", "A published Delhivery B2B PSS rate card is not configured for this client", 409, id, headers);
        const rules = await env.DB.prepare("SELECT code, label, calculation_type, value, basis, minimum_value, maximum_value, enabled, marker, condition, display_order FROM pricing_charge_rules WHERE version_id = ? ORDER BY display_order ASC, code ASC").bind(activeVersion.id).all<{ code: string; label: string; calculation_type: ChargeRule["kind"]; value: number; basis: ChargeRule["basis"]; minimum_value: number | null; maximum_value: number | null; enabled: number; marker: "*" | null; condition: "oda_or_opa" | null; display_order: number }>();
        const matrixRows = await env.DB.prepare("SELECT origin_zone, destination_zone, rate_per_kg FROM pricing_rate_matrix WHERE version_id = ? AND account_scope = ?").bind(activeVersion.id, account).all<{ origin_zone: string; destination_zone: string; rate_per_kg: number }>();
        const rateMatrix = Object.fromEntries(matrixRows.results.map((row) => [`${row.origin_zone}->${row.destination_zone}`, Number(row.rate_per_kg)]));
        // The pincode dataset remains pricing metadata only (zones/ODA/rates).
        // Live Delhivery serviceability above is the booking authority.
        const [originPin, destinationPin] = await Promise.all([pricingPincode(env, originPincode), pricingPincode(env, destinationPincode)]);
        const providerOrigin = liveServiceability.origin as Record<string, unknown>;
        const providerDestination = liveServiceability.destination as Record<string, unknown>;
        const originCity = originPin?.facility_city ?? String(providerOrigin.facility_city ?? providerOrigin.city ?? payload.origin_city ?? "").trim();
        const destinationCity = destinationPin?.facility_city ?? String(providerDestination.facility_city ?? providerDestination.city ?? payload.destination_city ?? "").trim();
        const originState = originPin?.facility_state ?? String(providerOrigin.facility_state ?? providerOrigin.state ?? payload.origin_state ?? "").trim();
        const destinationState = destinationPin?.facility_state ?? String(providerDestination.facility_state ?? providerDestination.state ?? payload.destination_state ?? "").trim();
        if (!originCity || !originState || !destinationCity || !destinationState) return error("LOCATION_METADATA_REQUIRED", "Delhivery verified the route, but city/state metadata is unavailable for PSS pricing. Enter the city and state and retry.", 409, id, headers);
        let forwardRatePerKg: number | undefined;
        if (rtoSource) {
          try {
            const originalBreakdown = JSON.parse(rtoSource.client_breakdown_json) as { lines?: Array<{ code?: string; amount?: number }> };
            const originalFreight = originalBreakdown.lines?.find((line) => line.code === "freight")?.amount;
            if (Number.isFinite(Number(originalFreight)) && Number(rtoSource.chargeable_weight_kg) > 0) forwardRatePerKg = Number(originalFreight) / Number(rtoSource.chargeable_weight_kg);
          } catch { return error("RTO_SOURCE_INVALID", "The original shipment pricing snapshot is invalid", 409, id, headers); }
          if (forwardRatePerKg === undefined) return error("RTO_SOURCE_INVALID", "The original shipment pricing snapshot is invalid", 409, id, headers);
        }
         const oda = Boolean(originPin?.oda || destinationPin?.oda || providerOrigin.oda === true || providerDestination.oda === true);
         const result = calculatePssRate({ account, originCity, destinationCity, originState, destinationState, actualWeightKg, volumetricWeightKg, invoiceValue, rto, forwardRatePerKg, forwardOriginZoneOverride: rtoSource?.origin_zone, forwardDestinationZoneOverride: rtoSource?.destination_zone, minimumWeightKg: Number(activeVersion.minimum_weight_kg ?? 20), gstPercent: Number(activeVersion.gst_percent ?? 18), versionId: activeVersion.id, oda, opa: false, rateMatrix, riskCharges: [], chargeRules: rules.results.map((rule) => ({ code: rule.code, label: rule.label, kind: rule.calculation_type, value: Number(rule.value), basis: rule.basis, minimum: rule.minimum_value === null ? undefined : Number(rule.minimum_value), maximum: rule.maximum_value === null ? undefined : Number(rule.maximum_value), enabled: Boolean(rule.enabled), marker: rule.marker ?? undefined, condition: rule.condition ?? undefined, displayOrder: Number(rule.display_order ?? 0) })) });
        const carrierRisk = payload.risk_type === "carrier";
        const riskFee = carrierRisk
          ? Math.max(80, Math.round(invoiceValue * 0.003 * 100) / 100)
          : Math.max(50, Math.round(invoiceValue * 0.001 * 100) / 100);
        result.lines.push({ code: carrierRisk ? "carrier_risk" : "owner_risk", label: carrierRisk ? "Carrier risk fee" : "Owner risk fee", amount: riskFee });
        result.total = Number(result.total) + riskFee;
        if (previewOnly) return json({ ok: true, data: { quote_id: null, provider: "delhivery", service_level: "b2b", client_id: clientId, provider_account_id: liveProviderAccountId, provider_account_name: selectedProviderAccountName || null, serviceability_provenance: liveServiceability.provenance, account_code: account, ...result } }, 200, headers);
        const quoteId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO pricing_quotes (id, client_id, version_id, account_scope, origin_zone, destination_zone, chargeable_weight_kg, client_breakdown_json, expires_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+15 minutes'), ?)").bind(quoteId, clientId, activeVersion.id, account, result.originZone, result.destinationZone, result.chargeableWeightKg, JSON.stringify(result), auth.userId ?? `api:${clientId}`).run();
        return json({ ok: true, data: { quote_id: quoteId, provider: "delhivery", service_level: "b2b", client_id: clientId, provider_account_id: liveProviderAccountId, serviceability_provenance: liveServiceability.provenance, ...result } }, 200, headers);
      }
      if (route === "/pricing/assigned" && request.method === "GET") {
        if (!hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Pricing view permission required", 403, id, headers);
        const clientId = requireClient(auth, null);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const version = await env.DB.prepare("SELECT id, status, effective_at, minimum_weight_kg, volumetric_divisor, gst_percent FROM pricing_versions WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active' AND datetime(effective_at) <= CURRENT_TIMESTAMP ORDER BY datetime(effective_at) DESC LIMIT 1").bind(clientId).first();
        const activeVersion = version ?? await ensureDefaultClientPricing(env, clientId, auth.userId ?? `client:${clientId}`);
        if (!activeVersion) return error("PRICING_NOT_CONFIGURED", "A published PSS rate card is not configured for this client", 409, id, headers);
        const [matrixRows, chargeRules] = await Promise.all([
          env.DB.prepare("SELECT origin_zone, destination_zone, rate_per_kg FROM pricing_rate_matrix WHERE version_id = ? AND account_scope = 'other' ORDER BY origin_zone, destination_zone").bind((activeVersion as Record<string, unknown>).id).all(),
          env.DB.prepare("SELECT code, label, calculation_type, value, basis, minimum_value, maximum_value, enabled, marker FROM pricing_charge_rules WHERE version_id = ? ORDER BY display_order, code").bind((activeVersion as Record<string, unknown>).id).all(),
        ]);
        return json({ ok: true, data: { version: activeVersion, rate_matrices: { other: matrixRows.results }, charge_rules: chargeRules.results } }, 200, headers);
      }
      if (route === "/pricing/versions" && request.method === "GET") {
        if (!hasScope(auth, "pricing.read")) return error("FORBIDDEN", "Pricing view permission required", 403, id, headers);
        const clientId = requireClient(auth, url.searchParams.get("client_id"));
        if (!clientId) return error("VALIDATION_ERROR", "A client is required", 400, id, headers);
        const rows = await env.DB.prepare("SELECT id, client_id, provider, service_level, status, effective_at, minimum_weight_kg, volumetric_divisor, gst_percent, source_rate_card_id, source_rate_card_ids_json, source_rate_card_object_path, source_rate_card_filename, source_rate_card_uploaded_at, created_by_user_id, published_by_user_id, created_at, updated_at FROM pricing_versions WHERE client_id = ? ORDER BY datetime(created_at) DESC LIMIT 100").bind(clientId).all();
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      const pincodeDatasetDetail = route.match(new RegExp("^/pricing/pincode-datasets/([^/]+)$"));
      const pincodeDatasetSource = route.match(new RegExp("^/pricing/pincode-datasets/([^/]+)/source$"));
      const pincodeDatasetChunks = route.match(new RegExp("^/pricing/pincode-datasets/([^/]+)/chunks$"));
      const pincodeDatasetPublish = route.match(new RegExp("^/pricing/pincode-datasets/([^/]+)/publish$"));
      if (route === "/pricing/pincode-datasets" && request.method === "GET") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.read")) return error("FORBIDDEN", "Pricing view permission required", 403, id, headers);
        const datasets = await env.DB.prepare("SELECT id, source_filename, source_object_key, source_sha256, expected_row_count, imported_row_count, status, error_message, uploaded_by_user_id, published_by_user_id, created_at, updated_at, published_at FROM delhivery_b2b_pincode_datasets ORDER BY created_at DESC LIMIT 50").all();
        const active = await env.DB.prepare("SELECT COUNT(*) AS row_count, COALESCE(SUM(oda), 0) AS oda_count FROM delhivery_b2b_pincode_zones").first<{ row_count: number; oda_count: number }>();
        return json({ ok: true, data: { datasets: datasets.results, active: { row_count: Number(active?.row_count ?? 0), oda_count: Number(active?.oda_count ?? 0) } } }, 200, headers);
      }
      if (route === "/pricing/pincode-datasets" && request.method === "POST") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.manage")) return error("FORBIDDEN", "Pricing management permission required", 403, id, headers);
        const payload = await bodyJson(request); const filename = String(payload.source_filename ?? "").trim(); const expected = Number(payload.expected_row_count); const sourceSha256 = String(payload.source_sha256 ?? "").trim();
        if (!filename || filename.length > 255 || !Number.isInteger(expected) || expected < 1 || expected > 1000000 || (sourceSha256 && !/^[a-f0-9]{64}$/i.test(sourceSha256))) return error("VALIDATION_ERROR", "A valid filename, row count, and optional SHA-256 checksum are required", 400, id, headers);
        const datasetId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO delhivery_b2b_pincode_datasets (id, source_filename, source_sha256, expected_row_count, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?)").bind(datasetId, filename, sourceSha256 || null, expected, auth.userId ?? "system").run();
        await audit(env, ctx, auth, id, "pricing.pincode_dataset_created", "pincode_dataset", datasetId, { source_filename: filename, expected_row_count: expected });
        return json({ ok: true, data: { id: datasetId, status: "staging", expected_row_count: expected } }, 201, headers);
      }
      if (pincodeDatasetSource && request.method === "PUT") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.manage")) return error("FORBIDDEN", "Pricing management permission required", 403, id, headers);
        const dataset = await env.DB.prepare("SELECT id, source_filename, status FROM delhivery_b2b_pincode_datasets WHERE id = ? LIMIT 1").bind(pincodeDatasetSource[1]).first<{ id: string; source_filename: string; status: string }>();
        if (!dataset || dataset.status !== "staging") return error("NOT_FOUND", "Staging pincode dataset not found", 404, id, headers);
        const contentType = request.headers.get("content-type") ?? "text/csv"; const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 25 * 1024 * 1024) return error("PAYLOAD_TOO_LARGE", "The source file must be 25 MB or smaller", 413, id, headers);
        const safeFilename = dataset.source_filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "source.csv"; const objectKey = `data-imports/delhivery-b2b-pincode/${dataset.id}/${safeFilename}`;
        await env.FILES.put(objectKey, request.body, { httpMetadata: { contentType }, customMetadata: { datasetId: dataset.id, uploadedBy: auth.userId ?? "system" } });
        await env.DB.prepare("UPDATE delhivery_b2b_pincode_datasets SET source_object_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(objectKey, dataset.id).run();
        return json({ ok: true, data: { id: dataset.id, source_object_key: objectKey } }, 200, headers);
      }
      if (pincodeDatasetChunks && request.method === "POST") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.manage")) return error("FORBIDDEN", "Pricing management permission required", 403, id, headers);
        const dataset = await env.DB.prepare("SELECT id, status FROM delhivery_b2b_pincode_datasets WHERE id = ? LIMIT 1").bind(pincodeDatasetChunks[1]).first<{ id: string; status: string }>();
        if (!dataset || dataset.status !== "staging") return error("NOT_FOUND", "Staging pincode dataset not found", 404, id, headers);
        const payload = await bodyJson(request, 768 * 1024); const rows = Array.isArray(payload.rows) ? payload.rows as Array<Record<string, unknown>> : [];
        if (!rows.length || rows.length > 500) return error("VALIDATION_ERROR", "Each import chunk must contain between 1 and 500 rows", 400, id, headers);
        const seen = new Set<string>(); const statements: D1PreparedStatement[] = [];
        for (const row of rows) {
          const pincode = String(row.pincode ?? "").trim(); const city = String(row.facility_city ?? "").trim(); const state = String(row.facility_state ?? "").trim(); const oda = row.oda === true || row.oda === 1 || String(row.oda).toLowerCase() === "true" || String(row.oda) === "1" ? 1 : 0;
          if (!/^\d{6}$/.test(pincode) || !city || city.length > 200 || !state || state.length > 120 || seen.has(pincode)) return error("VALIDATION_ERROR", "Every row needs a unique six-digit pincode, facility city, and facility state", 400, id, headers);
          seen.add(pincode); statements.push(env.DB.prepare("INSERT OR REPLACE INTO delhivery_b2b_pincode_dataset_rows (dataset_id, pincode, facility_city, facility_state, oda) VALUES (?, ?, ?, ?, ?)").bind(dataset.id, pincode, city, state, oda));
        }
        await env.DB.batch(statements);
        const count = await env.DB.prepare("SELECT COUNT(*) AS row_count FROM delhivery_b2b_pincode_dataset_rows WHERE dataset_id = ?").bind(dataset.id).first<{ row_count: number }>();
        await env.DB.prepare("UPDATE delhivery_b2b_pincode_datasets SET imported_row_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(Number(count?.row_count ?? 0), dataset.id).run();
        return json({ ok: true, data: { id: dataset.id, imported_row_count: Number(count?.row_count ?? 0) } }, 200, headers);
      }
      if (pincodeDatasetPublish && request.method === "POST") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.publish")) return error("FORBIDDEN", "Pricing publication permission required", 403, id, headers);
        const dataset = await env.DB.prepare("SELECT id, source_filename, source_object_key, expected_row_count, status FROM delhivery_b2b_pincode_datasets WHERE id = ? LIMIT 1").bind(pincodeDatasetPublish[1]).first<{ id: string; source_filename: string; source_object_key: string | null; expected_row_count: number; status: string }>();
        if (!dataset || dataset.status !== "staging" || !dataset.source_object_key) return error("CONFLICT", "The dataset must have an uploaded source file before publication", 409, id, headers);
        const count = await env.DB.prepare("SELECT COUNT(*) AS row_count, COUNT(DISTINCT pincode) AS distinct_count, COALESCE(SUM(CASE WHEN oda NOT IN (0, 1) THEN 1 ELSE 0 END), 0) AS invalid_oda FROM delhivery_b2b_pincode_dataset_rows WHERE dataset_id = ?").bind(dataset.id).first<{ row_count: number; distinct_count: number; invalid_oda: number }>();
        const rowCount = Number(count?.row_count ?? 0); const distinctCount = Number(count?.distinct_count ?? 0);
        if (rowCount !== Number(dataset.expected_row_count) || distinctCount !== rowCount || Number(count?.invalid_oda ?? 0) > 0) { await env.DB.prepare("UPDATE delhivery_b2b_pincode_datasets SET status = 'failed', imported_row_count = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(rowCount, `Validation failed: expected ${dataset.expected_row_count} unique rows, received ${rowCount}`, dataset.id).run(); return error("VALIDATION_FAILED", "The pincode dataset failed count or uniqueness validation", 409, id, headers); }
        await env.DB.batch([
          env.DB.prepare("UPDATE delhivery_b2b_pincode_datasets SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active'"),
          env.DB.prepare("DELETE FROM delhivery_b2b_pincode_zones"),
          env.DB.prepare("INSERT INTO delhivery_b2b_pincode_zones (pincode, facility_city, facility_state, oda, source_filename, updated_at) SELECT pincode, facility_city, facility_state, oda, ?, CURRENT_TIMESTAMP FROM delhivery_b2b_pincode_dataset_rows WHERE dataset_id = ?").bind(dataset.source_filename, dataset.id),
          env.DB.prepare("UPDATE delhivery_b2b_pincode_datasets SET status = 'active', published_by_user_id = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, imported_row_count = ? WHERE id = ?").bind(auth.userId ?? "system", rowCount, dataset.id),
        ]);
        await audit(env, ctx, auth, id, "pricing.pincode_dataset_published", "pincode_dataset", dataset.id, { source_filename: dataset.source_filename, row_count: rowCount });
        return json({ ok: true, data: { id: dataset.id, status: "active", row_count: rowCount } }, 200, headers);
      }
      const pricingVersionDetail = route.match(new RegExp("^/pricing/versions/([^/]+)$"));
      if (pricingVersionDetail && request.method === "GET") {
        if (!hasScope(auth, "pricing.read")) return error("FORBIDDEN", "Pricing view permission required", 403, id, headers);
        const version = await env.DB.prepare("SELECT id, client_id, provider, service_level, status, effective_at, minimum_weight_kg, volumetric_divisor, gst_percent, source_rate_card_id, source_rate_card_ids_json, source_rate_card_object_path, source_rate_card_filename, source_rate_card_uploaded_at, created_by_user_id, published_by_user_id, created_at, updated_at FROM pricing_versions WHERE id = ? AND provider = 'delhivery' AND service_level = 'b2b' LIMIT 1").bind(pricingVersionDetail[1]).first();
        if (!version || !canAccessClient(auth, String((version as Record<string, unknown>).client_id ?? ""))) return error("NOT_FOUND", "Pricing version not found", 404, id, headers);
        const [matrixRows, chargeRules] = await Promise.all([
          env.DB.prepare("SELECT account_scope, origin_zone, destination_zone, rate_per_kg FROM pricing_rate_matrix WHERE version_id = ? ORDER BY account_scope, origin_zone, destination_zone").bind(pricingVersionDetail[1]).all(),
          env.DB.prepare("SELECT code, label, calculation_type, value, basis, minimum_value, maximum_value, enabled, marker, condition, display_order FROM pricing_charge_rules WHERE version_id = ? ORDER BY display_order, code").bind(pricingVersionDetail[1]).all(),
        ]);
        const rate_matrices: Record<string, unknown[]> = { "04": [], "08": [], other: [] };
        for (const row of matrixRows.results as Array<Record<string, unknown>>) (rate_matrices[String(row.account_scope)] ??= []).push({ origin_zone: row.origin_zone, destination_zone: row.destination_zone, rate_per_kg: Number(row.rate_per_kg) });
        return json({ ok: true, data: { version, rate_matrices, charge_rules: chargeRules.results } }, 200, headers);
      }
      const pricingVersionPublish = route.match(new RegExp("^/pricing/versions/([^/]+)/publish$"));
      if (pricingVersionPublish && request.method === "POST") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.publish")) return error("FORBIDDEN", "Pricing publication permission required", 403, id, headers);
        const version = await env.DB.prepare("SELECT id, client_id, status FROM pricing_versions WHERE id = ? AND provider = 'delhivery' AND service_level = 'b2b' LIMIT 1").bind(pricingVersionPublish[1]).first<{ id: string; client_id: string; status: string }>();
        if (!version || !canAccessClient(auth, version.client_id)) return error("NOT_FOUND", "Pricing version not found", 404, id, headers);
        if (version.status === "active") return json({ ok: true, data: { id: version.id, client_id: version.client_id, status: "active" } }, 200, headers);
        if (version.status !== "draft") return error("CONFLICT", "Only a draft pricing version can be published", 409, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const requestHash = await payloadFingerprint(await bodyJson(request)); const endpoint = `POST /v1/pricing/versions/${version.id}/publish`; const existing = await idempotentResponse(env, idempotencyKey, auth.userId ?? "system", endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.batch([
          env.DB.prepare("UPDATE pricing_versions SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active'").bind(version.client_id),
          env.DB.prepare("UPDATE pricing_versions SET status = 'active', published_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(auth.userId ?? "system", version.id),
        ]);
        const serialized = JSON.stringify({ ok: true, data: { id: version.id, client_id: version.client_id, status: "active" }, request_id: id });
        await saveIdempotent(env, idempotencyKey, auth.userId ?? "system", endpoint, 200, serialized, requestHash);
        await audit(env, ctx, auth, id, "pricing.version_published", "pricing_version", version.id, { client_id: version.client_id });
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/pricing/default-matrices" && request.method === "GET") {
        if (!hasScope(auth, "pricing.read")) return error("FORBIDDEN", "Pricing view permission required", 403, id, headers);
        return json({ ok: true, data: { "04": defaultRateRows("04"), "08": defaultRateRows("08"), other: defaultRateRows("other") } }, 200, headers);
      }
      if (route === "/pricing/versions" && request.method === "POST") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "pricing.manage")) return error("FORBIDDEN", "Pricing management permission required", 403, id, headers);
        const payload = await bodyJson(request, 2 * 1024 * 1024); const clientId = requireClient(auth, payload.client_id);
        if (!clientId) return error("VALIDATION_ERROR", "A client is required", 400, id, headers);
        const legacySourceRateCardId = typeof payload.source_rate_card_id === "string" ? payload.source_rate_card_id.trim() : "";
        const suppliedSourceIds = payload.source_rate_card_ids && typeof payload.source_rate_card_ids === "object" ? payload.source_rate_card_ids as Record<string, unknown> : {};
        const sourceRateCardIds = Object.fromEntries(["04", "08", "other"].map((account) => [account, String(suppliedSourceIds[account] ?? (account === "other" ? legacySourceRateCardId : "")).trim()]).filter(([, value]) => Boolean(value)));
        if (["04", "08", "other"].some((account) => !sourceRateCardIds[account])) return error("VALIDATION_ERROR", "A source rate card is required for Delhivery accounts 04, 08, and other/Namo before publishing pricing", 400, id, headers);
        if (!auth.accessToken) return error("FORBIDDEN", "An authenticated Super Admin session is required to validate the source rate card", 403, id, headers);
        const sourceCardEntries = await Promise.all(["04", "08", "other"].map(async (account) => {
          const sourceId = sourceRateCardIds[account];
          const rows = await supabaseGet<{ id: string; account_code: string; object_path: string; original_filename: string; updated_at: string }>(env, `rate_cards?id=eq.${encodeURIComponent(sourceId)}&client_id=eq.${encodeURIComponent(clientId)}&account_code=eq.${encodeURIComponent(account)}&select=id,account_code,object_path,original_filename,updated_at`, auth.accessToken!);
          return [account, rows[0] ?? null] as const;
        }));
        if (sourceCardEntries.some(([, card]) => !card)) return error("NOT_FOUND", "Each selected source rate card must belong to this client and its mapped Delhivery account", 404, id, headers);
        const sourceCards = Object.fromEntries(sourceCardEntries) as Record<string, { id: string; account_code: string; object_path: string; original_filename: string; updated_at: string }>;
        const sourceRateCard = sourceCards.other;
        const rateMatrices = payload.rate_matrices && typeof payload.rate_matrices === "object" ? payload.rate_matrices as Record<string, unknown> : {};
        const chargeRules = Array.isArray(payload.charge_rules) ? payload.charge_rules : [];
        if (!chargeRules.length) return error("VALIDATION_ERROR", "At least one client pricing charge rule is required", 400, id, headers);
        const allowedBases = new Set(["freight", "freight_plus_docket", "invoice_value", "chargeable_weight", "subtotal"]);
        const ruleCodes = new Set<string>();
        for (const rule of chargeRules as Array<Record<string, unknown>>) {
          const code = String(rule.code ?? "").trim(); const kind = String(rule.calculation_type ?? rule.kind ?? "fixed"); const basis = String(rule.basis ?? "freight"); const value = Number(rule.value ?? 0); const minimum = rule.minimum === undefined ? null : Number(rule.minimum); const maximum = rule.maximum === undefined ? null : Number(rule.maximum);
          if (!code || ruleCodes.has(code) || !["fixed", "percent", "per_kg", "minimum", "maximum"].includes(kind) || !allowedBases.has(basis) || !Number.isFinite(value) || (minimum !== null && (!Number.isFinite(minimum) || minimum < 0)) || (maximum !== null && (!Number.isFinite(maximum) || maximum < 0))) return error("VALIDATION_ERROR", "Charge rules must have unique codes, supported types/bases, and finite values", 400, id, headers);
          ruleCodes.add(code);
        }
        const minimumWeight = Number(payload.minimum_weight_kg ?? 20); const volumetricDivisor = Number(payload.volumetric_divisor ?? 5000); const gstPercent = Number(payload.gst_percent ?? 18);
        if (!Number.isFinite(minimumWeight) || minimumWeight <= 0 || !Number.isFinite(volumetricDivisor) || volumetricDivisor <= 0 || !Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return error("VALIDATION_ERROR", "Minimum weight, volumetric divisor, and GST must be valid positive values", 400, id, headers);
        const requestedStatus = payload.status === "draft" ? "draft" : payload.status === undefined || payload.status === "active" ? "active" : "invalid";
        if (requestedStatus === "invalid") return error("VALIDATION_ERROR", "Pricing version status must be draft or active", 400, id, headers);
        const validAccounts = ["04", "08", "other"]; const versionId = crypto.randomUUID(); const now = new Date().toISOString();
        const statements = [ ...(requestedStatus === "active" ? [env.DB.prepare("UPDATE pricing_versions SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND provider = 'delhivery' AND service_level = 'b2b' AND status = 'active'").bind(clientId)] : []), env.DB.prepare("INSERT INTO pricing_versions (id, client_id, provider, service_level, status, effective_at, source_rate_card_id, source_rate_card_ids_json, source_rate_card_object_path, source_rate_card_filename, source_rate_card_uploaded_at, minimum_weight_kg, volumetric_divisor, gst_percent, created_by_user_id, published_by_user_id) VALUES (?, ?, 'delhivery', 'b2b', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(versionId, clientId, requestedStatus, now, sourceRateCardIds.other, JSON.stringify(sourceCards), sourceRateCard.object_path, sourceRateCard.original_filename, sourceRateCard.updated_at, minimumWeight, volumetricDivisor, gstPercent, auth.userId ?? "system", requestedStatus === "active" ? auth.userId ?? "system" : null)];
        for (const account of validAccounts) {
          const suppliedRows = Array.isArray(rateMatrices[account]) ? rateMatrices[account] as Array<Record<string, unknown>> : [];
          const rows = suppliedRows.length ? suppliedRows : defaultRateRows(account as PricingAccount).map((row) => ({ origin_zone: row.origin_zone, destination_zone: row.destination_zone, rate_per_kg: row.rate_per_kg }));
          const expectedRows = defaultRateRows(account as PricingAccount);
          if (rows.length !== expectedRows.length) return error("VALIDATION_ERROR", `The ${account} rate matrix must contain ${expectedRows.length} rows`, 400, id, headers);
          const expectedKeys = new Set(expectedRows.map((row) => `${row.origin_zone}->${row.destination_zone}`));
          const suppliedKeys = new Set<string>();
          for (const row of rows) {
            const origin = String(row.origin_zone ?? "").trim(); const destination = String(row.destination_zone ?? "").trim(); const rate = Number(row.rate_per_kg);
            if (!origin || !destination || !Number.isFinite(rate) || rate < 0) return error("VALIDATION_ERROR", "Every rate matrix row needs valid origin, destination, and per-kg rate", 400, id, headers);
            const key = `${origin}->${destination}`;
            if (!expectedKeys.has(key) || suppliedKeys.has(key)) return error("VALIDATION_ERROR", `The ${account} rate matrix contains an invalid or duplicate lane`, 400, id, headers);
            suppliedKeys.add(key);
            statements.push(env.DB.prepare("INSERT INTO pricing_rate_matrix (id, version_id, account_scope, origin_zone, destination_zone, rate_per_kg) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), versionId, account, origin, destination, rate));
          }
        }
        for (const rule of chargeRules as Array<Record<string, unknown>>) {
          const code = String(rule.code ?? "").trim(); const label = String(rule.label ?? code).trim(); const kind = String(rule.calculation_type ?? rule.kind ?? "fixed"); const value = Number(rule.value ?? 0);
          if (!code || !label || !["fixed", "percent", "per_kg", "minimum", "maximum"].includes(kind) || !Number.isFinite(value)) return error("VALIDATION_ERROR", "Every charge rule needs a valid code, label, type, and value", 400, id, headers);
          const condition = rule.condition === "oda_or_opa" || rule.condition === "rto" ? rule.condition : null;
          statements.push(env.DB.prepare("INSERT INTO pricing_charge_rules (id, version_id, code, label, calculation_type, value, basis, minimum_value, maximum_value, enabled, marker, condition, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), versionId, code, label, kind, value, String(rule.basis ?? "freight"), rule.minimum === undefined ? null : Number(rule.minimum), rule.maximum === undefined ? null : Number(rule.maximum), rule.enabled === false ? 0 : 1, rule.marker === "*" ? "*" : null, condition, Number(rule.display_order ?? 0)));
        }
        await env.DB.batch(statements);
        await audit(env, ctx, auth, id, requestedStatus === "active" ? "pricing.version_published" : "pricing.version_drafted", "pricing_version", versionId, { client_id: clientId, account_scopes: validAccounts, charge_rule_count: chargeRules.length });
        return json({ ok: true, data: { id: versionId, client_id: clientId, provider: "delhivery", service_level: "b2b", status: requestedStatus, effective_at: now } }, 201, headers);
      }
      if (route === "/pricing/overrides" && request.method === "POST") {
        if (!hasRole(auth, ["admin", "super_admin"]) || !hasScope(auth, "pricing.override")) return error("FORBIDDEN", "Pricing override permission required", 403, id, headers);
        const payload = await bodyJson(request); const shipmentId = typeof payload.shipment_id === "string" ? payload.shipment_id.trim() : ""; const component = typeof payload.component_code === "string" ? payload.component_code.trim() : ""; const reason = typeof payload.reason === "string" ? payload.reason.trim() : ""; const nextAmount = Number(payload.new_amount);
        if (!shipmentId || !component || !reason || !Number.isFinite(nextAmount) || nextAmount < 0) return error("VALIDATION_ERROR", "Shipment, component, non-negative amount, and reason are required", 400, id, headers);
        const snapshot = await env.DB.prepare("SELECT id, client_id, client_breakdown_json FROM pricing_shipment_snapshots WHERE shipment_id = ? LIMIT 1").bind(shipmentId).first<{ id: string; client_id: string; client_breakdown_json: string }>();
        if (!snapshot || !canAccessClient(auth, snapshot.client_id)) return error("NOT_FOUND", "Pricing snapshot not found", 404, id, headers);
        const billing = await env.DB.prepare("SELECT id, amount FROM billing_records WHERE shipment_id = ? AND client_id = ? ORDER BY created_at ASC LIMIT 1").bind(shipmentId, snapshot.client_id).first<{ id: string; amount: number }>();
        if (!billing) return error("NOT_FOUND", "Invoice not found", 404, id, headers);
        let breakdown: { lines?: Array<{ code: string; label: string; amount: number; marker?: "*" }>; total?: number; subtotal?: number; gst?: number };
        try { breakdown = JSON.parse(snapshot.client_breakdown_json) as typeof breakdown; } catch { return error("CONFLICT", "Pricing snapshot is invalid", 409, id, headers); }
        const line = breakdown.lines?.find((item) => item.code === component); if (!line) return error("NOT_FOUND", "Pricing component not found", 404, id, headers);
        const previous = Number(line.amount);
        const previousTotal = Number(breakdown.total ?? billing.amount);
        const delta = Math.round((nextAmount - previous) * 100) / 100;
        line.amount = Math.round(nextAmount * 100) / 100;
        const previousSubtotal = Number(breakdown.subtotal ?? 0);
        if (component === "gst") {
          breakdown.gst = line.amount;
        } else {
          breakdown.subtotal = Math.round((previousSubtotal + delta) * 100) / 100;
          const gstLine = breakdown.lines?.find((item) => item.code === "gst");
          const previousGst = Number(breakdown.gst ?? gstLine?.amount ?? 0);
          const gstPercent = previousSubtotal > 0 ? previousGst / previousSubtotal * 100 : 0;
          breakdown.gst = Math.round((Number(breakdown.subtotal) * gstPercent / 100 + Number.EPSILON) * 100) / 100;
          if (gstLine) {
            gstLine.amount = breakdown.gst;
          }
        }
        breakdown.total = Math.round((Number(breakdown.subtotal ?? previousSubtotal) + Number(breakdown.gst ?? 0)) * 100) / 100;
        const totalDelta = Math.round((Number(breakdown.total) - previousTotal) * 100) / 100;
        if (totalDelta > 0) {
          const wallet = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN lower(COALESCE(type, '')) IN ('debit', 'charge', 'withdrawal') THEN -ABS(amount) ELSE ABS(amount) END), 0) AS balance FROM wallet_transactions WHERE client_id = ? AND status IN ('posted', 'approved')").bind(snapshot.client_id).first<{ balance: number }>();
          if (Number(wallet?.balance ?? 0) < totalDelta) return error("INSUFFICIENT_WALLET_BALANCE", "The client wallet does not have enough balance for this pricing increase", 409, id, headers);
        }
        const overrideId = crypto.randomUUID(); const actor = auth.userId ?? `api:${snapshot.client_id}`;
        const walletAdjustment = totalDelta > 0 ? env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, 'debit', ?, ?, 'posted', 0)").bind(crypto.randomUUID(), snapshot.client_id, totalDelta, `PRICING-OVERRIDE-${overrideId}`) : totalDelta < 0 ? env.DB.prepare("INSERT INTO wallet_transactions (id, client_id, type, amount, reference, status, balance_after) VALUES (?, ?, 'credit', ?, ?, 'posted', 0)").bind(crypto.randomUUID(), snapshot.client_id, Math.abs(totalDelta), `PRICING-OVERRIDE-${overrideId}`) : null;
        await env.DB.batch([
          env.DB.prepare("UPDATE pricing_shipment_snapshots SET client_breakdown_json = ? WHERE id = ?").bind(JSON.stringify(breakdown), snapshot.id),
          env.DB.prepare("UPDATE billing_records SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(breakdown.total, billing.id),
          env.DB.prepare("DELETE FROM billing_line_items WHERE billing_id = ?").bind(billing.id),
          ...billingLineItemStatements(env, billing.id, shipmentId, snapshot.client_id, JSON.stringify(breakdown)),
          env.DB.prepare("INSERT INTO pricing_overrides (id, shipment_id, client_id, billing_id, component_code, previous_amount, new_amount, reason, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(overrideId, shipmentId, snapshot.client_id, billing.id, component, previous, line.amount, reason, actor),
          env.DB.prepare("INSERT INTO billing_amendments (id, billing_id, shipment_id, client_id, amendment_type, previous_amount, new_amount, reason, actor_user_id) VALUES (?, ?, ?, ?, 'component_override', ?, ?, ?, ?)").bind(crypto.randomUUID(), billing.id, shipmentId, snapshot.client_id, Number(billing.amount), Number(breakdown.total), reason, actor),
          ...(walletAdjustment ? [walletAdjustment] : []),
        ]);
        if (walletAdjustment) await recalculateWalletBalances(env, snapshot.client_id);
        await audit(env, ctx, auth, id, "pricing.override_applied", "pricing_snapshot", snapshot.id, { client_id: snapshot.client_id, shipment_id: shipmentId, component_code: component, previous_amount: previous, new_amount: line.amount, reason });
        return json({ ok: true, data: { id: overrideId, shipment_id: shipmentId, component_code: component, amount: line.amount, total: breakdown.total, reason } }, 200, headers);
      }
      if (route === "/pricing/internal/margins" && request.method === "GET") {
        if (!hasRole(auth, ["super_admin"]) || !hasScope(auth, "provider_cost.view")) return error("FORBIDDEN", "Internal pricing access required", 403, id, headers);
        const requestedClientId = url.searchParams.get("client_id")?.trim() || null;
        const clientId = requestedClientId ? requireClient(auth, requestedClientId) : null;
        if (requestedClientId && !clientId) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200) || 200, 1), 10000);
        const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
        const syncProvider = url.searchParams.get("sync_provider") === "1";
        const where = clientId ? "WHERE b.client_id = ?" : "";
        const bindings = clientId ? [clientId, limit, offset] : [limit, offset];
        const [count, pendingRows] = await Promise.all([
          env.DB.prepare(`SELECT COUNT(*) AS total FROM billing_records b ${where}`).bind(...(clientId ? [clientId] : [])).first<{ total: number }>(),
          env.DB.prepare(`SELECT b.shipment_id, b.client_id, s.provider, s.provider_account_id, s.provider_booking_id, s.tracking_number, s.lr_number, s.master_awb, s.provider_reference, c.provider_amount FROM billing_records b LEFT JOIN shipments s ON s.id = b.shipment_id LEFT JOIN pricing_provider_costs c ON c.shipment_id = b.shipment_id ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`).bind(...bindings).all<Record<string, unknown>>(),
        ]);
        if (syncProvider) {
          const candidates = pendingRows.results.filter((row) => String(row.provider ?? "").toLowerCase() === "delhivery" && row.provider_amount == null && String(row.client_id ?? "").trim()).slice(0, 50);
          await Promise.all(candidates.map(async (row) => {
            const shipmentId = String(row.shipment_id ?? "").trim();
            const accountId = String(row.provider_account_id ?? "").trim() || undefined;
            const lrOrAwb = String(row.lr_number ?? "").trim();
            const bookingId = String(row.provider_booking_id ?? "").trim();
            if (!shipmentId || (!lrOrAwb && !bookingId)) return;
            if (!lrOrAwb) return;
            await safeProviderRequest(env, "delhivery", "freight_charges", { shipment_id: shipmentId, tracking_number: lrOrAwb, lr_number: String(row.lr_number ?? "").trim() || lrOrAwb, provider_reference: String(row.provider_reference ?? "").trim() || undefined, provider_booking_id: bookingId || undefined, provider_account_id: accountId }, id, String(row.client_id), undefined, 10000).catch(() => undefined);
          }));
        }
        const rows = await env.DB.prepare(
          `SELECT b.id AS billing_id, b.shipment_id, b.client_id, s.lr_number, s.master_awb, b.invoice_number, b.amount AS pss_amount, b.created_at, c.provider, c.provider_account_id, c.provider_amount, c.provider_status, CASE WHEN c.provider_amount IS NULL THEN NULL ELSE b.amount - c.provider_amount END AS margin FROM billing_records b LEFT JOIN shipments s ON s.id = b.shipment_id LEFT JOIN pricing_provider_costs c ON c.shipment_id = b.shipment_id ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
        ).bind(...bindings).all();
        return json({ ok: true, data: rows.results, pagination: { total: Number(count?.total ?? 0), limit, offset, has_more: offset + rows.results.length < Number(count?.total ?? 0) } }, 200, headers);
      }
      if (route === "/serviceability" && request.method === "POST") {
        if (!hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Serviceability scope required", 403, id, headers);
        const payload = await bodyJson(request); const origin = String(payload.origin_pincode ?? ""); const destination = String(payload.destination_pincode ?? "");
        if (!/^\d{6}$/.test(origin) || !/^\d{6}$/.test(destination)) return error("VALIDATION_ERROR", "Valid origin and destination pincodes are required", 400, id, headers);
        const serviceabilityClientId = requireClient(auth, payload.client_id) ?? auth.clientId;
        const providerAccounts = serviceabilityClientId
          ? await env.DB.prepare(`
              SELECT pa.id, pa.provider, pa.account_name,
                     CASE WHEN p.provider_account_id IS NULL THEN 1 ELSE p.enabled END AS enabled,
                     CASE WHEN p.provider_account_id IS NULL THEN 100 ELSE p.priority END AS priority,
                     CASE WHEN p.provider_account_id IS NULL THEN 0 ELSE p.confidence_score END AS confidence_score
              FROM provider_accounts pa
              LEFT JOIN provider_account_client_policies p
                ON p.provider_account_id = pa.id AND p.client_id = ?
              WHERE pa.status = 'active'
                AND (pa.client_id = ? OR pa.client_id IS NULL)
                AND p.provider_account_id IS NOT NULL AND p.enabled = 1
              ORDER BY pa.provider, priority ASC, confidence_score DESC, pa.account_name ASC
              LIMIT 100`).bind(serviceabilityClientId, serviceabilityClientId).all<{
                id: string; provider: CourierProvider; account_name: string; enabled: number; priority: number; confidence_score: number;
              }>()
          : { results: [] as Array<{ id: string; provider: CourierProvider; account_name: string; enabled: number; priority: number; confidence_score: number }> };
         const accountRows = providerAccounts.results.filter((account) => Number(account.enabled) === 1);
        const configuredProviders = [...new Set(accountRows.map((account) => account.provider))];
        const providerLabel = (provider: CourierProvider) => provider === "delhivery" ? "Delhivery" : provider === "xpressbees" ? "XpressBees" : provider[0].toUpperCase() + provider.slice(1);
        const supportedProviders = new Set<CourierProvider>(["delhivery", "rivigo", "xpressbees"]);
        const serviceabilityRows: Array<{ pincode: string; provider: string; status: string; oda: boolean | null; prepaid?: boolean; cod?: boolean; account_id: string; account_name: string; confidence_score: number; priority: number; source?: string; reason?: string }> = [];
        const routeResults: Array<{ provider: CourierProvider; accountId: string; accountName: string; confidenceScore: number; priority: number; origin: Record<string, unknown>; destination: Record<string, unknown>; routeServiceable: boolean }> = [];
        for (const account of accountRows) {
          const label = `${providerLabel(account.provider)} · ${account.account_name}`;
          if (!supportedProviders.has(account.provider)) {
            serviceabilityRows.push(
              { pincode: origin, provider: label, status: "Serviceability not supported", oda: null, account_id: account.id, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100) },
              { pincode: destination, provider: label, status: "Serviceability not supported", oda: null, account_id: account.id, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100) },
            );
            continue;
          }
          try {
            const liveVerification = account.provider === "delhivery"
              ? await verifyDelhiveryServiceability(env, origin, destination, account.id, id, serviceabilityClientId ?? "")
              : null;
            const [originResult, destinationResult] = liveVerification
              ? [liveVerification.origin, liveVerification.destination]
              : [await safeProviderRequest(env, account.provider, "serviceability", { origin_pincode: origin, destination_pincode: destination, provider_account_id: account.id }, id, serviceabilityClientId), null];
            const originRecord = originResult as Record<string, unknown>;
            const destinationRecord = (destinationResult ?? originResult) as Record<string, unknown>;
            const routeServiceableForAccount = account.provider === "delhivery" && liveVerification ? liveVerification.ok : null;
            const originServiceable = routeServiceableForAccount !== null
              ? routeServiceableForAccount
              : account.provider === "delhivery"
                ? originResult.status === "accepted" && Boolean((originResult as { pickup?: boolean; serviceable?: boolean }).pickup ?? (originResult as { serviceable?: boolean }).serviceable)
              : originResult.status === "accepted" && Boolean((originResult as { serviceable?: boolean }).serviceable);
            const destinationServiceable = routeServiceableForAccount !== null
              ? routeServiceableForAccount
              : account.provider === "delhivery"
                ? destinationResult?.status === "accepted" && Boolean((destinationResult as { serviceable?: boolean }).serviceable)
              : originServiceable;
            const accountStatus = originResult.status === "accepted" && destinationRecord.status === "accepted"
              ? originServiceable && destinationServiceable ? "Available" : "Unavailable"
              : originResult.status === "not_configured" || destinationRecord.status === "not_configured" ? "Not configured" : "Provider error";
            const accountReason = accountStatus === "Available"
              ? undefined
              : String((!originServiceable ? originResult.error ?? originResult.reason : !destinationServiceable ? destinationRecord.error ?? destinationRecord.reason : originResult.error ?? destinationRecord.error ?? originResult.reason ?? destinationRecord.reason) ?? (accountStatus === "Unavailable" ? "Delhivery does not currently support this route for the selected account" : "Delhivery could not verify this route")).slice(0, 300);
            const originOda = account.provider === "delhivery" ? (originResult as { oda?: boolean | null }).oda ?? null : (originResult as { origin_oda?: boolean | null }).origin_oda ?? null;
            const destinationOda = account.provider === "delhivery" ? (destinationResult as { oda?: boolean | null } | null)?.oda ?? null : (originResult as { destination_oda?: boolean | null }).destination_oda ?? null;
            serviceabilityRows.push(
              { pincode: origin, provider: label, status: accountStatus, oda: originOda, prepaid: (originResult as { prepaid?: boolean }).prepaid, cod: (originResult as { cod?: boolean }).cod, account_id: account.id, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100), source: liveVerification?.provenance, reason: accountReason },
              { pincode: destination, provider: label, status: accountStatus, oda: destinationOda, prepaid: (destinationRecord as { prepaid?: boolean }).prepaid, cod: (destinationRecord as { cod?: boolean }).cod, account_id: account.id, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100), source: liveVerification?.provenance, reason: accountReason },
            );
            routeResults.push({ provider: account.provider, accountId: account.id, accountName: account.account_name, confidenceScore: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100), origin: originRecord, destination: destinationRecord, routeServiceable: routeServiceableForAccount ?? (originServiceable && destinationServiceable) });
          } catch (caught) {
            const providerError = caught instanceof Error ? caught.message : "provider_request_failed";
            console.error(JSON.stringify({ request_id: id, route: "/v1/serviceability", provider: account.provider, account_id: account.id, error: providerError }));
            serviceabilityRows.push(
              { pincode: origin, provider: label, status: "Provider error", oda: null, account_id: account.id, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100), reason: providerError },
              { pincode: destination, provider: label, status: "Provider error", oda: null, account_id: account.id, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100), reason: providerError },
            );
          }
        }
        const routeServiceable = routeResults.some((result) => result.routeServiceable);
        const delhiveryRouteResults = routeResults.filter((result) => result.provider === "delhivery" && result.routeServiceable);
        const modeAvailability = (mode: "prepaid" | "cod") => {
          const values = delhiveryRouteResults.map((result) => (result.destination as { prepaid?: boolean; cod?: boolean })[mode]);
          if (values.some((value) => value === true)) return true;
          if (values.some((value) => value === false)) return false;
          return undefined;
        };
        const paymentModes = { prepaid: modeAvailability("prepaid"), cod: modeAvailability("cod") };
        const acceptedResult = routeResults.some((result) => result.origin.status === "accepted" && result.destination.status === "accepted");
        const failedResult = serviceabilityRows.some((row) => row.status === "Provider error" || row.status === "Not configured");
        const providerStatus = routeServiceable || acceptedResult ? "verified" : failedResult ? "provider_error" : configuredProviders.length ? "provider_contract_not_verified" : "provider_unavailable";
        const serviceabilityProvenance = serviceabilityRows.find((row) => row.source)?.source;
        const availabilityStatus = routeServiceable
          ? serviceabilityProvenance === "cached_provider" ? "cached_provider" : serviceabilityRows.some((row) => row.source === "Delhivery pincode dataset") ? "dataset_verified" : "serviceable"
          : failedResult ? "provider_error" : acceptedResult ? "not_serviceable" : "provider_unavailable";
        return json({ ok: true, data: {
          client_id: serviceabilityClientId,
          origin_pincode: origin,
          destination_pincode: destination,
          serviceable: routeServiceable,
          providers: [...new Set(routeResults.filter((result) => result.routeServiceable).map((result) => result.provider))],
          configured_providers: configuredProviders,
          assigned_accounts: accountRows.map((account) => ({ id: account.id, provider: account.provider, account_name: account.account_name, confidence_score: Number(account.confidence_score ?? 0), priority: Number(account.priority ?? 100) })),
          status: providerStatus,
          availability_status: availabilityStatus,
          serviceability_provenance: serviceabilityProvenance ?? (failedResult ? "provider_unavailable" : undefined),
          payment_modes: paymentModes,
          serviceability_rows: serviceabilityRows,
          provider_results: routeResults,
        } }, 200, headers);
      }
      if (route === "/departments" && request.method === "GET") {
        if (!hasScope(auth, "departments.read")) return error("FORBIDDEN", "Department read scope required", 403, id, headers);
        const rows = await env.DB.prepare("SELECT id, name, manager_user_id, capacity_percent, status, created_by_user_id, created_at, updated_at FROM departments ORDER BY name ASC LIMIT 200").all();
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      if (route === "/departments" && request.method === "POST") {
        if (!hasScope(auth, "departments.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Department management permission required", 403, id, headers);
        const payload = await bodyJson(request); const name = typeof payload.name === "string" ? payload.name.trim() : "";
        const capacity = payload.capacity_percent === undefined ? 100 : Number(payload.capacity_percent);
        const manager = payload.manager_user_id === null || payload.manager_user_id === undefined || payload.manager_user_id === "" ? null : String(payload.manager_user_id).trim();
        const status = payload.status === undefined ? "active" : String(payload.status).trim().toLowerCase();
        if (!name || name.length > 120) return error("VALIDATION_ERROR", "Department name is required and must be at most 120 characters", 400, id, headers);
        if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100) return error("VALIDATION_ERROR", "Department capacity must be an integer from 0 to 100", 400, id, headers);
        if (!new Set(["active", "disabled"]).has(status)) return error("VALIDATION_ERROR", "Department status must be active or disabled", 400, id, headers);
        if (manager) {
          if (!auth.accessToken) return error("FORBIDDEN", "A user session is required to validate the manager", 403, id, headers);
          const managerRows = await supabaseGet<{ user_id: string }>(env, `employee_profiles?user_id=eq.${encodeURIComponent(manager)}&employment_status=eq.active&select=user_id`, auth.accessToken);
          if (!managerRows.length) return error("VALIDATION_ERROR", "Manager must be an active employee", 400, id, headers);
        }
        const existingName = await env.DB.prepare("SELECT id FROM departments WHERE lower(name) = lower(?) LIMIT 1").bind(name).first<{ id: string }>();
        if (existingName) return error("CONFLICT", "A department with this name already exists", 409, id, headers);
        const requestHash = await payloadFingerprint(payload); const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, auth.userId ?? "system", "POST /v1/departments", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const departmentId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO departments (id, name, manager_user_id, capacity_percent, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)").bind(departmentId, name, manager, capacity, status, auth.userId ?? "system").run();
        const serialized = JSON.stringify({ ok: true, data: { id: departmentId, name, manager_user_id: manager, capacity_percent: capacity, status }, request_id: id });
        await saveIdempotent(env, key, auth.userId ?? "system", "POST /v1/departments", 201, serialized, requestHash); await audit(env, ctx, auth, id, "department.created", "department", departmentId, { name, manager_user_id: manager });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      const departmentMatch = route.match(/^\/departments\/([^/]+)$/);
      if (departmentMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        if (!hasScope(auth, "departments.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Department management permission required", 403, id, headers);
        const department = await env.DB.prepare("SELECT id, name, manager_user_id, capacity_percent, status FROM departments WHERE id = ? LIMIT 1").bind(departmentMatch[1]).first<{ id: string; name: string; manager_user_id: string | null; capacity_percent: number; status: string }>();
        if (!department) return error("NOT_FOUND", "Department not found", 404, id, headers);
        const payload = request.method === "DELETE" ? { status: "disabled" } : await bodyJson(request);
        const updates: Array<{ field: string; value: string | number | null }> = [];
        if (payload.name !== undefined) { if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 120) return error("VALIDATION_ERROR", "Department name is invalid", 400, id, headers); updates.push({ field: "name", value: payload.name.trim() }); }
        if (payload.capacity_percent !== undefined) { const capacity = Number(payload.capacity_percent); if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100) return error("VALIDATION_ERROR", "Department capacity must be an integer from 0 to 100", 400, id, headers); updates.push({ field: "capacity_percent", value: capacity }); }
        if (payload.status !== undefined) { const status = String(payload.status).trim().toLowerCase(); if (!["active", "disabled"].includes(status)) return error("VALIDATION_ERROR", "Department status must be active or disabled", 400, id, headers); updates.push({ field: "status", value: status }); }
        if (payload.manager_user_id !== undefined) {
          const manager = payload.manager_user_id === null || payload.manager_user_id === "" ? null : String(payload.manager_user_id).trim();
          if (manager) { if (!auth.accessToken) return error("FORBIDDEN", "A user session is required to validate the manager", 403, id, headers); const managerRows = await supabaseGet<{ user_id: string }>(env, `employee_profiles?user_id=eq.${encodeURIComponent(manager)}&employment_status=eq.active&select=user_id`, auth.accessToken); if (!managerRows.length) return error("VALIDATION_ERROR", "Manager must be an active employee", 400, id, headers); }
          updates.push({ field: "manager_user_id", value: manager });
        }
        if (!updates.length) return error("VALIDATION_ERROR", "A department update is required", 400, id, headers);
        const requestHash = await payloadFingerprint(payload); const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `PATCH /v1/departments/${department.id}`; const existing = await idempotentResponse(env, key, auth.userId ?? "system", endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare(`UPDATE departments SET ${updates.map((update) => `${update.field} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...updates.map((update) => update.value), department.id).run();
        const changed = Object.fromEntries(updates.map((update) => [update.field, update.value])); const serialized = JSON.stringify({ ok: true, data: { id: department.id, ...changed }, request_id: id });
        await saveIdempotent(env, key, auth.userId ?? "system", endpoint, 200, serialized, requestHash); await audit(env, ctx, auth, id, "department.updated", "department", department.id, { fields: updates.map((update) => update.field) });
        return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/tasks" && request.method === "GET") {
        if (!hasScope(auth, "tasks.read")) return error("FORBIDDEN", "Task read scope required", 403, id, headers);
        const rows = auth.system ? await env.DB.prepare("SELECT * FROM tasks ORDER BY due_at ASC LIMIT 100").all() : auth.clientIds.size ? await env.DB.prepare(`SELECT * FROM tasks WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR assigned_to_user_id = ? ORDER BY due_at ASC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "").all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      if (route === "/tasks" && request.method === "POST") {
        if (!hasScope(auth, "tasks.manage")) return error("FORBIDDEN", "Task management scope required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
        if (!auth.system && !clientId) return error("FORBIDDEN", "Client scope is required", 403, id, headers);
        if (clientId && !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        if (payload.shipment_id !== undefined) {
          const shipment = await env.DB.prepare("SELECT client_id FROM shipments WHERE id = ? LIMIT 1").bind(String(payload.shipment_id)).first<{ client_id: string }>();
          if (!shipment || !auth.system && (!clientId || shipment.client_id !== clientId)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        }
        if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.trim().length > 200) return error("VALIDATION_ERROR", "Task title is required and must be at most 200 characters", 400, id, headers);
        if (payload.description !== undefined && (typeof payload.description !== "string" || payload.description.length > 2000)) return error("VALIDATION_ERROR", "Task description must be at most 2,000 characters", 400, id, headers);
        const priority = String(payload.priority ?? "medium").trim().toLowerCase();
        if (!taskPriorities.has(priority)) return error("VALIDATION_ERROR", "Unsupported task priority", 400, id, headers);
        if (payload.due_at !== undefined && payload.due_at !== null && (typeof payload.due_at !== "string" || Number.isNaN(Date.parse(payload.due_at)))) return error("VALIDATION_ERROR", "Task due_at must be a valid date", 400, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const scopeKey = clientId ?? auth.userId ?? "system"; const existing = await idempotentResponse(env, key, scopeKey, "POST /v1/tasks", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        if (!(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, clientId ?? "system"))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers);
        const taskId = crypto.randomUUID(); await env.DB.prepare("INSERT INTO tasks (id, client_id, shipment_id, title, description, priority, status, assigned_to_user_id, due_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)").bind(taskId, clientId, typeof payload.shipment_id === "string" ? payload.shipment_id : null, payload.title.trim(), String(payload.description ?? ""), priority, typeof payload.assigned_to_user_id === "string" ? payload.assigned_to_user_id : auth.userId, typeof payload.due_at === "string" ? payload.due_at : null, auth.userId ?? `api:${clientId ?? "system"}`).run();
        const serialized = JSON.stringify({ ok: true, data: { id: taskId }, request_id: id }); await saveIdempotent(env, key, scopeKey, "POST /v1/tasks", 201, serialized, requestHash);
        await audit(env, ctx, auth, id, "task.created", "task", taskId, { client_id: clientId }); return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      const taskMatch = route.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch && request.method === "PATCH") {
        if (!hasScope(auth, "tasks.manage")) return error("FORBIDDEN", "Task management scope required", 403, id, headers);
        const task = await env.DB.prepare("SELECT client_id FROM tasks WHERE id = ? LIMIT 1").bind(taskMatch[1]).first<{ client_id: string | null }>(); if (!task || (task.client_id && !canAccessClient(auth, task.client_id))) return error("NOT_FOUND", "Task not found", 404, id, headers);
        const payload = await bodyJson(request);
        const requestHash = await payloadFingerprint(payload);
        const targetClientId = payload.client_id === undefined ? task.client_id : typeof payload.client_id === "string" ? payload.client_id.trim() : undefined;
        if (targetClientId === undefined || (targetClientId !== null && (!targetClientId || !canAccessClient(auth, targetClientId)))) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const taskUpdates: Array<{ field: string; value: string }> = [];
        if (payload.client_id !== undefined) taskUpdates.push({ field: "client_id", value: targetClientId ?? "" });
        if (payload.status !== undefined) {
          if (typeof payload.status !== "string" || !taskStatuses.has(payload.status.trim().toLowerCase())) return error("VALIDATION_ERROR", "Task status must be pending, in_progress, completed, or cancelled", 400, id, headers);
          taskUpdates.push({ field: "status", value: payload.status.trim().toLowerCase() });
        }
        if (payload.title !== undefined) {
          if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.trim().length > 240) return error("VALIDATION_ERROR", "Task title is required and must be at most 240 characters", 400, id, headers);
          taskUpdates.push({ field: "title", value: payload.title.trim() });
        }
        if (payload.description !== undefined) {
          if (typeof payload.description !== "string" || payload.description.length > 2000) return error("VALIDATION_ERROR", "Task description must be at most 2,000 characters", 400, id, headers);
          taskUpdates.push({ field: "description", value: payload.description });
        }
        if (payload.priority !== undefined) {
          if (typeof payload.priority !== "string" || !taskPriorities.has(payload.priority.trim().toLowerCase())) return error("VALIDATION_ERROR", "Task priority must be low, medium, high, or urgent", 400, id, headers);
          taskUpdates.push({ field: "priority", value: payload.priority.trim().toLowerCase() });
        }
        if (payload.due_at !== undefined) {
          const dueAt = payload.due_at;
          if (dueAt !== null && (typeof dueAt !== "string" || Number.isNaN(Date.parse(dueAt)))) return error("VALIDATION_ERROR", "Task due_at must be a valid date", 400, id, headers);
          taskUpdates.push({ field: "due_at", value: dueAt === null ? "" : String(dueAt) });
        }
        if (payload.assigned_to_user_id !== undefined) {
          const assignedToUserId = payload.assigned_to_user_id;
          if (assignedToUserId !== null && typeof assignedToUserId !== "string") return error("VALIDATION_ERROR", "Assigned employee must be a valid user", 400, id, headers);
          if (assignedToUserId !== null && !(await employeeCanBeAssigned(env, auth, assignedToUserId, targetClientId ?? "system"))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers);
          taskUpdates.push({ field: "assigned_to_user_id", value: assignedToUserId === null ? "" : String(assignedToUserId) });
        }
        if (!taskUpdates.length) return error("VALIDATION_ERROR", "A supported task update is required", 400, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const scopeKey = task.client_id ?? auth.clientId ?? auth.userId ?? "system"; const endpoint = `PATCH /v1/tasks/${taskMatch[1]}`; const existing = await idempotentResponse(env, idempotencyKey, scopeKey, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare(`UPDATE tasks SET ${taskUpdates.map((update) => `${update.field} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...taskUpdates.map((update) => update.value), taskMatch[1]).run();
        const changed = Object.fromEntries(taskUpdates.map((update) => [update.field, update.value || null]));
        await audit(env, ctx, auth, id, "task.updated", "task", taskMatch[1], { client_id: task.client_id, fields: taskUpdates.map((update) => update.field) });
        const serialized = JSON.stringify({ ok: true, data: { id: taskMatch[1], ...changed }, request_id: id }); await saveIdempotent(env, idempotencyKey, scopeKey, endpoint, 200, serialized, requestHash); return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/activity" && request.method === "POST") {
        if (!hasScope(auth, "activity.read") || !hasRole(auth, ["employee", "admin", "super_admin"])) return error("FORBIDDEN", "Activity write permission required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload);
        const action = typeof payload.action === "string" ? payload.action.trim() : "";
        const entityType = typeof payload.entity_type === "string" ? payload.entity_type.trim() : "";
        const entityId = payload.entity_id === undefined || payload.entity_id === null ? null : String(payload.entity_id).trim();
        let clientId = payload.client_id === undefined || payload.client_id === null ? auth.clientId ?? null : String(payload.client_id).trim();
        const shipmentId = payload.shipment_id === undefined || payload.shipment_id === null ? null : String(payload.shipment_id).trim();
        if (!action || action.length > 240 || !entityType || entityType.length > 120) return error("VALIDATION_ERROR", "Activity action and entity type are required", 400, id, headers);
        if (clientId && !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        if (shipmentId) {
          const shipment = await env.DB.prepare("SELECT client_id FROM shipments WHERE id = ? LIMIT 1").bind(shipmentId).first<{ client_id: string }>();
          if (!shipment || !canAccessClient(auth, shipment.client_id) || (clientId && shipment.client_id !== clientId)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
          clientId = shipment.client_id;
        }
        const employeeScopedActivity = entityType === "employee_workspace" && !clientId && !shipmentId;
        if (!auth.system && !clientId && !employeeScopedActivity) return error("FORBIDDEN", "Client scope is required for operational activity", 403, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const scopeKey = clientId ?? auth.userId ?? "system"; const endpoint = "POST /v1/activity"; const existing = await idempotentResponse(env, key, scopeKey, endpoint, requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const activityId = crypto.randomUUID(); const details = payload.details && typeof payload.details === "object" ? payload.details : {};
        await env.DB.prepare("INSERT INTO activity_events (id, actor_user_id, client_id, shipment_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(activityId, auth.userId ?? `api:${clientId ?? "system"}`, clientId, shipmentId, action, entityType, entityId, JSON.stringify({ request_id: id, ...details })).run();
        const serialized = JSON.stringify({ ok: true, data: { id: activityId, client_id: clientId, shipment_id: shipmentId, action, entity_type: entityType, entity_id: entityId }, request_id: id }); await saveIdempotent(env, key, scopeKey, endpoint, 201, serialized, requestHash);
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/activity" && request.method === "GET") {
        if (!hasScope(auth, "activity.read")) return error("FORBIDDEN", "Activity read scope required", 403, id, headers);
        const rows = auth.system ? await env.DB.prepare("SELECT * FROM activity_events ORDER BY created_at DESC LIMIT 100").all() : auth.clientIds.size ? await env.DB.prepare(`SELECT * FROM activity_events WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR actor_user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "").all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      const notificationMatch = route.match(/^\/notifications\/([^/]+)$/);
      if (notificationMatch && request.method === "PATCH") {
        if (!hasScope(auth, "notifications.read")) return error("FORBIDDEN", "Notification permission required", 403, id, headers);
        const notification = await env.DB.prepare("SELECT id, client_id, recipient_user_id FROM notifications WHERE id = ? LIMIT 1").bind(notificationMatch[1]).first<{ id: string; client_id: string | null; recipient_user_id: string }>();
        const notificationAllowed = notification && (auth.system || notification.recipient_user_id === auth.userId || (notification.client_id !== null && canAccessClient(auth, notification.client_id)));
        if (!notification || !notificationAllowed) return error("NOT_FOUND", "Notification not found", 404, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); if (typeof payload.is_read !== "boolean") return error("VALIDATION_ERROR", "is_read must be boolean", 400, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const scopeKey = notification.client_id ?? auth.clientId ?? auth.userId ?? "system"; const endpoint = `PATCH /v1/notifications/${notificationMatch[1]}`; const existing = await idempotentResponse(env, idempotencyKey, scopeKey, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        await env.DB.prepare("UPDATE notifications SET is_read = ? WHERE id = ?").bind(payload.is_read ? 1 : 0, notification.id).run();
        const serialized = JSON.stringify({ ok: true, data: { id: notification.id, is_read: payload.is_read }, request_id: id }); await saveIdempotent(env, idempotencyKey, scopeKey, endpoint, 200, serialized, requestHash); return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/api-keys" && request.method === "GET") {
        if (!hasScope(auth, "api_keys.read")) return error("FORBIDDEN", "API key read permission required", 403, id, headers);
        const rows = auth.system ? await env.DB.prepare("SELECT id, client_id, name, key_prefix, environment, status, expires_at, last_used_at, created_at, revoked_at FROM api_keys ORDER BY created_at DESC LIMIT 100").all() : auth.clientIds.size ? await env.DB.prepare(`SELECT id, client_id, name, key_prefix, environment, status, expires_at, last_used_at, created_at, revoked_at FROM api_keys WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 100`).bind(...auth.clientIds).all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      if (route === "/api-keys" && request.method === "POST") {
        if (!hasScope(auth, "api_keys.manage")) return error("FORBIDDEN", "API key management permission required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id); if (!clientId || !canAccessClient(auth, clientId) || typeof payload.name !== "string" || !payload.name.trim()) return error("VALIDATION_ERROR", "API key name and client scope are required", 400, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/api-keys", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const environment = payload.environment === undefined ? "live" : String(payload.environment).trim().toLowerCase(); if (environment !== "live" && environment !== "test") return error("VALIDATION_ERROR", "API key environment must be live or test", 400, id, headers);
        const expiresAt = payload.expires_at === undefined || payload.expires_at === null || payload.expires_at === "" ? null : typeof payload.expires_at === "string" && !Number.isNaN(Date.parse(payload.expires_at)) ? new Date(payload.expires_at).toISOString() : null; if (payload.expires_at !== undefined && payload.expires_at !== null && payload.expires_at !== "" && (!expiresAt || Date.parse(expiresAt) <= Date.now())) return error("VALIDATION_ERROR", "API key expiration must be a valid future date", 400, id, headers);
        if (payload.name.trim().length > 120) return error("VALIDATION_ERROR", "API key name must be 120 characters or fewer", 400, id, headers);
        const requestedScopes = payload.scopes === undefined ? ["shipments.read"] : Array.isArray(payload.scopes) ? [...new Set(payload.scopes.filter((scope): scope is string => typeof scope === "string"))] : [];
        const unsupportedScopes = requestedScopes.filter((scope) => !API_KEY_SCOPES.has(scope));
        if (unsupportedScopes.length) return error("VALIDATION_ERROR", `Unsupported API scope: ${unsupportedScopes[0]}`, 400, id, headers);
        const scopes = requestedScopes;
        if (!scopes.length || scopes.length > 30) return error("VALIDATION_ERROR", "Choose between 1 and 30 API scopes", 400, id, headers);
        const raw = `pss_${environment}_${crypto.randomUUID().replaceAll("-", "")}`; const keyId = crypto.randomUUID(); const prefix = raw.slice(0, 16); const hash = await sha256(`${raw}${env.API_KEY_PEPPER ?? ""}`);
        await env.DB.prepare("INSERT INTO api_keys (id, client_id, name, key_prefix, key_hash, environment, expires_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(keyId, clientId, payload.name.trim(), prefix, hash, environment, expiresAt, auth.userId ?? `api:${clientId}`).run(); for (const scope of scopes) await env.DB.prepare("INSERT INTO api_key_scopes (api_key_id, scope) VALUES (?, ?)").bind(keyId, scope).run(); await env.DB.prepare("INSERT INTO api_key_events (id, api_key_id, client_id, event_type, actor_user_id, request_id) VALUES (?, ?, ?, 'created', ?, ?)").bind(crypto.randomUUID(), keyId, clientId, auth.userId ?? null, id).run(); const serialized = JSON.stringify({ ok: true, data: { id: keyId, name: payload.name.trim(), key_prefix: prefix, environment, expires_at: expiresAt, scopes, secret: raw }, request_id: id }); const stored = JSON.stringify({ ok: true, data: { id: keyId, name: payload.name.trim(), key_prefix: prefix, environment, expires_at: expiresAt, scopes, secret: null, secret_available_once: true }, request_id: id }); await saveIdempotent(env, key, clientId, "POST /v1/api-keys", 201, stored, requestHash); return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      const apiKeyMatch = route.match(/^\/api-keys\/([^/]+)$/);
      if (apiKeyMatch && request.method === "GET") {
        if (!hasScope(auth, "api_keys.read")) return error("FORBIDDEN", "API key read permission required", 403, id, headers);
        const key = await env.DB.prepare("SELECT id, client_id, name, key_prefix, status, expires_at, last_used_at, created_at, revoked_at FROM api_keys WHERE id = ? LIMIT 1").bind(apiKeyMatch[1]).first<{ id: string; client_id: string }>();
        if (!key || !canAccessClient(auth, key.client_id)) return error("NOT_FOUND", "API key not found", 404, id, headers);
        const [events, usage] = await Promise.all([
          env.DB.prepare("SELECT id, event_type, actor_user_id, request_id, created_at FROM api_key_events WHERE api_key_id = ? ORDER BY created_at DESC LIMIT 100").bind(key.id).all(),
          env.DB.prepare("SELECT id, endpoint, method, status_code, bytes_in, bytes_out, request_id, created_at FROM api_key_usage WHERE api_key_id = ? ORDER BY created_at DESC LIMIT 100").bind(key.id).all(),
        ]);
        return json({ ok: true, data: { key, events: events.results, usage: usage.results } }, 200, headers);
      }
      if (apiKeyMatch && request.method === "PATCH") {
        if (!hasScope(auth, "api_keys.manage")) return error("FORBIDDEN", "API key management permission required", 403, id, headers); const key = await env.DB.prepare("SELECT id, client_id FROM api_keys WHERE id = ? LIMIT 1").bind(apiKeyMatch[1]).first<{ id: string; client_id: string }>(); if (!key || !canAccessClient(auth, key.client_id)) return error("NOT_FOUND", "API key not found", 404, id, headers); const payload = await bodyJson(request); if (payload.status !== "revoked") return error("VALIDATION_ERROR", "Only revocation is supported", 400, id, headers); const requestHash = await payloadFingerprint(payload); const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers); const endpoint = `PATCH /v1/api-keys/${key.id}`; const existing = await idempotentResponse(env, idempotencyKey, key.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } }); await env.DB.prepare("UPDATE api_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(key.id).run(); await env.DB.prepare("INSERT INTO api_key_events (id, api_key_id, client_id, event_type, actor_user_id, request_id) VALUES (?, ?, ?, 'revoked', ?, ?)").bind(crypto.randomUUID(), key.id, key.client_id, auth.userId ?? null, id).run(); const serialized = JSON.stringify({ ok: true, data: { id: key.id, status: "revoked" }, request_id: id }); await saveIdempotent(env, idempotencyKey, key.client_id, endpoint, 200, serialized, requestHash); return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }

      const masterRecordRoute = route.match(/^\/master-records(?:\/([^/]+))?$/);
      if (masterRecordRoute) {
        if (!hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Master administrator role required", 403, id, headers);
        if (request.method === "GET") {
          const kind = url.searchParams.get("kind")?.trim();
          if (!kind || kind.length > 160) return error("VALIDATION_ERROR", "A record kind is required", 400, id, headers);
          const requestedKinds = kind === "crm"
            ? ["crm.prospect", "crm.contact", "crm.interaction", "crm.note", "crm.followup", "crm.health"]
            : [kind];
          const kindPlaceholders = requestedKinds.map(() => "?").join(",");
          const rows = auth.system
            ? await env.DB.prepare(`SELECT * FROM master_records WHERE kind IN (${kindPlaceholders}) ORDER BY updated_at DESC LIMIT 1200`).bind(...requestedKinds).all()
            : auth.clientIds.size
              ? await env.DB.prepare(`SELECT * FROM master_records WHERE kind IN (${kindPlaceholders}) AND (client_id IS NULL OR client_id IN (${[...auth.clientIds].map(() => "?").join(",")})) ORDER BY updated_at DESC LIMIT 1200`).bind(...requestedKinds, ...auth.clientIds).all()
              : { results: [] };
          return json({ ok: true, data: rows.results }, 200, headers);
        }
        if (request.method === "POST") {
          const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const kind = String(payload.kind ?? "").trim(); const title = String(payload.title ?? "").trim();
          if (!kind || kind.length > 160 || !title || title.length > 240) return error("VALIDATION_ERROR", "Record kind and title are required", 400, id, headers);
          const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
          if ((!auth.system && !clientId) || (clientId && !canAccessClient(auth, clientId))) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
          const idempotencyKey = request.headers.get("Idempotency-Key");
          if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
          const idempotencyClient = clientId ?? auth.clientId ?? (auth.clientIds.size === 1 ? [...auth.clientIds][0] : "system");
          const existing = await idempotentResponse(env, idempotencyKey, idempotencyClient, "POST /v1/master-records", requestHash);
          if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
          const recordId = typeof payload.id === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(payload.id) ? payload.id : crypto.randomUUID(); const detail = String(payload.detail ?? ""); const status = String(payload.status ?? "pending"); const meta = String(payload.meta ?? "");
          const recordPayload = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
          await env.DB.prepare("INSERT INTO master_records (id, kind, client_id, title, detail, status, meta, payload_json, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, client_id = excluded.client_id, title = excluded.title, detail = excluded.detail, status = excluded.status, meta = excluded.meta, payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP").bind(recordId, kind, clientId, title, detail, status, meta, JSON.stringify(recordPayload), auth.userId ?? `api:${clientId ?? "system"}`).run();
          await audit(env, ctx, auth, id, "master_record.saved", "master_record", recordId, { client_id: clientId, kind });
          const serialized = JSON.stringify({ ok: true, data: { id: recordId, kind, client_id: clientId, title, detail, status, meta, payload: recordPayload }, request_id: id });
          await saveIdempotent(env, idempotencyKey, idempotencyClient, "POST /v1/master-records", 200, serialized, requestHash);
          return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
        }
        if (masterRecordRoute[1] && request.method === "PATCH") {
          const current = await env.DB.prepare("SELECT id, client_id, kind FROM master_records WHERE id = ? LIMIT 1").bind(masterRecordRoute[1]).first<{ id: string; client_id: string | null; kind: string }>();
          if (!current || (!auth.system && (!current.client_id || !canAccessClient(auth, current.client_id)))) return error("NOT_FOUND", "Master record not found", 404, id, headers);
          const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const allowed = ["title", "detail", "status", "meta"] as const; const field = allowed.find((name) => typeof payload[name] === "string");
          if (!field) return error("VALIDATION_ERROR", "A supported record update is required", 400, id, headers);
          const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
          const idempotencyClient = current.client_id ?? auth.clientId ?? "system"; const endpoint = `PATCH /v1/master-records/${current.id}`; const existing = await idempotentResponse(env, idempotencyKey, idempotencyClient, endpoint, requestHash);
          if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
          await env.DB.prepare(`UPDATE master_records SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(String(payload[field]), current.id).run();
          await audit(env, ctx, auth, id, "master_record.updated", "master_record", current.id, { client_id: current.client_id, kind: current.kind, field });
          const serialized = JSON.stringify({ ok: true, data: { id: current.id, [field]: String(payload[field]) }, request_id: id }); await saveIdempotent(env, idempotencyKey, idempotencyClient, endpoint, 200, serialized, requestHash);
          return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
        }
      }

      return error("NOT_FOUND", "Not found", 404, id, headers);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "UNKNOWN_ERROR"; const publicMessage = message === "PAYLOAD_TOO_LARGE" ? "Payload too large" : message === "INVALID_JSON" ? "Invalid JSON body" : "Request failed";
      console.error(JSON.stringify({ request_id: id, error: message, route }));
      if (isD1QuotaError(message)) return error("DATABASE_QUOTA_EXCEEDED", "Production data is temporarily unavailable because the database daily limit has been reached. Upgrade the Cloudflare Workers plan or retry after the UTC quota reset.", 503, id, headers);
      return error(message === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : message === "INVALID_JSON" ? "INVALID_JSON" : "INTERNAL_ERROR", publicMessage, message === "PAYLOAD_TOO_LARGE" ? 413 : message === "INVALID_JSON" ? 400 : 500, id, headers, message);
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await retryPendingDelhiveryBookings(env, controller.cron);
      await reconcilePendingDelhiveryReferences(env, controller.cron);
      await refreshPendingProviderWeights(env, controller.cron);
      await refreshDelhiveryShipments(env, controller.cron);
      await refreshDelhiveryPickupStatuses(env, controller.cron);
      await reconcileShipmentLinkedPickupStatuses(env, controller.cron);
    })());
  },
};

export default worker;
