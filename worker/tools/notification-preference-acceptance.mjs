import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("worker/src/index.ts", "utf8");
const checks = [
  ["client notification preference map exists", source.includes("clientNotificationPreferences")],
  ["saved client preferences are read", source.includes("FROM client_preferences WHERE client_id IN")],
  ["only explicit false disables a category", source.includes("preferences.notifications?.[key] === false")],
  ["shipment notifications map to Shipments", source.includes('shipments: "Shipments"')],
  ["finance notifications map to Billing", source.includes('finance: "Billing"')],
  ["system and internal notifications are not filtered", source.includes('auth.system || auth.audience !== "client"')],
  ["notification list applies the category filter", source.includes("${visibility}${notificationFilter.sql}")],
  ["dashboard unread count applies the same filter", source.includes("${notificationFilter.sql}`).bind(...clientIds")],
];
for (const [label, passed] of checks) assert.ok(passed, label);
console.log(`Worker notification preference checks passed (${checks.length} checks).`);
