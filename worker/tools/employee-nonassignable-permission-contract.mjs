import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [masterCatalogue, rolesApi, overrideApi, rolesPage, employeeDetail] = await Promise.all([
  readFile(new URL("../../../master-pss/supabase/migrations/202610240001_super_admin_task_permission_catalog.sql", import.meta.url), "utf8"),
  readFile(new URL("../../../master-pss/app/api/admin/roles/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../master-pss/app/api/admin/employee-permission-override/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../master-pss/app/(admin)/roles-permissions/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../master-pss/components/admin/employee-detail.tsx", import.meta.url), "utf8"),
]);
const source = `${masterCatalogue}\n${rolesApi}\n${overrideApi}\n${rolesPage}\n${employeeDetail}`;
const checks = [
  ["catalogue contains non-assignable permissions", /, false, 'employee'/],
  ["role API filters employee assignment", /eq\("assignable_to_employee", true\)/],
  ["override API filters employee assignment", /not an assignable Admin permission/],
  ["role UI disables non-assignable permissions", /!assignable/],
  ["employee UI disables non-assignable permissions", /disabled=\{!assignable\}/],
];
for (const [label, pattern] of checks) assert.match(source, pattern, label);
console.log(`Employee non-assignable permission contract passed (${checks.length} checks).`);
