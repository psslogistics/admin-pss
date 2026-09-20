import WorkspacePage from "@/components/dashboard/workspace-page";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function MyTasksPage() { await requireEmployeePermission("admin.tasks.view"); return <WorkspacePage kind="tasks" />; }
