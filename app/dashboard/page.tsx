import EmployeeDashboard from "@/components/dashboard/employee-dashboard";
import { requireEmployeePermission } from "@/lib/auth/server";

export default async function DashboardPage() {
  await requireEmployeePermission("admin.dashboard.view");
  return <EmployeeDashboard />;
}
