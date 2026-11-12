import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, workspace, provider] = await Promise.all([
  readFile(new URL("../../app/dashboard/profile/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/workspace-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/employee-provider.tsx", import.meta.url), "utf8"),
]);
assert.match(page, /requireEmployeePermission\("admin\.profile\.view"\)/);
assert.match(workspace, /can\("admin\.profile\.view"\)/);
assert.match(workspace, /Edit profile/);
assert.match(workspace, /updateProfile/);
assert.match(provider, /supabase\.from\("profiles"\)\.update/);
console.log("Employee profile-permission contract passed (5 checks).");
