import { requireEmployeePermission } from "@/lib/auth/server";
import EmployeeWallet from "@/components/dashboard/employee-wallet";

export default async function EmployeeWalletPage() {
  await requireEmployeePermission("admin.wallet.view");
  return <EmployeeWallet />;
}
