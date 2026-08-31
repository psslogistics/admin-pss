"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/errors/error-screen";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("PSS route error", { digest: error.digest });
  }, [error]);

  return <ErrorScreen statusCode={500} retry={reset} homeUrl="https://admin.psslogisitics.in" />;
}

