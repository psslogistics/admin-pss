import EmployeeShell from "@/components/dashboard/employee-shell";
import { EmployeeProvider } from "@/components/dashboard/employee-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <EmployeeProvider><EmployeeShell>{children}</EmployeeShell></EmployeeProvider>;
}
