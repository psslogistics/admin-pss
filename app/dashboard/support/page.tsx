import WorkspacePage from "@/components/dashboard/workspace-page";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function SupportPage() { await requireEmployeePermission("admin.support.view"); return <WorkspacePage kind="support" />; }
