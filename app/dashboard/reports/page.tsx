import OperationsWorkspace from "@/components/dashboard/operations-workspace";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function ReportsPage() { await requireEmployeePermission("admin.reports.view"); return <OperationsWorkspace mode="reports" />; }
