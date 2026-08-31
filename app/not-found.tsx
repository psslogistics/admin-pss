import { ErrorScreen } from "@/components/errors/error-screen";

export default function NotFound() {
  return <ErrorScreen statusCode={404} homeUrl="https://admin.psslogisitics.in" />;
}

