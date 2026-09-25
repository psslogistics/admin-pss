export interface Env extends Omit<Cloudflare.Env, "SUPABASE_PUBLISHABLE_KEY" | "API_KEY_PEPPER" | "DELHIVERY_API_TOKEN" | "DELHIVERY_WEBHOOK_SECRET" | "EKART_API_KEY" | "EKART_API_SECRET" | "EKART_WEBHOOK_SECRET" | "TRACKON_API_BASE_URL" | "TRACKON_CREDENTIALS_JSON" | "TRACKON_WEBHOOK_SECRET" | "TRACKON_BOOKING_URL" | "TRACKON_TRACKING_URL" | "TRACKON_LABEL_URL" | "TRACKON_ENABLE_SHIPMENT_CREATION" | "TRACKON_ENABLE_PICKUP_CREATION" | "XPRESSBEES_API_BASE_URL" | "XPRESSBEES_CREDENTIALS_JSON" | "XPRESSBEES_ENABLE_SHIPMENT_CREATION" | "XPRESSBEES_ENABLE_PICKUP_CREATION" | "RIVIGO_API_BASE_URL" | "RIVIGO_AUTH_URL" | "RIVIGO_TRACKING_URL" | "RIVIGO_CREDENTIALS_JSON"> {
  SUPABASE_PUBLISHABLE_KEY: string;
  API_KEY_PEPPER?: string;
  DELHIVERY_API_TOKEN?: string;
  DELHIVERY_WEBHOOK_SECRET?: string;
  EKART_API_KEY?: string;
  EKART_API_SECRET?: string;
  EKART_WEBHOOK_SECRET?: string;
  TRACKON_API_BASE_URL?: string;
  TRACKON_CREDENTIALS_JSON?: string;
  TRACKON_WEBHOOK_SECRET?: string;
  TRACKON_BOOKING_URL?: string;
  TRACKON_TRACKING_URL?: string;
  TRACKON_LABEL_URL?: string;
  TRACKON_ENABLE_SHIPMENT_CREATION?: string;
  TRACKON_ENABLE_PICKUP_CREATION?: string;
  XPRESSBEES_API_BASE_URL?: string;
  XPRESSBEES_CREDENTIALS_JSON?: string;
  XPRESSBEES_ENABLE_SHIPMENT_CREATION?: string;
  XPRESSBEES_ENABLE_PICKUP_CREATION?: string;
  RIVIGO_API_BASE_URL?: string;
  RIVIGO_AUTH_URL?: string;
  RIVIGO_TRACKING_URL?: string;
  RIVIGO_CREDENTIALS_JSON?: string;
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
  apiKeyId?: string;
  accessToken?: string;
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const error = (code: string, message: string, status: number, requestId: string, headers: HeadersInit = {}) => json({ ok: false, error: { code, message }, request_id: requestId }, status, headers);
const requestId = (request: Request) => request.headers.get("cf-ray") ?? crypto.randomUUID();

function allowedOrigins(env: Env) { return new Set((env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)); }
function originAllowed(request: Request, env: Env) { const origin = request.headers.get("Origin"); return !origin || allowedOrigins(env).has(origin); }
function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = { "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, X-Webhook-Signature", "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS", "access-control-max-age": "86400", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", vary: "Origin" };
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
  if (contentType === "application/pdf") return startsWith(0x25, 0x50, 0x44, 0x46);
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

async function loadUserAuth(env: Env, token: string): Promise<Auth | null> {
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;
  const profiles = await supabaseGet<{ status?: string }>(env, `profiles?id=eq.${user.id}&select=status`, token);
  if (profiles[0]?.status && profiles[0].status !== "active") return null;
  const employeeProfiles = await supabaseGet<{ employment_status?: string }>(env, `employee_profiles?user_id=eq.${user.id}&select=employment_status`, token);
  if (employeeProfiles[0]?.employment_status && employeeProfiles[0].employment_status !== "active") return null;
  const roleLinks = await supabaseGet<{ role_id: string }>(env, `user_roles?user_id=eq.${user.id}&is_active=eq.true&select=role_id`, token);
  const roleIds = roleLinks.map((row) => row.role_id).filter(Boolean);
  const roles = roleIds.length ? await supabaseGet<Role>(env, `roles?id=in.(${roleIds.join(",")})&select=role_code,scope`, token) : [];
  const rolePermissions = roleIds.length ? await supabaseGet<{ permission_key: string }>(env, `role_permissions?role_id=in.(${roleIds.join(",")})&select=permission_key`, token) : [];
  const permissionOverrides = await supabaseGet<{ permission_key: string; mode: "grant" | "revoke" }>(env, `employee_permission_overrides?employee_user_id=eq.${encodeURIComponent(user.id)}&select=permission_key,mode`, token);
  const assignments = await supabaseGet<{ client_id: string }>(env, `employee_client_assignments?employee_user_id=eq.${user.id}&is_active=eq.true&select=client_id`, token);
  const memberships = await supabaseGet<{ client_id: string; membership_status?: string }>(env, `client_memberships?user_id=eq.${user.id}&select=client_id,membership_status`, token);
  const requestedClientIds = [...new Set([...assignments, ...memberships.filter((row) => !row.membership_status || row.membership_status === "active")].map((row) => row.client_id).filter(Boolean))];
  const activeClients = requestedClientIds.length
    ? await supabaseGet<{ id: string }>(env, `client_accounts?id=in.(${requestedClientIds.join(",")})&status=eq.active&select=id`, token)
    : [];
  const activeClientIds = new Set(activeClients.map((row) => row.id));
  const clientIds = new Set(requestedClientIds.filter((clientId) => activeClientIds.has(clientId)));
  // Keep the concrete role codes for permission-specific checks, but also add
  // the canonical scope from Supabase. The production client role is
  // `client_user`, while Worker route checks use the shared `client` scope.
  const roleSet = new Set(roles.flatMap((role) => [role.role_code, role.scope]));
  const system = roles.some((role) => role.scope === "system" || role.role_code === "super_admin");
  const permissions = new Set(rolePermissions.map((row) => row.permission_key).filter(Boolean));
  for (const override of permissionOverrides) if (override.mode === "grant") permissions.add(override.permission_key);
  // Match the Supabase `has_permission` policy: an explicit revoke wins over
  // a grant, independent of the order returned by PostgREST.
  for (const override of permissionOverrides) if (override.mode === "revoke") permissions.delete(override.permission_key);
  return { kind: "user", userId: user.id, clientIds, roles: roleSet, system, scopes: new Set(["authenticated"]), permissions, accessToken: token };
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
    return { kind: "api", clientId: row.client_id, clientIds: new Set([row.client_id]), roles: new Set(), system: false, scopes: new Set(scopes.results.map((item) => item.scope)), permissions: new Set(), apiKeyId: row.id };
  }
  if (!header.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  return loadUserAuth(env, header.slice(7).trim());
}

function hasScope(auth: Auth, scope: string) {
  if (auth.kind === "api") return auth.scopes.has(scope);
  if (auth.system) return true;
  const permissionMap: Record<string, string[]> = {
    "shipments.read": ["shipments.read", "shipments.view", "admin.tracking.view"], "tracking.read": ["tracking.read", "tracking.view", "admin.tracking.view"],
    "shipments.create": ["shipments.create", "admin.booking.create"], "pickups.read": ["pickups.read", "pickup.view", "admin.pickup.view"],
    "pickups.create": ["pickups.create", "pickup.create", "admin.pickup.create"], "pickups.manage": ["pickups.manage", "pickup.assign", "admin.pickup.assign"],
    "documents.read": ["documents.read", "admin.tracking.view"], "documents.manage": ["documents.manage", "admin.booking.create"],
    "reports.read": ["reports.read", "reports.view", "admin.reports.view"], "tickets.read": ["tickets.read", "tickets.view", "admin.support.view"],
    "tickets.create": ["tickets.create", "tickets.reply", "admin.tickets.create"], "notifications.read": ["notifications.read", "notifications.view", "admin.notifications.view"],
    "cases.read": ["cases.read", "exceptions.view", "admin.tracking.view"], "cases.manage": ["cases.manage", "exceptions.manage", "admin.tracking.update"],
    "addresses.manage": ["addresses.manage", "admin.booking.create"], "quotes.create": ["quotes.create", "admin.booking.create"],
    "billing.read": ["billing.read", "billing.view"], "wallet.read": ["wallet.read", "transactions.view"],
    "billing.manage": ["billing.manage", "billing.create", "billing.approve"], "wallet.manage": ["wallet.manage", "transactions.manage"],
    "cod.read": ["cod.read", "transactions.view"], "cod.manage": ["cod.manage", "billing.approve"], "weight.read": ["weight.read", "billing.view"], "weight.manage": ["weight.manage", "billing.approve"],
    "tasks.read": ["tasks.read", "tasks.view", "admin.tasks.view"], "tasks.manage": ["tasks.manage", "admin.tasks.manage"],
    "departments.read": ["departments.read", "departments.view", "admin.departments.view"], "departments.manage": ["departments.manage", "admin.departments.manage"],
    "activity.read": ["activity.read", "employee_activity.view", "admin.activity.view"],
    "integrations.read": ["integrations.view", "admin.integrations.view"], "webhooks.read": ["api_keys.view", "integrations.view", "admin.api_keys.view"],
    "provider_accounts.read": ["integrations.view", "admin.integrations.view"], "provider_accounts.manage": ["integrations.manage", "admin.integrations.manage"],
  };
  if (permissionMap[scope]?.some((permission) => auth.permissions.has(permission))) return true;
  if (auth.roles.has("employee")) return false;
  const roles = auth.roles;
  if (["shipments.read", "tracking.read", "pickups.read", "documents.read", "reports.read", "departments.read"].includes(scope)) return roles.has("client") || roles.has("employee") || roles.has("admin");
  if (["shipments.create", "pickups.create", "documents.manage", "tickets.create", "tickets.read", "notifications.read", "cases.read", "cases.manage", "addresses.manage", "quotes.create", "billing.read", "wallet.read", "cod.read", "weight.read", "tasks.read", "activity.read"].includes(scope)) return roles.has("client") || roles.has("employee") || roles.has("admin");
  if (["pickups.manage", "tasks.manage"].includes(scope)) return roles.has("employee") || roles.has("admin");
  if (scope === "departments.manage") return roles.has("admin") || roles.has("super_admin");
  if (scope === "provider_accounts.read") return roles.has("admin") || roles.has("super_admin");
  if (scope === "provider_accounts.manage") return roles.has("admin") || roles.has("super_admin");
  if (["billing.manage", "wallet.manage", "cod.manage", "weight.manage"].includes(scope)) return roles.has("admin") || roles.has("super_admin");
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
function normalizeProviderShipmentStatus(value: unknown) {
  const status = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!status) return "in_transit";
  if (["booked", "manifested", "pickup_scheduled", "order_created"].includes(status)) return "booked";
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
  return { line, city, state, pincode, name, phone, country: String(address.country ?? "India").trim() || "India" };
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
  const orderId = String(payload.order_id ?? payload.shipment_id ?? crypto.randomUUID()).trim().slice(0, 50);
  const shipment: Record<string, unknown> = {
    client,
    order: orderId,
    order_date: String(payload.order_date ?? new Date().toISOString().slice(0, 10)),
    product_type: String(payload.product_type ?? "B2C"),
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

function delhiveryPickupPayload(env: Env, payload: Record<string, unknown>) {
  const pickupLocation = String(payload.delhivery_pickup_location ?? payload.pickup_location ?? env.DELHIVERY_DEFAULT_PICKUP_LOCATION ?? "").trim();
  const pickupDate = String(payload.scheduled_date ?? "").trim();
  const rawWindow = String(payload.window ?? payload.pickup_time ?? "10:00:00").trim();
  const pickupTime = (rawWindow.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ?? "10:00:00").split(":").map((part) => part.padStart(2, "0"));
  if (!pickupLocation || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  return { pickup_time: `${pickupTime[0]}:${pickupTime[1]}:${pickupTime[2] ?? "00"}`, pickup_date: pickupDate, pickup_location: pickupLocation, expected_package_count: Math.max(1, Number(payload.expected_package_count ?? payload.package_count ?? 1)) };
}

function findProviderReference(value: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findProviderReference(item, keys, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(object)) {
    if (keys.has(key.toLowerCase()) && typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 160);
  }
  for (const candidate of Object.values(object)) { const found = findProviderReference(candidate, keys, depth + 1); if (found) return found; }
  return null;
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

type NormalizedProviderTracking = { status: string; location: string; description: string; eventTime: string | null };
function normalizeProviderTracking(value: unknown, depth = 0): NormalizedProviderTracking | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) { for (const item of value) { const found = normalizeProviderTracking(item, depth + 1); if (found) return found; } return null; }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const nestedStatus = object.Status && typeof object.Status === "object" ? object.Status as Record<string, unknown> : null;
  const rawStatus = object.status ?? object.current_status ?? object.currentStatus ?? nestedStatus?.Status ?? nestedStatus?.status;
  const normalized = normalizeProviderShipmentStatus(rawStatus);
  const knownStatuses = new Set(["booked", "picked_up", "in_transit", "out_for_delivery", "delivered", "cancelled", "exception", "rto"]);
  if (typeof rawStatus === "string" && knownStatuses.has(normalized)) {
    return {
      status: normalized,
      location: String(object.location ?? object.city ?? nestedStatus?.StatusLocation ?? nestedStatus?.location ?? "").trim().slice(0, 200),
      description: String(object.description ?? object.message ?? nestedStatus?.Instructions ?? nestedStatus?.description ?? `Provider status: ${normalized}`).trim().slice(0, 500),
      eventTime: typeof (object.event_time ?? object.eventTime ?? object.timestamp ?? nestedStatus?.StatusDateTime) === "string" ? String(object.event_time ?? object.eventTime ?? object.timestamp ?? nestedStatus?.StatusDateTime) : null,
    };
  }
  for (const child of Object.values(object)) { const found = normalizeProviderTracking(child, depth + 1); if (found) return found; }
  return null;
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
    RefNo: String(payload.ref_no ?? payload.order_id ?? payload.shipment_id ?? ""),
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

async function xpressbeesToken(env: Env, credential: string, requestIdValue: string) {
  const account = xpressbeesCredentials(credential);
  if (!account || !env.XPRESSBEES_API_BASE_URL) return null;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
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

function xpressbeesTrackingUrl(endpoint: string) { return `${endpoint.replace(/\/$/, "")}/shipments/track_shipment`; }
function xpressbeesTrackingBody(trackingNumber: string) { return JSON.stringify({ awb_number: trackingNumber }); }

async function providerRequest(env: Env, provider: CourierProvider, operation: string, payload: Record<string, unknown>, requestIdValue: string, clientId?: string, idempotencyKey?: string) {
  if (String(env.ENABLE_PROVIDER_CALLS) !== "true") return { enabled: false, status: "disabled" as const };
  const trackingNumber = String(payload.tracking_number ?? payload.provider_reference ?? "").trim();
  if ((operation === "tracking" || operation === "labels") && !trackingNumber) return { enabled: false, status: "invalid_request" as const, reason: "A provider tracking reference is required" };
  if (provider === "delhivery" && operation === "shipments" && String(env.DELHIVERY_ENABLE_SHIPMENT_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Delhivery shipment creation is safety-disabled until live billing approval" };
  if (provider === "delhivery" && operation === "pickups" && String(env.DELHIVERY_ENABLE_PICKUP_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Delhivery pickup creation is safety-disabled until live operations approval" };
  if (provider === "delhivery" && !new Set(["tracking", "shipments", "pickups", "serviceability"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "Delhivery operation is not supported" };
  if (provider === "ekart" && operation === "pickups") return { enabled: false, status: "unsupported" as const, reason: "Ekart pickup contract is not verified" };
  if (provider === "ekart" && operation !== "tracking" && operation !== "shipments") return { enabled: false, status: "unsupported" as const, reason: "Ekart operation is not supported" };
  if (provider === "trackon" && operation === "shipments" && String(env.TRACKON_ENABLE_SHIPMENT_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "Trackon shipment creation is safety-disabled until live billing approval" };
  if (provider === "trackon" && operation === "pickups") return { enabled: false, status: "unsupported" as const, reason: "Trackon pickup contract is not verified; use the provider portal until Trackon confirms the endpoint" };
  if (provider === "trackon" && !new Set(["tracking", "shipments", "labels"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "Trackon operation is not supported" };
  if (provider === "xpressbees" && operation === "shipments" && String(env.XPRESSBEES_ENABLE_SHIPMENT_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "XpressBees shipment creation is safety-disabled until live billing approval" };
  if (provider === "xpressbees" && operation === "pickups" && String(env.XPRESSBEES_ENABLE_PICKUP_CREATION) !== "true") return { enabled: false, status: "safety_disabled" as const, reason: "XpressBees pickup creation is safety-disabled until live operations approval" };
  if (provider === "xpressbees" && !new Set(["tracking", "shipments", "pickups", "quotes"]).has(operation)) return { enabled: false, status: "unsupported" as const, reason: "XpressBees operation is not enabled" };
  if (provider === "rivigo") return { enabled: false, status: "not_configured" as const, reason: "Rivigo requires a developer-portal app UUID, one-time app secret, approved API endpoints, and production go-live approval" };
  const base = provider === "delhivery" ? env.DELHIVERY_API_BASE_URL : provider === "ekart" ? env.EKART_API_BASE_URL : provider === "trackon" ? env.TRACKON_API_BASE_URL : env.XPRESSBEES_API_BASE_URL;
  const requestedAccountId = providerAccountId(payload);
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
          AND (? IS NULL OR pa.id = ?)
          AND (p.provider_account_id IS NULL OR p.enabled = 1)
        ORDER BY CASE WHEN p.provider_account_id IS NOT NULL THEN 0 ELSE 1 END,
                 COALESCE(p.priority, 100) ASC,
                 COALESCE(p.confidence_score, 0) DESC,
                 pa.created_at ASC
        LIMIT 1`).bind(clientId, provider, clientId, requestedAccountId, requestedAccountId).first<{
          id: string; provider: CourierProvider; account_name: string; credential_secret_name: string;
          client_enabled: number; priority: number; confidence_score: number; rate_card_id: string | null;
        }>()
    : null;
  if (clientId && requestedAccountId && !account) return { enabled: false, status: "disabled" as const, reason: "The selected courier account is not enabled for this client" };
  const secretBag = env as unknown as Record<string, unknown>;
  const configuredCredential = provider === "delhivery" ? env.DELHIVERY_API_TOKEN : provider === "ekart" ? env.EKART_API_KEY : provider === "xpressbees" ? env.XPRESSBEES_CREDENTIALS_JSON : undefined;
  const credential = account ? (typeof secretBag[account.credential_secret_name] === "string" ? String(secretBag[account.credential_secret_name]) : undefined) : configuredCredential;
  const trackon = provider === "trackon" ? trackonCredentials(env, credential) : null;
  if (!base || (provider === "trackon" ? !trackon : !credential)) return { enabled: false, status: "not_configured" as const };
  const xpressToken = provider === "xpressbees" ? await xpressbeesToken(env, credential!, requestIdValue) : null;
  if (provider === "xpressbees" && !xpressToken) return { enabled: true, status: "failed" as const, error: "XpressBees authentication failed" };
  const authorization = provider === "delhivery"
    ? `Token ${credential}`
    : provider === "ekart"
      ? credential!.trim().startsWith("Basic ") ? credential!.trim() : `Basic ${credential!.trim()}`
      : undefined;
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": requestIdValue };
  if (authorization) headers.Authorization = authorization;
  if (provider === "trackon") headers["x-trackon-app-key"] = trackon!.appKey;
  if (provider === "xpressbees") headers.Authorization = `Bearer ${xpressToken}`;
  const ekartCreate = provider === "ekart" && operation === "shipments" ? ekartCreatePayload(payload) : null;
  if (provider === "ekart" && operation === "shipments" && !ekartCreate) return { enabled: false, status: "invalid_request" as const, reason: "Origin and destination addresses require valid six-digit pincodes and ten-digit phone numbers" };
  const providerPayload = account?.provider === "delhivery" ? { ...payload, delhivery_client_name: account.account_name } : payload;
  const delhiveryCreate = provider === "delhivery" && operation === "shipments" ? delhiveryCreatePayload(env, providerPayload) : null;
  if (provider === "delhivery" && operation === "shipments" && !delhiveryCreate) return { enabled: false, status: "invalid_request" as const, reason: "Delhivery requires valid origin/destination addresses, a registered client name, and a pickup location" };
  const delhiveryPickup = provider === "delhivery" && operation === "pickups" ? delhiveryPickupPayload(env, providerPayload) : null;
  if (provider === "delhivery" && operation === "pickups" && !delhiveryPickup) return { enabled: false, status: "invalid_request" as const, reason: "Delhivery requires a valid pickup date and registered pickup location" };
  const integrationId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO integration_requests (id, provider, client_id, operation, idempotency_key, provider_request_id, status, attempt_count) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)").bind(integrationId, provider, clientId ?? null, operation, idempotencyKey ?? null, requestIdValue).run();
  const delhiveryOrigin = provider === "delhivery" ? new URL(base).origin : "";
  const trackonUrl = provider === "trackon" ? operation === "tracking" ? env.TRACKON_TRACKING_URL : operation === "shipments" ? env.TRACKON_BOOKING_URL : env.TRACKON_LABEL_URL : undefined;
  if (provider === "trackon" && !trackonUrl) return { enabled: false, status: "not_configured" as const, reason: `Trackon ${operation} endpoint is not configured` };
  const url = provider === "trackon" && operation === "tracking"
    ? trackonTrackingUrl(trackonUrl!, trackingNumber, trackon!)
    : provider === "trackon" && operation === "labels"
      ? trackonLabelUrl(trackonUrl!, trackingNumber, trackon!)
      : provider === "delhivery" && operation === "tracking"
        ? `${base.replace(/\/$/, "")}/packages/json/?waybill=${encodeURIComponent(trackingNumber)}&ref_ids=${encodeURIComponent(String(payload.order_id ?? ""))}`
    : provider === "delhivery" && operation === "shipments"
      ? `${delhiveryOrigin}/api/cmu/create.json`
      : provider === "delhivery" && operation === "pickups"
        ? `${delhiveryOrigin}/fm/request/new/`
        : provider === "delhivery" && operation === "serviceability"
          ? `${delhiveryOrigin}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(String(payload.destination_pincode ?? ""))}`
    : provider === "ekart"
      ? `${base.replace(/\/$/, "")}/v2/shipments/${operation === "shipments" ? "create" : "track"}`
      : provider === "xpressbees" && operation === "tracking"
        ? xpressbeesTrackingUrl(base)
      : provider === "xpressbees" && operation === "quotes"
        ? `${base.replace(/\/$/, "")}/shipments/calculate_pricing`
      : provider === "xpressbees" && operation === "shipments"
        ? `${base.replace(/\/$/, "")}/shipments`
      : provider === "xpressbees" && operation === "pickups"
        ? `${base.replace(/\/$/, "")}/shipments/pickup`
      : trackonUrl!;
  const requestBody = provider === "delhivery" && operation === "shipments"
    ? `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryCreate))}`
    : provider === "delhivery" && operation === "pickups"
      ? JSON.stringify(delhiveryPickup)
      : provider === "ekart" && operation === "shipments"
        ? JSON.stringify(ekartCreate)
      : provider === "ekart" ? JSON.stringify({ tracking_id: trackingNumber })
        : provider === "xpressbees" && operation === "tracking" ? xpressbeesTrackingBody(trackingNumber)
        : provider === "xpressbees" && operation === "quotes" ? JSON.stringify({ order_type_user: "B2C", origin: String(payload.origin_pincode ?? payload.origin ?? ""), destination: String(payload.destination_pincode ?? payload.destination ?? ""), weight: Number(payload.weight ?? 0), length: Number(payload.length ?? 0), height: Number(payload.height ?? 0), breadth: Number(payload.breadth ?? payload.width ?? 0), cod_amount: Number(payload.cod_amount ?? 0), cod: Boolean(payload.cod) })
        : provider === "xpressbees" ? JSON.stringify(payload)
        : operation === "tracking" ? JSON.stringify({ Appkey: trackon!.appKey, userId: trackon!.userId, password: trackon!.password, AWBNo: trackingNumber })
          : operation === "shipments" ? JSON.stringify(trackonPayload(payload, trackon!))
            : JSON.stringify({ Appkey: trackon!.appKey, userId: trackon!.userId, password: trackon!.password, AWBNo: trackingNumber });
  if (provider === "delhivery" && operation === "shipments") headers["content-type"] = "application/x-www-form-urlencoded";
  let response: Response | null = null; let lastError = "provider_request_failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await env.DB.prepare("UPDATE integration_requests SET attempt_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(attempt + 1, integrationId).run();
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const isGet = operation === "tracking" || operation === "serviceability" || (provider === "trackon" && operation === "labels");
      response = await fetch(url, { method: isGet ? "GET" : "POST", headers, body: isGet ? undefined : requestBody, signal: controller.signal });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) break;
      lastError = `provider_http_${response.status}`;
    } catch (caught) { lastError = caught instanceof Error ? caught.name === "AbortError" ? "provider_timeout" : caught.message : "provider_request_failed"; }
    finally { clearTimeout(timeout); }
    const retryAfter = response?.headers.get("retry-after");
    const retryDelay = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(Number(retryAfter) * 1000, 5000) : 200 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  if (!response) { await env.DB.prepare("UPDATE integration_requests SET status = 'failed', error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind("PROVIDER_REQUEST_FAILED", lastError, integrationId).run(); return { enabled: true, status: "failed" as const, providerStatus: 0, error: lastError }; }
  // Consume the provider response without forwarding its raw body to browser clients.
  // Provider payloads can contain customer data or contract-specific fields; only a
  // normalized tracking event is persisted and returned to the internal caller.
  const responseBody = await response.text();
  await env.DB.prepare("UPDATE integration_requests SET status = ?, error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(response.ok ? "succeeded" : "failed", response.ok ? null : `HTTP_${response.status}`, response.ok ? null : lastError, integrationId).run();
  let normalizedTracking: NormalizedProviderTracking | null = null;
  if (response.ok && operation === "tracking" && clientId && typeof payload.shipment_id === "string") {
    try { normalizedTracking = normalizeProviderTracking(JSON.parse(responseBody)); } catch { normalizedTracking = null; }
    if (normalizedTracking) {
      const current = await env.DB.prepare("SELECT status FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(payload.shipment_id, clientId).first<{ status: string }>();
      if (current && validShipmentTransition(String(current.status).toLowerCase(), normalizedTracking.status)) {
        const latest = await env.DB.prepare("SELECT status, location, description FROM tracking_events WHERE shipment_id = ? ORDER BY event_time DESC LIMIT 1").bind(payload.shipment_id).first<{ status: string; location: string | null; description: string | null }>();
        if (!latest || latest.status !== normalizedTracking.status || (latest.location ?? "") !== normalizedTracking.location || (latest.description ?? "") !== normalizedTracking.description) {
          await env.DB.prepare("UPDATE shipments SET provider = ?, status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, CURRENT_TIMESTAMP) ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(provider, normalizedTracking.status, normalizedTracking.status, payload.shipment_id, clientId).run();
          await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), payload.shipment_id, normalizedTracking.status, normalizedTracking.location, normalizedTracking.description, `provider:${provider}`, normalizedTracking.eventTime).run();
        }
      }
    }
  }
  let parsedProviderBody: unknown = null;
  try { parsedProviderBody = JSON.parse(responseBody); } catch { parsedProviderBody = null; }
  if (response.ok && provider === "delhivery" && operation === "shipments" && clientId && typeof payload.shipment_id === "string") {
    const createdReference = findProviderReference(parsedProviderBody, new Set(["waybill", "awb", "tracking_number", "trackingid", "shipment_id"]));
    if (createdReference) await env.DB.prepare("UPDATE shipments SET tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(createdReference, createdReference, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "trackon" && operation === "shipments" && clientId && typeof payload.shipment_id === "string") {
    const createdReference = findProviderReference(parsedProviderBody, new Set(["docketno", "docket_no", "awbno", "awb"])) ?? responseBody.match(/Docket\s*No\.\s*:\s*([A-Za-z0-9]+)/i)?.[1] ?? null;
    if (createdReference) await env.DB.prepare("UPDATE shipments SET tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(createdReference, createdReference, payload.shipment_id, clientId).run();
  }
  if (response.ok && provider === "trackon" && operation === "labels") {
    const labelUrl = findProviderReference(parsedProviderBody, new Set(["fileurl", "file_url"]));
    return { enabled: true, status: labelUrl ? "accepted" as const : "failed" as const, providerStatus: response.status, label_url: labelUrl, error: labelUrl ? undefined : "Trackon did not return a label URL" };
  }
  if (response.ok && provider === "delhivery" && operation === "pickups" && typeof payload.pickup_id === "string") {
    const pickupReference = findProviderReference(parsedProviderBody, new Set(["pickup_id", "pickup_request_id", "pur_id", "request_id"]));
    if (pickupReference) await env.DB.prepare("UPDATE pickup_requests SET provider = 'delhivery', provider_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(pickupReference, payload.pickup_id, clientId ?? "").run();
  }
  if (response.ok && provider === "delhivery" && operation === "serviceability") {
    const code = Array.isArray((parsedProviderBody as Record<string, unknown> | null)?.delivery_codes) ? (parsedProviderBody as { delivery_codes: Array<Record<string, unknown>> }).delivery_codes[0] : null;
    const postal = code?.postal_code && typeof code.postal_code === "object" ? code.postal_code as Record<string, unknown> : null;
    return { enabled: true, status: "accepted" as const, providerStatus: response.status, serviceable: Boolean(postal && (String(postal.pre_paid ?? "N").toUpperCase() === "Y" || String(postal.cash ?? "N").toUpperCase() === "Y")), prepaid: String(postal?.pre_paid ?? "N").toUpperCase() === "Y", cod: String(postal?.cash ?? "N").toUpperCase() === "Y", pickup: String(postal?.pickup ?? "N").toUpperCase() === "Y" };
  }
  if (response.ok && provider === "ekart" && operation === "shipments" && clientId && typeof payload.shipment_id === "string" && ekartCreate) {
    let providerReference: string | null = null;
    try { providerReference = findProviderReference(JSON.parse(responseBody), new Set(["tracking_id", "trackingid", "waybill", "awb", "shipment_id"])); } catch { providerReference = null; }
    const requestedReference = (ekartCreate.services[0]?.service_details[0]?.shipment as { tracking_id?: string } | undefined)?.tracking_id;
    const createdTracking = providerReference ?? requestedReference ?? null;
    if (createdTracking) await env.DB.prepare("UPDATE shipments SET tracking_number = COALESCE(tracking_number, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(createdTracking, createdTracking, payload.shipment_id, clientId).run();
  }
  return { enabled: true, status: response.ok ? "accepted" as const : "failed" as const, providerStatus: response.status, normalized_status: normalizedTracking?.status, amount: provider === "xpressbees" && operation === "quotes" ? findProviderAmount(parsedProviderBody) : undefined, provider_account_id: account?.id, account_name: account?.account_name, confidence_score: account?.confidence_score, priority: account?.priority, rate_card_id: account?.rate_card_id ?? undefined, error: response.ok ? undefined : lastError };
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

function delhiveryWebhookDetails(payload: Record<string, unknown>) {
  const shipment = payload.Shipment && typeof payload.Shipment === "object" ? payload.Shipment as Record<string, unknown> : payload.shipment && typeof payload.shipment === "object" ? payload.shipment as Record<string, unknown> : payload;
  const statusObject = shipment.Status && typeof shipment.Status === "object" ? shipment.Status as Record<string, unknown> : shipment.status && typeof shipment.status === "object" ? shipment.status as Record<string, unknown> : {};
  const rawStatus = typeof shipment.Status === "string" ? shipment.Status : statusObject.Status ?? statusObject.status ?? shipment.status ?? payload.status ?? payload.event_type;
  const reference = String(shipment.AWB ?? shipment.awb ?? shipment.waybill ?? shipment.Waybill ?? shipment.ReferenceNo ?? shipment.reference_no ?? payload.awb ?? payload.waybill ?? payload.tracking_number ?? payload.provider_reference ?? payload.shipment_id ?? "").trim();
  return {
    reference,
    rawStatus,
    description: String(statusObject.Instructions ?? statusObject.description ?? shipment.Instructions ?? shipment.description ?? payload.description ?? payload.message ?? "Delhivery status update").slice(0, 500),
    location: String(statusObject.StatusLocation ?? statusObject.location ?? shipment.StatusLocation ?? shipment.location ?? payload.location ?? payload.city ?? "").slice(0, 200),
    eventTime: typeof (statusObject.StatusDateTime ?? shipment.StatusDateTime ?? payload.event_time ?? payload.timestamp) === "string" ? String(statusObject.StatusDateTime ?? shipment.StatusDateTime ?? payload.event_time ?? payload.timestamp) : null,
  };
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
    if (shipment) {
      const current = await env.DB.prepare("SELECT status FROM shipments WHERE id = ? LIMIT 1").bind(shipment.id).first<{ status: string }>();
      if (!current || !validShipmentTransition(String(current.status).toLowerCase(), status)) {
        await env.DB.prepare("UPDATE webhook_events SET status = 'ignored', processed_at = CURRENT_TIMESTAMP WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
        return json({ ok: true, accepted: true, ignored: true, request_id: requestIdValue }, 202, headers);
      }
      const deliveredAt = status.includes("deliver") ? new Date().toISOString() : null;
      await env.DB.prepare("UPDATE shipments SET provider = ?, provider_reference = COALESCE(?, provider_reference), status = ?, delivered_at = COALESCE(?, delivered_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(provider, reference || null, status, deliveredAt, shipment.id).run();
      await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipment.id, status, location, description, `webhook:${provider}`, delhiveryDetails?.eventTime ?? null).run();
      await env.DB.prepare("UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
    } else {
      await env.DB.prepare("UPDATE webhook_events SET status = 'ignored', processed_at = CURRENT_TIMESTAMP WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
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
  if (Number(stored.meta?.changes ?? 0) > 0) {
    const shipment = reference ? await env.DB.prepare("SELECT id FROM shipments WHERE id = ? OR tracking_number = ? OR provider_reference = ? LIMIT 1").bind(reference, reference, reference).first<{ id: string }>() : null;
    await env.DB.prepare("UPDATE webhook_events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE provider = 'delhivery' AND event_id = ?").bind(shipment ? "processed" : "ignored", eventId).run();
  }
  return json({ ok: true, accepted: true, document_event: true, request_id: requestIdValue }, 202, headers);
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
      const shipment = await env.DB.prepare("SELECT id, tracking_number, status, edd, delivered_at, updated_at FROM shipments WHERE tracking_number = ? OR id = ? OR provider_reference = ? LIMIT 1").bind(reference, reference, reference).first<{ id: string; tracking_number: string | null; status: string; edd: string | null; delivered_at: string | null; updated_at: string | null }>();
      if (!shipment) return json({ ok: true, data: null, request_id: id }, 200, withCors(request, env, { "cache-control": "private, no-store" }));
      const events = await env.DB.prepare("SELECT status, location, description, event_time FROM tracking_events WHERE shipment_id = ? ORDER BY event_time ASC LIMIT 20").bind(shipment.id).all();
      return json({ ok: true, data: { tracking_number: shipment.tracking_number, status: shipment.status, edd: shipment.edd, delivered_at: shipment.delivered_at, updated_at: shipment.updated_at, events: events.results }, request_id: id }, 200, withCors(request, env, { "cache-control": "private, no-store" }));
    }
    if (url.pathname === "/v1/webhooks/delhivery/documents" && request.method === "POST") return handleDelhiveryDocumentWebhook(request, env, id, headers);
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
    const route = url.pathname.slice(3);
    try {
      if (await rateLimited(env, request, auth, route)) return new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "Too many requests" }, request_id: id }), { status: 429, headers: { ...headers, "content-type": "application/json", "retry-after": "60" } });
      if (route === "/me" && request.method === "GET") return json({ ok: true, authenticated: true, user_id: auth.userId, client_id: auth.clientId, client_ids: [...auth.clientIds], roles: [...auth.roles], permissions: [...auth.permissions], system: auth.system }, 200, withCors(request, env));
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
        const delhiveryWebhookConfigured = Boolean(env.DELHIVERY_WEBHOOK_SECRET);
        const ekartWebhookConfigured = Boolean(env.EKART_WEBHOOK_SECRET);
        const trackonConfigured = Boolean(env.TRACKON_API_BASE_URL && env.TRACKON_CREDENTIALS_JSON);
        const trackonWebhookConfigured = Boolean(env.TRACKON_WEBHOOK_SECRET);
        const xpressbeesConfigured = Boolean(env.XPRESSBEES_API_BASE_URL && env.XPRESSBEES_CREDENTIALS_JSON);
        const rivigoConfigured = Boolean(env.RIVIGO_API_BASE_URL && env.RIVIGO_CREDENTIALS_JSON && env.RIVIGO_AUTH_URL && env.RIVIGO_TRACKING_URL);
        return json({ ok: true, data: {
          delhivery: { configured: delhiveryConfigured, enabled: callsEnabled && delhiveryConfigured, webhook_configured: delhiveryWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!delhiveryConfigured ? ["provider_credentials_missing"] : []), ...(!delhiveryWebhookConfigured ? ["webhook_secret_missing"] : [])], capabilities: ["tracking", ...(delhiveryWebhookConfigured ? ["scan_webhooks", "document_webhooks"] : [])] },
          ekart: { configured: ekartConfigured, enabled: callsEnabled && ekartConfigured, webhook_configured: ekartWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!ekartConfigured ? ["provider_credentials_missing"] : []), ...(!ekartWebhookConfigured ? ["webhook_secret_missing"] : [])], capabilities: ["tracking", "shipment_creation", ...(ekartWebhookConfigured ? ["webhooks"] : [])] },
          trackon: { configured: trackonConfigured, enabled: callsEnabled && trackonConfigured, webhook_configured: trackonWebhookConfigured, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!trackonConfigured ? ["provider_credentials_or_endpoint_missing"] : []), ...(!trackonWebhookConfigured ? ["webhook_secret_missing"] : [])], capabilities: ["tracking", "labels", ...(trackonWebhookConfigured ? ["webhooks"] : [])] },
          xpressbees: { configured: xpressbeesConfigured, enabled: callsEnabled && xpressbeesConfigured, webhook_configured: false, activation_blockers: [...(!callsEnabled ? ["provider_calls_disabled"] : []), ...(!xpressbeesConfigured ? ["provider_credentials_or_endpoint_missing"] : [])], capabilities: ["tracking", "quotes"] },
          rivigo: { configured: rivigoConfigured, enabled: false, webhook_configured: false, activation_blockers: ["developer_portal_app_required", "sandbox_or_production_endpoints_not_verified", "go_live_approval_required"], capabilities: ["tracking", "shipment_creation", "shipment_update", "shipment_cancellation"] },
        } }, 200, headers);
      }
      if (route === "/provider-account-policies" && request.method === "GET") {
        if (!hasScope(auth, "provider_accounts.read") && !hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Provider account visibility permission required", 403, id, headers);
        const requestedClient = new URL(request.url).searchParams.get("client_id");
        const clientId = requireClient(auth, requestedClient);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const rows = await env.DB.prepare(`
          SELECT pa.id, pa.provider, pa.account_name, pa.account_type, pa.client_id,
                 pa.capabilities_json, pa.status,
                 CASE WHEN p.provider_account_id IS NULL THEN CASE WHEN pa.status = 'active' THEN 1 ELSE 0 END ELSE p.enabled END AS enabled,
                 CASE WHEN p.provider_account_id IS NULL THEN 100 ELSE p.priority END AS priority,
                 CASE WHEN p.provider_account_id IS NULL THEN 0 ELSE p.confidence_score END AS confidence_score,
                 p.rate_card_id, p.notes, p.updated_at AS policy_updated_at,
                 CASE WHEN p.provider_account_id IS NULL THEN 0 ELSE 1 END AS explicitly_configured
          FROM provider_accounts pa
          LEFT JOIN provider_account_client_policies p
            ON p.provider_account_id = pa.id AND p.client_id = ?
          WHERE pa.status = 'active' AND (pa.client_id = ? OR pa.client_id IS NULL)
          ORDER BY pa.provider, enabled DESC, priority ASC, confidence_score DESC, pa.account_name`).bind(clientId, clientId).all();
        return json({ ok: true, data: rows.results.map((row) => ({ ...row, capabilities: (() => { try { return JSON.parse(String((row as Record<string, unknown>).capabilities_json ?? "[]")); } catch { return []; } })(), enabled: Boolean(Number((row as Record<string, unknown>).enabled)), explicitly_configured: Boolean(Number((row as Record<string, unknown>).explicitly_configured)) })) }, 200, headers);
      }
      const providerPolicyMatch = route.match(/^\/provider-account-policies\/([^/]+)$/);
      if (providerPolicyMatch && request.method === "PUT") {
        if (!hasScope(auth, "provider_accounts.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Provider account policy management permission required", 403, id, headers);
        const account = await env.DB.prepare("SELECT id, provider, client_id, status FROM provider_accounts WHERE id = ? LIMIT 1").bind(providerPolicyMatch[1]).first<{ id: string; provider: CourierProvider; client_id: string | null; status: string }>();
        if (!account || account.status !== "active") return error("NOT_FOUND", "Active provider account not found", 404, id, headers);
        const payload = await bodyJson(request);
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
          ? await env.DB.prepare("SELECT id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, status, created_by_user_id, created_at, updated_at FROM provider_accounts ORDER BY provider, account_name LIMIT 100").all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, status, created_by_user_id, created_at, updated_at FROM provider_accounts WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY provider, account_name LIMIT 100`).bind(...auth.clientIds).all()
            : { results: [] };
        return json({ ok: true, data: rows.results.map((row) => { const value = row as Record<string, unknown>; let capabilities: unknown[] = []; try { capabilities = JSON.parse(String(value.capabilities_json ?? "[]")); } catch { capabilities = []; } return { ...value, capabilities }; }) }, 200, headers);
      }
      if (route === "/provider-accounts" && request.method === "POST") {
        if (!hasScope(auth, "provider_accounts.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Provider account management permission required", 403, id, headers);
        const payload = await bodyJson(request); const provider = String(payload.provider ?? "").toLowerCase(); const accountName = String(payload.account_name ?? "").trim(); const accountType = String(payload.account_type ?? "production").toLowerCase(); const secretName = String(payload.credential_secret_name ?? "").trim(); const clientId = payload.client_id === null || payload.client_id === undefined || payload.client_id === "" ? null : String(payload.client_id);
        if (!new Set(["delhivery", "ekart", "trackon", "xpressbees", "rivigo"]).has(provider) || !accountName || accountName.length > 120 || !new Set(["production", "staging"]).has(accountType) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(secretName)) return error("VALIDATION_ERROR", "Invalid provider account details", 400, id, headers);
        if (!auth.system && (!clientId || !canAccessClient(auth, clientId))) return error("FORBIDDEN", "Provider account client scope is not allowed", 403, id, headers);
        if (clientId) { const client = await supabaseGet<{ id: string; status: string }>(env, `client_accounts?id=eq.${encodeURIComponent(clientId)}&status=eq.active&select=id,status`, auth.accessToken ?? ""); if (!client.length) return error("NOT_FOUND", "Client account not found", 404, id, headers); }
        const duplicate = await env.DB.prepare("SELECT id FROM provider_accounts WHERE provider = ? AND account_name = ? LIMIT 1").bind(provider, accountName).first<{ id: string }>(); if (duplicate) return error("CONFLICT", "Provider account name already exists", 409, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers); const requestHash = await payloadFingerprint(payload); const endpoint = "POST /v1/provider-accounts"; const existing = await idempotentResponse(env, idempotencyKey, auth.userId ?? "system", endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const accountId = crypto.randomUUID(); const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.filter((value): value is string => typeof value === "string").slice(0, 20) : []; await env.DB.prepare("INSERT INTO provider_accounts (id, provider, account_name, account_type, credential_secret_name, client_id, capabilities_json, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(accountId, provider, accountName, accountType, secretName, clientId, JSON.stringify(capabilities), auth.userId ?? "system").run(); await audit(env, ctx, auth, id, "provider_account.created", "provider_account", accountId, { provider, account_name: accountName, client_id: clientId, credential_secret_name: secretName }); const serialized = JSON.stringify({ ok: true, data: { id: accountId, provider, account_name: accountName, account_type: accountType, credential_secret_name: secretName, client_id: clientId, capabilities, status: "active" }, request_id: id }); await saveIdempotent(env, idempotencyKey, auth.userId ?? "system", endpoint, 201, serialized, requestHash); return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }
      const providerAccountMatch = route.match(/^\/provider-accounts\/([^/]+)$/);
      if (providerAccountMatch && request.method === "PATCH") {
        if (!hasScope(auth, "provider_accounts.manage") || !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Provider account management permission required", 403, id, headers);
        const account = await env.DB.prepare("SELECT id, client_id FROM provider_accounts WHERE id = ? LIMIT 1").bind(providerAccountMatch[1]).first<{ id: string; client_id: string | null }>(); if (!account) return error("NOT_FOUND", "Provider account not found", 404, id, headers); if (!auth.system && (!account.client_id || !canAccessClient(auth, account.client_id))) return error("NOT_FOUND", "Provider account not found", 404, id, headers); const payload = await bodyJson(request); const status = payload.status === undefined ? undefined : String(payload.status); if (status !== undefined && !new Set(["active", "disabled"]).has(status)) return error("VALIDATION_ERROR", "Invalid provider account status", 400, id, headers); const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers); const requestHash = await payloadFingerprint(payload); const endpoint = `PATCH /v1/provider-accounts/${account.id}`; const existing = await idempotentResponse(env, idempotencyKey, auth.userId ?? "system", endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } }); if (status !== undefined) await env.DB.prepare("UPDATE provider_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, account.id).run(); await audit(env, ctx, auth, id, "provider_account.updated", "provider_account", account.id, { status }); const serialized = JSON.stringify({ ok: true, data: { id: account.id, ...(status ? { status } : {}) }, request_id: id }); await saveIdempotent(env, idempotencyKey, auth.userId ?? "system", endpoint, 200, serialized, requestHash); return new Response(serialized, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      if (route === "/integration-requests" && request.method === "GET") {
        if (!hasScope(auth, "integrations.read")) return error("FORBIDDEN", "Integration visibility permission required", 403, id, headers);
        const rows = auth.system
          ? await env.DB.prepare("SELECT id, provider, client_id, operation, provider_request_id, status, attempt_count, error_code, error_message, created_at, updated_at FROM integration_requests ORDER BY updated_at DESC LIMIT 100").all()
          : auth.clientIds.size
            ? await env.DB.prepare(`SELECT id, provider, client_id, operation, provider_request_id, status, attempt_count, error_code, error_message, created_at, updated_at FROM integration_requests WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT 100`).bind(...auth.clientIds).all()
            : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }
      if (route === "/webhook-events" && request.method === "GET") {
        if (!hasScope(auth, "webhooks.read") || !auth.system) return error("FORBIDDEN", "Only organization administrators may view webhook events", 403, id, headers);
        const rows = await env.DB.prepare("SELECT id, provider, event_id, event_type, signature_valid, status, processed_at, created_at FROM webhook_events ORDER BY created_at DESC LIMIT 100").all();
        return json({ ok: true, data: rows.results }, 200, headers);
      }

      if (route === "/shipments" && request.method === "GET") {
        if (!hasScope(auth, "shipments.read")) return error("FORBIDDEN", "Shipment read scope required", 403, id, headers);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);
        const rows = auth.system ? await env.DB.prepare("SELECT * FROM shipments ORDER BY created_at DESC LIMIT ?").bind(limit).all() : auth.clientIds.size ? await env.DB.prepare(`SELECT * FROM shipments WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`).bind(...[...auth.clientIds], limit).all() : { results: [] };
        if (url.searchParams.get("include_tracking") === "1") {
          const data = await Promise.all((rows.results as Array<Record<string, unknown>>).map(async (shipment) => {
            const events = await env.DB.prepare("SELECT status, location, description, event_time FROM tracking_events WHERE shipment_id = ? ORDER BY event_time ASC LIMIT 20").bind(String(shipment.id)).all();
            return { ...shipment, tracking_events: events.results };
          }));
          return json({ ok: true, data }, 200, headers);
        }
        return json({ ok: true, data: rows.results }, 200, headers);
      }

      if (route === "/shipments" && request.method === "POST") {
        if (!hasScope(auth, "shipments.create")) return error("FORBIDDEN", "Shipment creation scope required", 403, id, headers);
        const payload = await bodyJson(request);
        const requestHash = await payloadFingerprint(payload);
        const description = typeof payload.description === "string" ? payload.description.trim() : "";
        const origin = typeof payload.origin === "string" ? payload.origin.trim() : "";
        const destination = typeof payload.destination === "string" ? payload.destination.trim() : "";
        const weight = Number(payload.total_weight_kg);
        const pieces = Number(payload.pieces);
        const declaredValue = Number(payload.declared_value ?? 0);
        if (!description || description.length > 500 || !origin || origin.length > 500 || !destination || destination.length > 500) return error("VALIDATION_ERROR", "Description, origin, and destination are required", 400, id, headers);
        if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) return error("VALIDATION_ERROR", "Weight must be greater than 0 and within the supported limit", 400, id, headers);
        if (!Number.isInteger(pieces) || pieces < 1 || pieces > 10000) return error("VALIDATION_ERROR", "Pieces must be a whole number between 1 and 10,000", 400, id, headers);
        if (!Number.isFinite(declaredValue) || declaredValue < 0) return error("VALIDATION_ERROR", "Declared value must be a non-negative number", 400, id, headers);
        const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const key = request.headers.get("Idempotency-Key");
        if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/shipments", requestHash);
        if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const shipmentId = crypto.randomUUID();
        const provider = typeof payload.provider === "string" && ["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(payload.provider) ? payload.provider : null;
        await env.DB.prepare("INSERT INTO shipments (id, client_id, created_by_user_id, provider, provider_account_id, status, description, origin, destination, origin_address_json, destination_address_json, consignee, total_weight_kg, declared_value, pieces, edd) VALUES (?, ?, ?, ?, NULL, 'booked', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(shipmentId, clientId, auth.userId ?? `api:${clientId}`, provider, description, origin, destination, JSON.stringify(payload.origin_address ?? null), JSON.stringify(payload.destination_address ?? null), String(payload.consignee ?? ""), weight, declaredValue, pieces, typeof payload.edd === "string" ? payload.edd : null).run();
        await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, 'booked', 'Shipment created', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipmentId, auth.userId ?? `api:${clientId}`).run();
        const providerResult = provider ? await providerRequest(env, provider as CourierProvider, "shipments", { shipment_id: shipmentId, ...payload }, id, clientId, key) : { enabled: false, status: "not_requested" as const };
        const selectedProviderAccountId = (providerResult as { provider_account_id?: string }).provider_account_id;
        if (selectedProviderAccountId) await env.DB.prepare("UPDATE shipments SET provider_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?").bind(selectedProviderAccountId, shipmentId, clientId).run();
        const serialized = JSON.stringify({ ok: true, data: { id: shipmentId, client_id: clientId, status: "booked", provider, provider_result: providerResult }, request_id: id });
        await saveIdempotent(env, key, clientId, "POST /v1/shipments", 201, serialized, requestHash);
        await audit(env, ctx, auth, id, "shipment.created", "shipment", shipmentId, { client_id: clientId, provider });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const shipmentUpdate = route.match(/^\/shipments\/([^/]+)$/);
      if (shipmentUpdate && request.method === "PATCH") {
        if (!hasRole(auth, ["employee", "admin", "super_admin"])) return error("FORBIDDEN", "Employee or administrator role required", 403, id, headers);
        const current = await env.DB.prepare("SELECT client_id, status FROM shipments WHERE id = ? LIMIT 1").bind(shipmentUpdate[1]).first<{ client_id: string; status: string }>();
        if (!current || !canAccessClient(auth, current.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const payload = await bodyJson(request);
        const requestHash = await payloadFingerprint(payload);
        const allowed = ["provider", "provider_reference", "tracking_number", "status", "description", "origin", "destination", "consignee", "total_weight_kg", "declared_value", "pieces", "edd", "delivered_at"] as const;
        const updates = allowed.filter((field) => typeof payload[field] === "string" || typeof payload[field] === "number").map((field) => ({ field, value: payload[field] }));
        if (!updates.length) return error("VALIDATION_ERROR", "A supported shipment update is required", 400, id, headers);
        if (payload.provider !== undefined && payload.provider !== null && !new Set(["delhivery", "ekart", "trackon", "xpressbees", "rivigo"]).has(String(payload.provider))) return error("VALIDATION_ERROR", "Unsupported shipment provider", 400, id, headers);
        const status = payload.status === undefined ? null : String(payload.status).toLowerCase();
        if (status && !["booked", "picked_up", "in_transit", "out_for_delivery", "delivered", "cancelled", "exception", "rto"].includes(status)) return error("VALIDATION_ERROR", "Unsupported shipment status", 400, id, headers);
        if (status && !validShipmentTransition(String(current.status).toLowerCase(), status)) return error("CONFLICT", `Shipment cannot transition from ${current.status} to ${status}`, 409, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `PATCH /v1/shipments/${shipmentUpdate[1]}`; const existing = await idempotentResponse(env, key, current.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const normalized = updates;
        const deliveredClause = status === "delivered" ? ", delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)" : "";
        await env.DB.prepare(`UPDATE shipments SET ${normalized.map((update) => `${update.field} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP${deliveredClause} WHERE id = ?`).bind(...normalized.map((update) => update.value), shipmentUpdate[1]).run();
        if (status) await env.DB.prepare("INSERT INTO tracking_events (id, shipment_id, status, description, created_by_user_id, event_time, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), shipmentUpdate[1], status, "Shipment updated", auth.userId ?? `api:${current.client_id}`).run();
        await audit(env, ctx, auth, id, "shipment.updated", "shipment", shipmentUpdate[1], { client_id: current.client_id, fields: normalized.map((update) => update.field) });
        const serialized = JSON.stringify({ ok: true, data: { id: shipmentUpdate[1], ...Object.fromEntries(normalized.map((update) => [update.field, update.value])), ...(status === "delivered" ? { delivered_at: "CURRENT_TIMESTAMP" } : {}) }, request_id: id }); await saveIdempotent(env, key, current.client_id, endpoint, 200, serialized, requestHash);
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
        const documents = await env.DB.prepare("SELECT id, shipment_id, original_filename, content_type, file_size_bytes, uploaded_by_user_id, created_at FROM shipment_documents WHERE shipment_id = ? ORDER BY created_at DESC LIMIT 100").bind(shipmentDocuments[1]).all();
        return json({ ok: true, data: documents.results }, 200, headers);
      }

      const shipmentLabel = route.match(/^\/shipments\/([^/]+)\/label$/);
      if (shipmentLabel && request.method === "GET") {
        if (!hasScope(auth, "tracking.read")) return error("FORBIDDEN", "Tracking read scope required", 403, id, headers);
        const shipment = await env.DB.prepare("SELECT id, client_id, provider, tracking_number, provider_reference FROM shipments WHERE id = ? LIMIT 1").bind(shipmentLabel[1]).first<{ id: string; client_id: string; provider: string | null; tracking_number: string | null; provider_reference: string | null }>();
        if (!shipment || !canAccessClient(auth, shipment.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        if (shipment.provider !== "trackon") return error("UNSUPPORTED_PROVIDER_OPERATION", "Label generation is currently available only for Trackon", 409, id, headers);
        const providerResult = await providerRequest(env, "trackon", "labels", { shipment_id: shipment.id, tracking_number: shipment.tracking_number, provider_reference: shipment.provider_reference }, id, shipment.client_id);
        return json({ ok: true, data: providerResult }, 200, headers);
      }

      const shipmentGet = route.match(/^\/shipments\/([^/]+)(?:\/tracking)?$/);
      if (shipmentGet && request.method === "GET") {
        if (!hasScope(auth, route.endsWith("/tracking") ? "tracking.read" : "shipments.read")) return error("FORBIDDEN", "Shipment read scope required", 403, id, headers);
        const shipment = await env.DB.prepare("SELECT * FROM shipments WHERE id = ? LIMIT 1").bind(shipmentGet[1]).first<{ client_id: string; provider: string | null; tracking_number: string | null; provider_reference: string | null }>();
        if (!shipment || !canAccessClient(auth, shipment.client_id)) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        if (route.endsWith("/tracking")) {
          const events = await env.DB.prepare("SELECT * FROM tracking_events WHERE shipment_id = ? ORDER BY event_time ASC LIMIT 100").bind(shipmentGet[1]).all();
          const provider = ["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(String(shipment.provider)) ? shipment.provider as CourierProvider : null;
          const providerResult = provider ? await providerRequest(env, provider, "tracking", { shipment_id: shipmentGet[1], tracking_number: shipment.tracking_number, provider_reference: shipment.provider_reference }, id, shipment.client_id) : { enabled: false, status: "not_requested" as const };
          return json({ ok: true, data: events.results, provider_result: providerResult }, 200, headers);
        }
        return json({ ok: true, data: shipment }, 200, headers);
      }

      if (route === "/pickups" && request.method === "GET") {
        if (!hasScope(auth, "pickups.read")) return error("FORBIDDEN", "Pickup read scope required", 403, id, headers);
        const rows = auth.system ? await env.DB.prepare("SELECT * FROM pickup_requests ORDER BY requested_date DESC LIMIT 100").all() : auth.clientIds.size ? await env.DB.prepare(`SELECT * FROM pickup_requests WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY requested_date DESC LIMIT 100`).bind(...auth.clientIds).all() : { results: [] };
        return json({ ok: true, data: rows.results }, 200, headers);
      }

      if (route === "/pickups" && request.method === "POST") {
        if (!hasScope(auth, "pickups.create")) return error("FORBIDDEN", "Pickup creation scope required", 403, id, headers);
        const payload = await bodyJson(request); const requestHash = await payloadFingerprint(payload); const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        if (typeof payload.scheduled_date !== "string" || typeof payload.location !== "string") return error("VALIDATION_ERROR", "Pickup date and location are required", 400, id, headers);
        if (payload.shipment_id !== undefined && !(await shipmentBelongsToClient(env, payload.shipment_id, clientId))) return error("NOT_FOUND", "Shipment not found", 404, id, headers);
        const key = request.headers.get("Idempotency-Key"); if (!key) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const existing = await idempotentResponse(env, key, clientId, "POST /v1/pickups", requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
        const pickupId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO pickup_requests (id, shipment_id, client_id, created_by_user_id, requested_date, requested_time_slot, pickup_address, contact_name, contact_phone, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)").bind(pickupId, typeof payload.shipment_id === "string" ? payload.shipment_id : null, clientId, auth.userId ?? `api:${clientId}`, payload.scheduled_date, String(payload.window ?? ""), payload.location, String(payload.contact_name ?? payload.customer ?? "Pickup contact"), String(payload.contact_phone ?? payload.contact ?? ""), typeof payload.notes === "string" ? payload.notes.trim().slice(0, 2000) : null).run();
        const shipment = typeof payload.shipment_id === "string" ? await env.DB.prepare("SELECT provider, tracking_number, provider_reference FROM shipments WHERE id = ? AND client_id = ? LIMIT 1").bind(payload.shipment_id, clientId).first<{ provider: string | null; tracking_number: string | null; provider_reference: string | null }>() : null;
        const requestedProvider = ["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(String(payload.provider)) ? payload.provider as CourierProvider : null;
        const provider = requestedProvider ?? (["delhivery", "ekart", "trackon", "xpressbees", "rivigo"].includes(String(shipment?.provider)) ? shipment?.provider as CourierProvider : null);
        const providerResult = provider ? await providerRequest(env, provider, "pickups", { pickup_id: pickupId, shipment_id: payload.shipment_id, tracking_number: shipment?.tracking_number, provider_reference: shipment?.provider_reference, ...payload }, id, clientId, key) : { enabled: false, status: "not_requested" as const };
        const serialized = JSON.stringify({ ok: true, data: { id: pickupId, client_id: clientId, status: "scheduled", provider, provider_result: providerResult }, request_id: id });
        await saveIdempotent(env, key, clientId, "POST /v1/pickups", 201, serialized, requestHash); await audit(env, ctx, auth, id, "pickup.created", "pickup", pickupId, { client_id: clientId });
        return new Response(serialized, { status: 201, headers: { ...headers, "content-type": "application/json" } });
      }

      const pickupMatch = route.match(/^\/pickups\/([^/]+)$/);
      if (pickupMatch && request.method === "GET") {
        if (!hasScope(auth, "pickups.read")) return error("FORBIDDEN", "Pickup read scope required", 403, id, headers);
        const pickup = await env.DB.prepare("SELECT * FROM pickup_requests WHERE id = ? LIMIT 1").bind(pickupMatch[1]).first<{ client_id: string }>();
        if (!pickup || !canAccessClient(auth, pickup.client_id)) return error("NOT_FOUND", "Pickup not found", 404, id, headers);
        return json({ ok: true, data: pickup }, 200, headers);
      }
      if (pickupMatch && request.method === "PATCH") {
        const pickup = await env.DB.prepare("SELECT client_id, assigned_to_user_id, failure_reason, provider, provider_reference FROM pickup_requests WHERE id = ? LIMIT 1").bind(pickupMatch[1]).first<{ client_id: string; assigned_to_user_id?: string | null; failure_reason?: string | null; provider?: string | null; provider_reference?: string | null }>();
        if (!pickup || !canAccessClient(auth, pickup.client_id)) return error("NOT_FOUND", "Pickup not found", 404, id, headers);
        const staffUpdate = hasRole(auth, ["employee", "admin", "super_admin"]);
        const payload = await bodyJson(request);
        const requestHash = await payloadFingerprint(payload);
        const allowedStatuses = new Set(["requested", "scheduled", "assigned", "in_transit", "picked_up", "completed", "cancelled", "failed"]);
        if (payload.status !== undefined && (typeof payload.status !== "string" || !allowedStatuses.has(payload.status))) return error("VALIDATION_ERROR", "Unsupported pickup status", 400, id, headers);
        const clientCancel = !staffUpdate && payload.status === "cancelled" && Object.keys(payload).every((key) => key === "status") && hasScope(auth, "pickups.read");
        if (!staffUpdate && !hasScope(auth, "pickups.manage") && !clientCancel) return error("FORBIDDEN", "Pickup update permission required", 403, id, headers);
        if (!staffUpdate && !clientCancel) return error("FORBIDDEN", "Client users may only cancel their own pickup", 403, id, headers);
        const updates: string[] = []; const values: unknown[] = [];
        if (typeof payload.status === "string") { updates.push("status = ?"); values.push(payload.status); }
        if (staffUpdate && payload.assigned_to_user_id !== undefined) { if (payload.assigned_to_user_id !== null && typeof payload.assigned_to_user_id !== "string") return error("VALIDATION_ERROR", "Assigned employee must be a user ID", 400, id, headers); if (!(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, pickup.client_id))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers); updates.push("assigned_to_user_id = ?"); values.push(payload.assigned_to_user_id || null); }
        if (staffUpdate && payload.failure_reason !== undefined) { if (payload.failure_reason !== null && typeof payload.failure_reason !== "string") return error("VALIDATION_ERROR", "Failure reason must be text", 400, id, headers); updates.push("failure_reason = ?"); values.push(typeof payload.failure_reason === "string" ? payload.failure_reason.trim() || null : null); }
        if (staffUpdate && payload.provider_reference !== undefined) { if (payload.provider_reference !== null && typeof payload.provider_reference !== "string") return error("VALIDATION_ERROR", "Provider reference must be text", 400, id, headers); updates.push("provider_reference = ?"); values.push(payload.provider_reference || null); }
        if (!updates.length) return error("VALIDATION_ERROR", "A pickup status, assignment, failure reason, or provider reference is required", 400, id, headers);
        const idempotencyKey = request.headers.get("Idempotency-Key"); if (!idempotencyKey) return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 400, id, headers);
        const endpoint = `PATCH /v1/pickups/${pickupMatch[1]}`; const existing = await idempotentResponse(env, idempotencyKey, pickup.client_id, endpoint, requestHash); if (existing) return new Response(existing.response_body, { status: existing.response_status, headers: { ...headers, "content-type": "application/json" } });
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
        const collection = async (table: string, order: string, scope: string) => {
          if (!hasScope(auth, scope)) return { results: [] as Record<string, unknown>[] };
          if (auth.system) return env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order} LIMIT 100`).all<Record<string, unknown>>();
          if (!auth.clientIds.size) return { results: [] as Record<string, unknown>[] };
          const placeholders = [...auth.clientIds].map(() => "?").join(",");
          return env.DB.prepare(`SELECT * FROM ${table} WHERE client_id IN (${placeholders}) ORDER BY ${order} LIMIT 100`).bind(...auth.clientIds).all<Record<string, unknown>>();
        };
        const [shipments, pickups, billing, wallet, exceptions, ndr, activity] = await Promise.all([
          collection("shipments", "created_at DESC", "shipments.read"),
          collection("pickup_requests", "requested_date DESC", "pickups.read"),
          collection("billing_records", "created_at DESC", "billing.read"),
          collection("wallet_transactions", "created_at DESC", "wallet.read"),
          collection("exception_cases", "updated_at DESC", "cases.read"),
          collection("ndr_cases", "updated_at DESC", "cases.read"),
          collection("activity_events", "created_at DESC", "activity.read"),
        ]);
        const [returns, tickets, notifications, tasks] = await Promise.all([
          collection("return_shipments", "updated_at DESC", "cases.read"),
          collection("support_tickets", "updated_at DESC", "tickets.read"),
          hasScope(auth, "notifications.read")
            ? (auth.system
              ? env.DB.prepare("SELECT *, is_read, recipient_user_id FROM notifications ORDER BY created_at DESC LIMIT 100").all<Record<string, unknown>>()
              : auth.clientIds.size
                ? env.DB.prepare(`SELECT *, is_read, recipient_user_id FROM notifications WHERE (client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR recipient_user_id = ?) ORDER BY created_at DESC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "").all<Record<string, unknown>>()
                : Promise.resolve({ results: [] as Record<string, unknown>[] }))
            : Promise.resolve({ results: [] as Record<string, unknown>[] }),
          hasScope(auth, "tasks.read")
            ? (auth.system
              ? env.DB.prepare("SELECT * FROM tasks ORDER BY due_at ASC LIMIT 100").all<Record<string, unknown>>()
              : auth.clientIds.size
                ? env.DB.prepare(`SELECT * FROM tasks WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) OR assigned_to_user_id = ? ORDER BY due_at ASC LIMIT 100`).bind(...auth.clientIds, auth.userId ?? "").all<Record<string, unknown>>()
                : Promise.resolve({ results: [] as Record<string, unknown>[] }))
            : Promise.resolve({ results: [] as Record<string, unknown>[] }),
        ]);
        return json({ ok: true, data: {
          shipments: shipments.results,
          pickups: pickups.results,
          billing: billing.results,
          wallet: wallet.results,
          exceptions: exceptions.results,
          ndr: ndr.results,
          activity: activity.results,
          returns: returns.results,
          tickets: tickets.results,
          notifications: notifications.results,
          tasks: tasks.results,
        }, request_id: id }, 200, headers);
      }

      if (route === "/reports/shipments" && request.method === "GET") {
        if (!hasScope(auth, "reports.read")) return error("FORBIDDEN", "Report read scope required", 403, id, headers);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
        const summarySql = "SELECT status, COUNT(*) AS shipments, SUM(CASE WHEN edd IS NOT NULL AND date(COALESCE(delivered_at, CURRENT_TIMESTAMP)) > date(edd) THEN 1 ELSE 0 END) AS delayed FROM shipments";
        const detailSql = "SELECT id, client_id, tracking_number, status, edd, delivered_at, CASE WHEN edd IS NULL THEN 0 ELSE MAX(0, CAST(julianday(date(COALESCE(delivered_at, CURRENT_TIMESTAMP))) - julianday(date(edd)) AS INTEGER)) END AS delay_days FROM shipments";
        const summary = auth.system
          ? await env.DB.prepare(`${summarySql} GROUP BY status ORDER BY status`).all()
          : auth.clientIds.size
            ? await env.DB.prepare(`${summarySql} WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) GROUP BY status ORDER BY status`).bind(...auth.clientIds).all()
            : { results: [] };
        const details = auth.system
          ? await env.DB.prepare(`${detailSql} ORDER BY created_at DESC LIMIT ?`).bind(limit).all()
          : auth.clientIds.size
            ? await env.DB.prepare(`${detailSql} WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`).bind(...auth.clientIds, limit).all()
            : { results: [] };
        return json({ ok: true, data: summary.results, details: details.results }, 200, headers);
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
      const collection = collectionRoutes[route];
      if (collection && request.method === "GET") {
        if (!hasScope(auth, collection.scope)) return error("FORBIDDEN", "Permission required", 403, id, headers);
        const rows = auth.system ? await env.DB.prepare(`SELECT * FROM ${collection.table} ORDER BY ${collection.order} LIMIT 100`).all() : auth.clientIds.size ? await env.DB.prepare(`SELECT * FROM ${collection.table} WHERE client_id IN (${[...auth.clientIds].map(() => "?").join(",")}) ORDER BY ${collection.order} LIMIT 100`).bind(...auth.clientIds).all() : { results: [] };
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
        if (route === "/warehouses") {
          if (typeof payload.name !== "string" || typeof payload.address !== "string") return error("VALIDATION_ERROR", "Warehouse name and address are required", 400, id, headers);
          await env.DB.prepare("INSERT INTO warehouses (id, client_id, name, address, city, pincode, contact) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(recordId, clientId, payload.name, payload.address, String(payload.city ?? ""), String(payload.pincode ?? ""), String(payload.contact ?? "")).run();
        } else {
          if (typeof payload.label !== "string" || typeof payload.address !== "string") return error("VALIDATION_ERROR", "Address label and address are required", 400, id, headers);
          const addressKind = payload.address_kind === "consignee" ? "consignee" : "consignor";
          await env.DB.prepare("INSERT INTO client_addresses (id, client_id, label, address_kind, contact_name, phone, address, city, state, pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(recordId, clientId, payload.label, addressKind, String(payload.contact_name ?? ""), String(payload.phone ?? ""), payload.address, String(payload.city ?? ""), String(payload.state ?? ""), String(payload.pincode ?? "")).run();
        }
        await audit(env, ctx, auth, id, `${route.slice(1)}.created`, route.slice(1, -1), recordId, { client_id: clientId });
        const serialized = JSON.stringify({ ok: true, data: { id: recordId, client_id: clientId }, request_id: id }); await saveIdempotent(env, key, clientId, endpoint, 201, serialized, requestHash);
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

      const entityUpdate = route.match(/^\/(tickets|ndr|exceptions|returns|warehouses|addresses|billing|wallet|cod-remittances|weight-reconciliation)\/([^/]+)$/);
      if (entityUpdate && request.method === "PATCH") {
        const map: Record<string, string> = { tickets: "support_tickets", ndr: "ndr_cases", exceptions: "exception_cases", returns: "return_shipments", warehouses: "warehouses", addresses: "client_addresses", billing: "billing_records", wallet: "wallet_transactions", "cod-remittances": "cod_remittances", "weight-reconciliation": "weight_reconciliations" };
        if ((entityUpdate[1] === "billing" || entityUpdate[1] === "wallet") && !hasRole(auth, ["admin", "super_admin"])) return error("FORBIDDEN", "Administrator finance permission required", 403, id, headers);
        const table = map[entityUpdate[1]]; const current = await env.DB.prepare(`SELECT client_id FROM ${table} WHERE id = ? LIMIT 1`).bind(entityUpdate[2]).first<{ client_id: string }>();
        const scopeByEntity: Record<string, string> = { billing: "billing.manage", wallet: "wallet.manage", "cod-remittances": "cod.manage", "weight-reconciliation": "weight.manage" };
        if (!current || !canAccessClient(auth, current.client_id) || (scopeByEntity[entityUpdate[1]] && !hasScope(auth, scopeByEntity[entityUpdate[1]])) || (!scopeByEntity[entityUpdate[1]] && entityUpdate[1] !== "warehouses" && entityUpdate[1] !== "addresses" && !hasRole(auth, ["employee", "admin", "super_admin"]))) return error("NOT_FOUND", "Record not found", 404, id, headers);
        const payload = await bodyJson(request); const financeStatuses: Record<string, string[]> = { billing: ["pending", "approved", "paid", "void", "cancelled"], wallet: ["pending", "approved", "posted", "rejected", "void"] }; const requestedStatus = payload.status === undefined ? undefined : String(payload.status); if (requestedStatus !== undefined && financeStatuses[entityUpdate[1]] && !financeStatuses[entityUpdate[1]].includes(requestedStatus)) return error("VALIDATION_ERROR", "Invalid finance record status", 400, id, headers); const requestHash = await payloadFingerprint(payload); const allowedFields = entityUpdate[1] === "warehouses" ? ["name", "address", "city", "pincode", "contact"] : entityUpdate[1] === "addresses" ? ["label", "address_kind", "contact_name", "phone", "address", "city", "state", "pincode"] : entityUpdate[1] === "weight-reconciliation" ? ["status", "measured_weight_kg", "billable_weight_kg"] : entityUpdate[1] === "wallet" ? ["status"] : entityUpdate[1] === "cod-remittances" ? ["status", "settled_at"] : entityUpdate[1] === "ndr" ? ["status", "assigned_to_user_id", "deadline", "notes", "attempt"] : entityUpdate[1] === "exceptions" ? ["status", "assigned_to_user_id", "severity", "details"] : entityUpdate[1] === "returns" ? ["status", "provider_reference"] : ["status", "assigned_to_user_id", "priority"]; if ((entityUpdate[1] === "ndr" || entityUpdate[1] === "exceptions" || entityUpdate[1] === "tickets") && payload.assigned_to_user_id !== undefined && !(await employeeCanBeAssigned(env, auth, payload.assigned_to_user_id, current.client_id))) return error("FORBIDDEN", "Assigned employee is not active or is outside the client scope", 403, id, headers); const updates = allowedFields.filter((field) => typeof payload[field] === "string" || typeof payload[field] === "number").map((field) => ({ field, value: field === "address_kind" && payload[field] !== "consignee" ? "consignor" : payload[field] }));
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
        if (!hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Quote scope required", 403, id, headers);
        const payload = await bodyJson(request);
        const provider = String(payload.provider ?? "xpressbees").toLowerCase();
        if (provider !== "xpressbees") return error("PROVIDER_UNAVAILABLE", "Live rate quotes are currently available only for the configured XpressBees quote contract", 503, id, headers);
        const origin = String(payload.origin_pincode ?? payload.origin ?? ""); const destination = String(payload.destination_pincode ?? payload.destination ?? "");
        if (!/^\d{6}$/.test(origin) || !/^\d{6}$/.test(destination)) return error("VALIDATION_ERROR", "Valid origin and destination pincodes are required", 400, id, headers);
        const clientId = requireClient(auth, payload.client_id);
        if (!clientId || !canAccessClient(auth, clientId)) return error("FORBIDDEN", "Client scope is not allowed", 403, id, headers);
        const requestedAccountId = providerAccountId(payload);
        const accounts = await env.DB.prepare(`
          SELECT pa.id, pa.account_name,
                 COALESCE(p.enabled, 1) AS enabled,
                 COALESCE(p.priority, 100) AS priority,
                 COALESCE(p.confidence_score, 0) AS confidence_score,
                 p.rate_card_id
          FROM provider_accounts pa
          LEFT JOIN provider_account_client_policies p ON p.provider_account_id = pa.id AND p.client_id = ?
          WHERE pa.provider = ? AND pa.status = 'active' AND (pa.client_id = ? OR pa.client_id IS NULL)
            AND (? IS NULL OR pa.id = ?) AND (p.provider_account_id IS NULL OR p.enabled = 1)
          ORDER BY priority ASC, confidence_score DESC, pa.created_at ASC`).bind(clientId, provider, clientId, requestedAccountId, requestedAccountId).all<{ id: string; account_name: string; enabled: number; priority: number; confidence_score: number; rate_card_id: string | null }>();
        const candidates = accounts.results.length ? accounts.results : [null];
        const quotes = await Promise.all(candidates.map(async (account) => {
          const result = await providerRequest(env, "xpressbees", "quotes", { ...payload, origin_pincode: origin, destination_pincode: destination, ...(account ? { provider_account_id: account.id } : {}) }, id, clientId);
          return { provider, provider_account_id: account?.id ?? (result as { provider_account_id?: string }).provider_account_id, account_name: account?.account_name ?? (result as { account_name?: string }).account_name, confidence_score: account?.confidence_score ?? (result as { confidence_score?: number }).confidence_score ?? 0, priority: account?.priority ?? (result as { priority?: number }).priority ?? 100, rate_card_id: account?.rate_card_id ?? (result as { rate_card_id?: string }).rate_card_id, amount: (result as { amount?: number | null }).amount ?? null, provider_result: result };
        }));
        return json({ ok: true, data: { client_id: clientId, origin_pincode: origin, destination_pincode: destination, quotes } }, 200, headers);
      }
      if (route === "/serviceability" && request.method === "POST") {
        if (!hasScope(auth, "quotes.create")) return error("FORBIDDEN", "Serviceability scope required", 403, id, headers);
        const payload = await bodyJson(request); const origin = String(payload.origin_pincode ?? ""); const destination = String(payload.destination_pincode ?? "");
        if (!/^\d{6}$/.test(origin) || !/^\d{6}$/.test(destination)) return error("VALIDATION_ERROR", "Valid origin and destination pincodes are required", 400, id, headers);
        const configuredProviders = [env.DELHIVERY_API_BASE_URL && env.DELHIVERY_API_TOKEN ? "delhivery" : null, env.EKART_API_BASE_URL && env.EKART_API_KEY ? "ekart" : null].filter(Boolean).filter(() => String(env.ENABLE_PROVIDER_CALLS) === "true");
        if (configuredProviders.includes("delhivery")) {
          const [originResult, destinationResult] = await Promise.all([
            providerRequest(env, "delhivery", "serviceability", { destination_pincode: origin }, id, auth.clientId),
            providerRequest(env, "delhivery", "serviceability", { destination_pincode: destination }, id, auth.clientId),
          ]);
          const originServiceable = originResult.status === "accepted" && Boolean(originResult.serviceable);
          const destinationServiceable = destinationResult.status === "accepted" && Boolean(destinationResult.serviceable);
          return json({ ok: true, data: { origin_pincode: origin, destination_pincode: destination, serviceable: originServiceable && destinationServiceable, providers: originServiceable && destinationServiceable ? ["delhivery"] : [], configured_providers: configuredProviders, status: originResult.status === "accepted" && destinationResult.status === "accepted" ? "verified" : "provider_error", origin: originResult, destination: destinationResult } }, 200, headers);
        }
        return json({ ok: true, data: { origin_pincode: origin, destination_pincode: destination, serviceable: false, providers: [], configured_providers: configuredProviders, status: configuredProviders.length > 0 ? "provider_contract_not_verified" : "provider_unavailable" } }, 200, headers);
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
        const raw = `pss_${environment}_${crypto.randomUUID().replaceAll("-", "")}`; const keyId = crypto.randomUUID(); const prefix = raw.slice(0, 16); const hash = await sha256(`${raw}${env.API_KEY_PEPPER ?? ""}`); const scopes = Array.isArray(payload.scopes) ? [...new Set(payload.scopes.filter((scope): scope is string => typeof scope === "string" && API_KEY_SCOPES.has(scope)))] : ["shipments.read"]; if (!scopes.length) return error("VALIDATION_ERROR", "At least one supported API scope is required", 400, id, headers);
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
          const rows = auth.system
            ? await env.DB.prepare("SELECT * FROM master_records WHERE kind = ? ORDER BY updated_at DESC LIMIT 200").bind(kind).all()
            : auth.clientIds.size
              ? await env.DB.prepare(`SELECT * FROM master_records WHERE kind = ? AND (client_id IS NULL OR client_id IN (${[...auth.clientIds].map(() => "?").join(",")})) ORDER BY updated_at DESC LIMIT 200`).bind(kind, ...auth.clientIds).all()
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
      return error(message === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : message === "INVALID_JSON" ? "INVALID_JSON" : "INTERNAL_ERROR", publicMessage, message === "PAYLOAD_TOO_LARGE" ? 413 : message === "INVALID_JSON" ? 400 : 500, id, headers);
    }
  },
};

export default worker;
