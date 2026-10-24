import AssignedShipments from "@/components/dashboard/assigned-shipments-client-ui";
import { requireEmployeePermission } from "@/lib/auth/server";

export default async function ShipmentsPage() {
  await requireEmployeePermission("admin.shipments.assigned.view");
  return <AssignedShipments />;
}
