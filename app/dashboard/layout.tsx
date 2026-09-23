import EmployeeShell from "@/components/dashboard/employee-shell";
import { EmployeeProvider } from "@/components/dashboard/employee-provider";
import { requireEmployeeAccess } from "@/lib/auth/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireEmployeeAccess();
  const initialIdentity = {
    id: actor.userId,
    name: actor.profile.display_name || actor.profile.email?.split("@")[0] || "Authenticated employee",
    email: actor.profile.email || "",
    employeeId: actor.employee?.employee_code || "",
    workspace: actor.employee?.workspace_slug || "",
    role: actor.roles.filter((item) => item.is_active && item.role).map((item) => item.role?.role_code || item.role?.scope).filter(Boolean).join(" · ") || "Employee",
  };
  return <EmployeeProvider initialIdentity={initialIdentity}><EmployeeShell>{children}</EmployeeShell></EmployeeProvider>;
}
