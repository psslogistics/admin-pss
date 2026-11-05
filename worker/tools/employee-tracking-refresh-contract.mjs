import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../components/dashboard/employee-tracking-client-ui.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes tracking refresh", /admin\.tracking\.refresh/],
  ["tracking UI reads refresh permission", /canRefreshTracking = can\("admin\.tracking\.refresh"\)/],
  ["tracking UI hides refresh controls without permission", /canRefreshTracking && <button/],
  ["tracking refresh calls explicit refresh endpoint", /\/tracking\?refresh=1/],
  ["worker maps tracking refresh scope", /tracking\.refresh[\s\S]*admin\.tracking\.refresh/],
  ["worker denies unauthorized provider refresh", /url\.searchParams\.get\("refresh"\) === "1"[\s\S]*Tracking refresh permission required/],
  ["worker preserves tracking read gate", /route\.endsWith\("\/tracking"\) \? "tracking\.read" : "shipments\.read"/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${ui}\n${worker}`, pattern, label);
console.log(`employee-tracking-refresh-contract: ${checks.length}/${checks.length} passed`);
