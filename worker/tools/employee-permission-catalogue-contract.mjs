import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [adminPermissions, worker, masterCatalogue] = await Promise.all([
  readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../master-pss/supabase/migrations/202610240001_super_admin_task_permission_catalog.sql", import.meta.url), "utf8"),
]);
assert.match(adminPermissions, /ADMIN_PERMISSION_KEYS/);
assert.match(adminPermissions, /admin\.dashboard\.view/);
assert.match(adminPermissions, /admin\.couriers\.view/);
assert.match(adminPermissions, /admin\.reports\.schedule/);
assert.match(worker, /admin\.clients\.kyc\.view/);
assert.match(worker, /admin\.wallet\.view/);
assert.match(masterCatalogue, /, true, 'employee'/);
assert.match(masterCatalogue, /on conflict \(permission_key\) do update/i);
console.log("Employee permission-catalogue contract passed (8 checks).");
