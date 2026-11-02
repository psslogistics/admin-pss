import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const extension = await readFile(new URL("../production-extension.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/20261102_wallet_transaction_shipment_links.sql", import.meta.url), "utf8");
const workflow = await readFile(new URL("../../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");

const checks = [
  ["canonical and extension schemas define the link table", schema.includes("CREATE TABLE IF NOT EXISTS wallet_transaction_shipment_links") && extension.includes("CREATE TABLE IF NOT EXISTS wallet_transaction_shipment_links")],
  ["link identity is one transaction to one shipment", migration.includes("wallet_transaction_id TEXT PRIMARY KEY")],
  ["migration is idempotent", migration.includes("CREATE TABLE IF NOT EXISTS") && migration.match(/INSERT OR IGNORE/g)?.length === 2],
  ["historical links require same-client shipment identity", migration.includes("s.client_id = w.client_id") && migration.includes("p.client_id = w.client_id")],
  ["migration preserves financial ledger columns", !migration.match(/UPDATE\s+wallet_transactions/i) && !migration.match(/DELETE\s+FROM\s+wallet_transactions/i)],
  ["booking debits and reversals write explicit links", source.includes('walletShipmentLinkStatement(env, `wallet-${shipmentId}`, clientId, shipmentId)') && source.includes("walletShipmentLinkStatement(env, reversalId, shipment.client_id, shipment.id)")],
  ["weight debit and credit writes link to the shipment", source.includes("walletShipmentLinkStatement(env, weightDebitTransactionId!, reconciliation.client_id, reconciliation.shipment_id)") && source.includes("walletShipmentLinkStatement(env, weightCreditTransactionId!, reconciliation.client_id, reconciliation.shipment_id)")],
  ["pricing adjustments write an explicit shipment link", source.includes("walletShipmentLinkStatement(env, walletAdjustmentId, snapshot.client_id, shipmentId)")],
  ["manual wallet entries validate and persist optional shipment identity", source.includes('if (payload.shipment_id !== undefined && !(await shipmentBelongsToClient') && source.includes("walletShipmentLinkStatement(env, recordId, clientId, manualShipmentId)")],
  ["client wallet reads prefer explicit links", source.includes("linkedShipmentByTransaction.get(String(row.id)) ?? referenceParts(row.reference)?.shipmentId")],
  ["collection joins are tenant scoped", source.includes('walletShipmentIdExpression("w")} AND s.client_id = w.client_id')],
  ["test-data filtering and deletion protection use explicit links", source.includes("test_shipment.id = ${walletShipmentIdExpression(alias)}") && source.includes("SELECT COUNT(*) FROM wallet_transaction_shipment_links WHERE client_id = ? AND shipment_id = ?")],
  ["deployment applies the exact migration before Worker deploy", workflow.indexOf("Apply wallet shipment-link migration") > 0 && workflow.indexOf("Apply wallet shipment-link migration") < workflow.indexOf("Deploy pss-api") && workflow.includes("20261102_wallet_transaction_shipment_links.sql")],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Wallet shipment-link contract checks failed: ${failed.join(", ")}`);
console.log(`Worker wallet shipment-link contract checks passed (${checks.length} checks).`);
