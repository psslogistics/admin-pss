import { requireEmployeePermission } from "@/lib/auth/server";
import EmployeeCouriers from "@/components/dashboard/employee-couriers";

export default async function EmployeeCouriersPage() {
  await requireEmployeePermission("admin.couriers.view");
  return <EmployeeCouriers />;
}
