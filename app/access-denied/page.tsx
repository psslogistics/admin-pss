import { ErrorScreen } from "@/components/errors/error-screen";

export default function AccessDeniedPage() {
  return <ErrorScreen statusCode={403} title="Access denied" description="This workspace is not available for your current role. Ask a Super Admin to assign eligible access." />;
}
