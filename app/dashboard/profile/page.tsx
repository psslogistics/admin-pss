import WorkspacePage from "@/components/dashboard/workspace-page";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function ProfilePage() { await requireEmployeePermission("admin.profile.view"); return <WorkspacePage kind="profile" />; }
