import WorkspacePage from "@/components/dashboard/workspace-page";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function SettingsPage() { await requireEmployeePermission("admin.settings.view"); return <WorkspacePage kind="settings" />; }
