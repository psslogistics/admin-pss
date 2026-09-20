import OperationsWorkspace from "@/components/dashboard/operations-workspace";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function PickupPage() { await requireEmployeePermission("admin.pickup.view"); return <OperationsWorkspace mode="pickup" />; }
