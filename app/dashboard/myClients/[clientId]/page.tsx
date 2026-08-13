import ClientWorkspace from "@/components/dashboard/client-workspace";

export default async function ClientWorkspacePage({ params }: { params: Promise<{ clientId: string }> }) {
  return <ClientWorkspace clientId={(await params).clientId} />;
}
