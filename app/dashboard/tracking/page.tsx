import EmployeeTrackingPane from "@/components/dashboard/employee-tracking-client-ui";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function TrackingPage() { await requireEmployeePermission("admin.tracking.view"); return <EmployeeTrackingPane />; }
