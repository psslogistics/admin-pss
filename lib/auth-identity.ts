export type AuthIdentity = {
  identifier: string;
  username: string;
  method: "email" | "mobile";
  email?: string;
  mobile?: string;
  signedInAt: string;
};

export const AUTH_IDENTITY_KEY = "pss_admin_auth_identity_v1";

export function deriveAuthIdentity(identifier: string): AuthIdentity | null {
  const value = identifier.trim();
  const emailMatch = value.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (emailMatch) { const email = value.toLowerCase(); return { identifier: value, username: emailMatch[1].toLowerCase(), method: "email", email, signedInAt: new Date().toISOString() }; }
  const mobile = value.replace(/\D/g, "");
  if (mobile.length === 10) return { identifier: value, username: `XXXXXX${mobile.slice(-4)}`, method: "mobile", mobile, signedInAt: new Date().toISOString() };
  return null;
}

export function saveAuthIdentity(identity: AuthIdentity) { if (typeof window !== "undefined") window.sessionStorage.setItem(AUTH_IDENTITY_KEY, JSON.stringify(identity)); }
export function readAuthIdentity(): AuthIdentity | null { if (typeof window === "undefined") return null; try { const value = JSON.parse(window.sessionStorage.getItem(AUTH_IDENTITY_KEY) ?? "null"); return value && typeof value.username === "string" ? value as AuthIdentity : null; } catch { return null; } }
export function clearAuthIdentity() { if (typeof window !== "undefined") window.sessionStorage.removeItem(AUTH_IDENTITY_KEY); }
