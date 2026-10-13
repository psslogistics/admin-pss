import WeightReconciliationWorkspace from "@/components/dashboard/weight-reconciliation-workspace";
import { requireEmployeePermission } from "@/lib/auth/server";

export default async function WeightReconciliationPage() {
  await requireEmployeePermission("admin.weight.view");
  return <WeightReconciliationWorkspace />;
}
