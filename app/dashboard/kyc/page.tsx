import { requireEmployeePermission } from "@/lib/auth/server";
import EmployeeKyc from "@/components/dashboard/employee-kyc";

export default async function EmployeeKycPage() {
  await requireEmployeePermission("admin.clients.kyc.view");
  return <EmployeeKyc />;
}
