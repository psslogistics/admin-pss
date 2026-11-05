import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, page, component, navigation, workspace] = await Promise.all([
  readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/dashboard/couriers/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/employee-couriers.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/navigation/navigation-config.ts", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/provider-health.tsx", import.meta.url), "utf8"),
]);

const checks = [
  ["worker maps courier permission to integration read", /"integrations\.read": \[[^\]]*admin\.couriers\.view/],
  ["worker maps courier permission to provider-account read", /"provider_accounts\.read": \[[^\]]*admin\.couriers\.view/],
  ["provider capabilities GET is permission-gated", /route === "\/provider-capabilities" && request\.method === "GET"[\s\S]*hasScope\(auth, "integrations\.read"\)/],
  ["provider policies enforce client scope", /route === "\/provider-account-policies" && request\.method === "GET"[\s\S]*requireClient\(auth, requestedClient\)[\s\S]*canAccessClient\(auth, clientId\)/],
  ["provider policy response removes credential secret", /delete safeRow\.credential_secret_name/],
  ["employee page has a server permission guard", /requireEmployeePermission\("admin\.couriers\.view"\)/.test(page)],
  ["courier UI is read-only", !/method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(component)],
  ["courier UI uses the existing read-only health panel", /<ProviderHealth clientId=\{selectedClient\}/.test(component)],
  ["courier navigation is permission-gated", /href: "\/dashboard\/couriers"[^\n]+permission: "admin\.couriers\.view"/.test(navigation)],
  ["provider health exposes no credential field", !/credential_secret_name/.test(workspace)],
];

for (const [label, result] of checks) assert.equal(Boolean(result), true, label);
console.log(`Employee courier read contract passed (${checks.length} checks).`);
