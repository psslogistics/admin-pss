import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");
const routes = {
  "auth/clear-recovery": await read("app/api/auth/clear-recovery/route.ts"),
  "auth/complete-password-change": await read("app/api/auth/complete-password-change/route.ts"),
  "auth/recovery-status": await read("app/api/auth/recovery-status/route.ts"),
  "auth/reset-password": await read("app/api/auth/reset-password/route.ts"),
  "auth/workspace-redirect": await read("app/api/auth/workspace-redirect/route.ts"),
  "rate-cards": await read("app/api/rate-cards/route.ts"),
};

const checks = [
  ["clear-recovery is limited to clearing a scoped recovery cookie", /pss_password_recovery.*maxAge: 0/s.test(routes["auth/clear-recovery"])],
  ["complete-password-change has a claims gate", /getClaims\(\)[\s\S]*status: 401/.test(routes["auth/complete-password-change"])],
  ["recovery-status has a user gate", /auth\.getUser\(\)[\s\S]*status: 401/.test(routes["auth/recovery-status"])],
  ["reset-password has a user gate", /auth\.getUser\(\)[\s\S]*status: 401/.test(routes["auth/reset-password"])],
  ["workspace redirect delegates to authenticated resolver", /resolveEmployeeWorkspaceRedirect/.test(routes["auth/workspace-redirect"])],
  ["rate-cards has claims and employee permission gates", /getClaims\(\)[\s\S]*requireEmployeeAccess[\s\S]*has_permission/.test(routes["rate-cards"])],
];
const passed = checks.filter(([, ok]) => ok).length;
for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
assert.equal(passed, checks.length, `Admin API auth inventory failed: ${passed}/${checks.length}`);
console.log(`Admin API auth inventory passed (${passed} checks; ${Object.keys(routes).length} route families inspected).`);
