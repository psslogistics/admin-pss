import EmployeeShell from "@/components/dashboard/employee-shell";
import { EmployeeProvider } from "@/components/dashboard/employee-provider";
import { requireEmployeeAccess } from "@/lib/auth/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireEmployeeAccess();
  return <EmployeeProvider><EmployeeShell>{children}</EmployeeShell></EmployeeProvider>;
}
