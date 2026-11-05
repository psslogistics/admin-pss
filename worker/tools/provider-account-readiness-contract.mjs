import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "src", "index.ts"), "utf8");
const migration = readFileSync(join(root, "migrations", "20261105_provider_account_readiness.sql"), "utf8");
const checks = [
  ["readiness migration exists", migration.includes("activation_status") && migration.includes("booking_enabled")],
  ["new accounts are pending", source.includes("'pending_verification', 0, 0, 0, 0")],
  ["implicit policy seeding removed", !source.includes("ensureDefaultClientProviderPolicies")],
  ["booking uses eligibility diagnostics", source.includes("bookingProviderAccountDiagnostics") && source.includes("No booking-ready Delhivery account")],
  ["provider health endpoint exists", source.includes('route === "/provider-account-health"')],
  ["client view does not treat policy alone as ready", source.includes("internalProviderView ? Boolean(Number(record.enabled)) : eligibility.blockers.length === 0")],
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) throw new Error(`provider-account-readiness-contract: ${failed.map(([name]) => name).join(", ")}`);
console.log(`provider-account-readiness-contract: ${checks.length}/${checks.length} passed`);
