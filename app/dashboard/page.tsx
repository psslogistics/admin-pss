import EmployeeDashboardLoader from "@/components/dashboard/employee-dashboard-loader";
import { requireEmployeePermission } from "@/lib/auth/server";

export default async function DashboardPage() {
  await requireEmployeePermission("admin.dashboard.view");
  return <EmployeeDashboardLoader />;
}
