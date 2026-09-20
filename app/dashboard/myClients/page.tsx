import MyClients from "@/components/dashboard/my-clients";
import { requireEmployeePermission } from "@/lib/auth/server";
export default async function MyClientsPage() { await requireEmployeePermission("admin.clients.view"); return <MyClients />; }
