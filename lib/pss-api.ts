import { createClient } from "@/lib/supabase/client";

const GET_CACHE_TTL_MS = 15_000;
const getCache = new Map<string, { expiresAt: number; value: unknown }>();
const getInFlight = new Map<string, Promise<unknown>>();

export async function pssApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  const baseUrl = process.env.NEXT_PUBLIC_PSS_API_URL;
  if (!baseUrl) throw new Error("PSS API is not configured.");
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase());
  const cacheKey = `${session.user.id}:${path}`;
  if (!mutating) {
    const cached = getCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const pending = getInFlight.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }
  const request = (async () => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { ...init, signal: controller.signal, headers: { Authorization: `Bearer ${session.access_token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(mutating ? { "Idempotency-Key": crypto.randomUUID() } : {}), ...init.headers } });
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status}).`);
    if (!mutating) getCache.set(cacheKey, { expiresAt: Date.now() + GET_CACHE_TTL_MS, value: payload });
    else getCache.clear();
    return payload;
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw new Error("The production API timed out. Check the Worker deployment and try again.");
    throw caught;
  } finally { window.clearTimeout(timeout); }
  })();
  if (!mutating) {
    getInFlight.set(cacheKey, request);
    void request.finally(() => getInFlight.delete(cacheKey)).catch(() => undefined);
  }
  return request;
}
