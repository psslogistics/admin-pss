import { redirect } from "next/navigation";
import EmployeeShell from "@/components/dashboard/employee-shell";
import { employee } from "@/lib/employee-data";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (employee.panelRole !== "admin") redirect("/access-denied");
  return <EmployeeShell>{children}</EmployeeShell>;
}
