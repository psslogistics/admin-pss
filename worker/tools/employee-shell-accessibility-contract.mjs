import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../../components/dashboard/employee-shell.tsx", import.meta.url), "utf8");
const checks = [
  ["mobile navigation has an accessible open control", /aria-label=\"Open navigation\"/],
  ["mobile navigation has an accessible close control", /aria-label=\"Close navigation\"/],
  ["employee menu exposes menu semantics", /aria-haspopup=\"menu\"/],
  ["profile menu exposes menuitem semantics", /role=\"menuitem\"/],
  ["profile menu closes on Escape", /event\.key === \"Escape\"/],
  ["search dialog exposes a labelled input", /placeholder=\"Search visible workspace records\.\.\.\"/],
];
for (const [label, pattern] of checks) assert.match(shell, pattern, label);
console.log(`Employee shell accessibility contract passed (${checks.length} checks).`);
