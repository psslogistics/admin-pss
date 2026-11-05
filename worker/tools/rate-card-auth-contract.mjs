import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../app/api/rate-cards/route.ts", import.meta.url), "utf8");
const accessStart = source.indexOf("async function access");
const accessBlock = source.slice(accessStart, source.indexOf("export async function GET", accessStart));

assert.ok(accessStart >= 0, "rate-card access helper exists");
assert.match(accessBlock, /supabase\.auth\.getClaims\(\)/);
assert.match(accessBlock, /AUTHENTICATION_REQUIRED/);
assert.match(accessBlock, /rateCardError\(401, "AUTHENTICATION_REQUIRED"/);
assert.ok(accessBlock.indexOf("getClaims()") < accessBlock.indexOf("requireEmployeeAccess()"), "claims check precedes redirecting employee helper");
assert.match(accessBlock, /RATE_CARD_PERMISSION_DENIED/);
assert.match(accessBlock, /RATE_CARD_CLIENT_SCOPE_DENIED/);
assert.match(source, /x-request-id/);
assert.match(source, /user_safe_message/);

console.log("Rate-card authentication contract checks passed (8 checks).");
