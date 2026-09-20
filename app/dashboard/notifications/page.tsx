import WorkspacePage from "@/components/dashboard/workspace-page";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function NotificationsPage() { await requireEmployeePermission("admin.notifications.view"); return <WorkspacePage kind="notifications" />; }
