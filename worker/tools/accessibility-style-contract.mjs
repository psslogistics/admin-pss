import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(css, /transition-duration:\s*1ms/);
assert.match(css, /button:focus-visible/);
assert.match(css, /a:focus-visible/);
assert.match(css, /input:focus-visible/);
assert.match(css, /outline-offset:\s*2px/);
console.log("Accessibility style contract checks passed (6 checks).");
