import OperationsWorkspace from "@/components/dashboard/operations-workspace";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function TrackingPage() { await requireEmployeePermission("admin.tracking.view"); return <OperationsWorkspace mode="tracking" />; }
