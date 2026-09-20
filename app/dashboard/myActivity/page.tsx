import WorkspacePage from "@/components/dashboard/workspace-page";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function MyActivityPage() { await requireEmployeePermission("admin.activity.view"); return <WorkspacePage kind="activity" />; }
