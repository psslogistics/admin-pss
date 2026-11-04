import { requireEmployeePermission } from "@/lib/auth/server";
import EmployeeRateCardsClient from "@/components/dashboard/employee-rate-cards-client";
export default async function EmployeeRateCardsPage() {
  await requireEmployeePermission("admin.rate_cards.view");
  return <EmployeeRateCardsClient />;
}
