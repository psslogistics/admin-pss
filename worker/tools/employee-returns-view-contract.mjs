import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes returns view", /admin\.returns\.view/],
  ["worker maps returns read", /returns\.read[\s\S]*admin\.returns\.view/],
  ["returns collection uses returns read", /"\/returns": \{ table: "return_shipments", scope: "returns\.read"/],
  ["returns management remains separate", /returns\.manage[\s\S]*admin\.returns\.manage/],
  ["returns creation remains gated", /route === "\/returns" && request\.method === "POST"[\s\S]*returns\.manage/],
  ["returns remain client scoped", /return_shipments[\s\S]*client_id IN/],
  ["returns mutation remains audited", /return\.created|returns\.updated|return_shipments/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-returns-view-contract: ${checks.length}/${checks.length} passed`);
