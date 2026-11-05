import { requireEmployeePermission } from "@/lib/auth/server";
import EmployeeAddresses from "@/components/dashboard/employee-addresses";

export default async function EmployeeAddressesPage() {
  await requireEmployeePermission("admin.addresses.view");
  return <EmployeeAddresses />;
}
