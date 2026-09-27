"use client";

import dynamic from "next/dynamic";

const EmployeeDashboard = dynamic(() => import("@/components/dashboard/employee-dashboard"), {
  ssr: false,
  loading: () => (
    <section className="space-y-6" role="status" aria-live="polite">
      <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)}
      </div>
      <div className="min-h-[360px] animate-pulse rounded-xl border border-border bg-card" />
    </section>
  ),
});

export default function EmployeeDashboardLoader() {
  return <EmployeeDashboard />;
}
