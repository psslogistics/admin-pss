export function isKycTestModeEnabled(environment: unknown, flag: unknown) {
  const normalizedEnvironment = String(environment ?? "").trim().toLowerCase();
  const normalizedFlag = String(flag ?? "").trim().toLowerCase();
  return normalizedEnvironment !== "production" && (normalizedEnvironment === "test" || normalizedEnvironment === "staging") && normalizedFlag === "true";
}

export function isExplicitKycTestOrganization(
  organizations: Array<{ id: string; identity_environment: string | null }>,
  clientIds: string[],
) {
  if (!clientIds.length || organizations.length !== clientIds.length) return false;
  const environments = new Map(organizations.map((organization) => [organization.id, organization.identity_environment]));
  return clientIds.every((clientId) => environments.get(clientId) === "test");
}
