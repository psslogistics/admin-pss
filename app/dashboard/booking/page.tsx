import OperationsWorkspace from "@/components/dashboard/operations-workspace";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function BookingPage() { await requireEmployeePermission("admin.booking.view"); return <OperationsWorkspace mode="booking" />; }
