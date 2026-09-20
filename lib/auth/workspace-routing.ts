const workspaceSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reservedWorkspaceSlugs = new Set(["www", "api", "employee", "client", "admin", "master", "auth"]);

export function workspaceRootDomain() {
  return (process.env.NEXT_PUBLIC_WORKSPACE_ROOT_DOMAIN || "psslogistics.in").toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function employeePortalHost() {
  return (process.env.NEXT_PUBLIC_EMPLOYEE_PORTAL_HOST || `employee.${workspaceRootDomain()}`).toLowerCase();
}

export function normalizeWorkspaceSlug(value: unknown) {
  const slug = String(value ?? "").trim().toLowerCase();
  return workspaceSlugPattern.test(slug) && !reservedWorkspaceSlugs.has(slug) ? slug : null;
}

export function workspaceHost(value: unknown) {
  const slug = normalizeWorkspaceSlug(value);
  return slug ? `${slug}.${workspaceRootDomain()}` : null;
}

export function isEmployeePortalHost(hostname: string) {
  return hostname.toLowerCase().split(":")[0] === employeePortalHost();
}

export function authCookieDomain(hostname: string) {
  const host = hostname.toLowerCase().split(":")[0];
  const root = workspaceRootDomain();
  return host === root || host.endsWith(`.${root}`) ? `.${root}` : undefined;
}

export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
