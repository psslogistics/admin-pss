import ClientWorkspace from "@/components/dashboard/client-workspace";
import { requireEmployeePermission } from "@/lib/auth/server";

export default async function ClientWorkspacePage({ params }: { params: Promise<{ clientId: string }> }) {
  await requireEmployeePermission("admin.clients.view");
  return <ClientWorkspace clientId={(await params).clientId} />;
}
