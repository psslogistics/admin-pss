"use client";

import { ClipboardCheck, KeyRound, ShieldCheck, UsersRound } from "lucide-react";

const cards = [
  [ShieldCheck, "Identity & access", "Your role and permissions are enforced by the authenticated workspace.", "Server governed"],
  [UsersRound, "Client coverage", "Only assigned client workspaces and records are available to this employee.", "Assignment scoped"],
  [KeyRound, "API & webhooks", "Credentials and webhook secrets remain managed by the Worker boundary.", "Support view"],
  [ClipboardCheck, "Operational status", "Bookings, tracking, pickups, and support use production API routes.", "Live workflow"],
] as const;

export default function ProfileWorkspaceSummary() {
  return <section aria-label="Employee account workspace" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([Icon, title, detail, status]) => <article key={title} className="rounded-xl border border-border/70 bg-card p-4 shadow-xs"><div className="flex items-center justify-between gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><span className="rounded-full bg-muted px-2 py-1 text-[9px] font-semibold text-muted-foreground">{status}</span></div><h2 className="mt-3 text-xs font-semibold">{title}</h2><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</p></article>)}</section>;
}
