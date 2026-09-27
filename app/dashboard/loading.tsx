export default function DashboardLoading() {
  return <div className="space-y-6" role="status" aria-live="polite" aria-label="Loading employee workspace">
    <section><p className="text-sm text-muted-foreground">Authenticated employee workspace</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Employee workspace</h1><p className="mt-2 text-sm text-muted-foreground">Loading your assigned work and production activity…</p></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)}</section>
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]"><div className="h-64 animate-pulse rounded-xl border border-border bg-card" /><div className="h-64 animate-pulse rounded-xl border border-border bg-card" /></section>
  </div>;
}
