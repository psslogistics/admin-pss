import WorkspacePage from "@/components/dashboard/workspace-page";
import ProfileWorkspaceSummary from "@/components/dashboard/profile-workspace-summary";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function ProfilePage() { await requireEmployeePermission("admin.profile.view"); return <div className="space-y-4"><ProfileWorkspaceSummary /><WorkspacePage kind="profile" /></div>; }
