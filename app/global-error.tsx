"use client";

import { ErrorScreen } from "@/components/errors/error-screen";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <ErrorScreen statusCode={500} retry={reset} homeUrl="https://admin.psslogisitics.in" />
      </body>
    </html>
  );
}
