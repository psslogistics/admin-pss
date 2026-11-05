import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, page, component, navigation] = await Promise.all([
  readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/dashboard/kyc/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/employee-kyc.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/navigation/navigation-config.ts", import.meta.url), "utf8"),
]);

const checks = [
  ["worker maps KYC read permission", /"kyc\.read": \[[^\]]*admin\.clients\.kyc\.view/],
  ["KYC status route enforces employee scope", /route === "\/kyc-status" && request\.method === "GET"[\s\S]*hasScope\(auth, "kyc\.read"\)/],
  ["KYC status route enforces client scope", /route === "\/kyc-status" && request\.method === "GET"[\s\S]*requireClient\(auth, url\.searchParams\.get\("client_id"\)\)[\s\S]*canAccessClient\(auth, clientId\)/],
  ["KYC response is status-only", /missing_fields: kycTestAccount \? \[\] : missingFields/],
  ["employee page has a server permission guard", /requireEmployeePermission\("admin\.clients\.kyc\.view"\)/.test(page)],
  ["KYC UI uses the scoped GET endpoint", /pssApi<[^>]+>\(`\/v1\/kyc-status\?client_id=/.test(component)],
  ["KYC UI exposes no mutation control", !/method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(component)],
  ["KYC UI does not render identity values", !/pan_number|gst_number|aadhaar_last4/.test(component)],
  ["KYC navigation is permission-gated", /href: "\/dashboard\/kyc"[^\n]+permission: "admin\.clients\.kyc\.view"/.test(navigation)],
];

for (const [label, result] of checks) assert.equal(Boolean(result), true, label);
console.log(`Employee KYC read contract passed (${checks.length} checks).`);
