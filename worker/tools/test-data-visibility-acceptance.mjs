import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "worker", "src", "index.ts"), "utf8");
const migration = fs.readFileSync(path.join(process.cwd(), "worker", "migrations", "20261029_client_test_classification.sql"), "utf8");

const checks = [
  ["client/API identities hide classified records", /function hidesClientTestData\(auth: Auth\)[\s\S]*auth\.kind === "api"[\s\S]*auth\.audience === "client"/],
  ["internal roles retain classified records", /auth\.roles\.has\("client"\) && !hasRole\(auth, \["employee", "admin", "super_admin"\]\)/],
  ["shipment rows use the visibility predicate", /const shipmentVisibility = testDataVisibilityClause\(auth, "s"\)[\s\S]*const clientWhere = \[[\s\S]*shipmentVisibility/],
  ["shipment status counts use the visibility predicate", /const shipmentVisibilityNoAlias = testDataVisibilityClause\(auth\)[\s\S]*const statusRows =/],
  ["shipment pagination totals use the visibility predicate", /const totalWhere = \[statusPredicate, shipmentVisibility\]\.filter\(Boolean\)\.join\(" AND "\)/],
  ["status-count cache separates client and internal views", /hidesClientTestData\(auth\) \? "client-visible" : "internal"/],
  ["dashboard overview applies related-shipment visibility", /const addOverview = \(key: string, scope: string, sql: string, extra: string, visibilityTable = ""\)/],
  ["dashboard summary collections apply related-shipment visibility", /const visibility = relatedShipmentVisibilityClause\(auth, table\)/],
  ["reports exclude classified shipments", /const reportShipmentVisibility = testDataVisibilityClause\(auth\)/],
  ["complete reports exclude classified related records", /const sourceAlias = table === "ndr_cases"[\s\S]*const visibility = relatedShipmentVisibilityClause\(auth, table, sourceAlias\)/],
  ["warehouses and saved addresses exclude classified records", /const warehouseVisibility = testDataVisibilityClause\(auth\)[\s\S]*const addressVisibility = testDataVisibilityClause\(auth\)/],
  ["billing excludes classified shipment invoices", /COALESCE\(sh\.is_test, 0\) = 0/],
  ["wallet references are linked back to classified shipments", /table === "wallet_transactions"[\s\S]*REPLACE\(\$\{alias\}\.reference, 'SHIPMENT-'/],
  ["support and notification records exclude classified shipments", /support_tickets\.shipment_id[\s\S]*notifications\.shipment_id/],
  ["weight and COD records exclude classified shipments", /COALESCE\(s\.is_test, 0\) = 0[\s\S]*weight_reconciliations/],
  ["direct shipment and artifact reads enforce visibility", /const artifactVisibility = testDataVisibilityClause\(auth, "s"\)[\s\S]*const shipmentGetVisibility = testDataVisibilityClause\(auth\)/],
  ["direct document reads enforce visibility", /const documentVisibility = hidesClientTestData\(auth\)[\s\S]*LEFT JOIN shipments s ON s\.id = d\.shipment_id/],
  ["classification migration is present", /ALTER TABLE shipments ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0/],
  ["warehouse classification migration is present", /ALTER TABLE warehouses ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0/],
  ["saved-address classification migration is present", /ALTER TABLE client_addresses ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0/],
];

for (const [label, pattern] of checks) assert.match(label === "classification migration is present" || label === "warehouse classification migration is present" || label === "saved-address classification migration is present" ? migration : source, pattern, label);
console.log(`Test-data visibility contract checks passed (${checks.length} checks).`);
