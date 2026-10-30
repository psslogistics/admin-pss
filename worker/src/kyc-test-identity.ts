export function isExplicitKycTestOrganization(
  organizations: Array<{ id: string; identity_environment: string | null }>,
  clientIds: string[],
) {
  if (!clientIds.length || organizations.length !== clientIds.length) return false;
  const environments = new Map(organizations.map((organization) => [organization.id, organization.identity_environment]));
  return clientIds.every((clientId) => environments.get(clientId) === "test");
}
