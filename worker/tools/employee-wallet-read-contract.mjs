import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, page, component, navigation] = await Promise.all([
  readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/dashboard/wallet/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/employee-wallet.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/navigation/navigation-config.ts", import.meta.url), "utf8"),
]);

const checks = [
  ["worker maps wallet read permission", /"wallet\.read": \[[^\]]*admin\.wallet\.view/],
  ["wallet GET enforces wallet read scope", /route === "\/wallet" && request\.method === "GET"[\s\S]*hasScope\(auth, "wallet\.read"\)/],
  ["wallet rows remain client scoped", /wallet_transactions WHERE client_id IN \(\$\{clientIds\.map\(\(\) => "\\?"\)/],
  ["employee page has a server permission guard", /requireEmployeePermission\("admin\.wallet\.view"\)/.test(page)],
  ["wallet UI uses the read-only endpoint", /pssApi<[^>]+>\("\/v1\/wallet\?limit=100"\)/.test(component)],
  ["wallet UI exposes no mutation control", !/method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(component)],
  ["wallet navigation is permission-gated", /href: "\/dashboard\/wallet"[^\n]+permission: "admin\.wallet\.view"/.test(navigation)],
];

for (const [label, result] of checks) assert.equal(Boolean(result), true, label);
console.log(`Employee wallet read contract passed (${checks.length} checks).`);
