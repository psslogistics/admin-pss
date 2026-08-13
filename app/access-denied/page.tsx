import Link from "next/link";

export default function AccessDeniedPage() {
  return <main className="grid min-h-svh place-items-center bg-background p-6"><div className="max-w-md text-center"><p className="text-xs font-semibold uppercase tracking-widest text-destructive">Access denied</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">This workspace is not available for your role.</h1><p className="mt-2 text-sm text-muted-foreground">Ask a Super Admin to assign an eligible Admin role before entering the operations panel.</p><Link href="/" className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Return home</Link></div></main>;
}
