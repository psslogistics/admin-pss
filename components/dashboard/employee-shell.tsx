"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronRight, Menu, Moon, Search, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { employee } from "@/lib/employee-data";
import { allNavigationItems, navigationGroups } from "@/components/navigation/navigation-config";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", compact && "justify-center")}>
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-xs">P</div>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">PSS Logistics</span>}
    </div>
  );
}

function EmployeeAvatar({ small = false }: { small?: boolean }) {
  return <div className={cn("grid shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary", small ? "size-8 text-xs" : "size-11 text-sm")}>{employee.initials}</div>;
}

export default function EmployeeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReady, setThemeReady] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const currentRoute = allNavigationItems.find((item) => item.href === pathname)?.title ?? "Dashboard";

  useEffect(() => {
    const saved = localStorage.getItem("pss-theme");
    const next = saved === "dark" || saved === "light" ? saved : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.classList.toggle("dark", next === "dark");
    const timer = window.setTimeout(() => { setTheme(next); setThemeReady(true); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (event: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSearchOpen(false); };
    window.addEventListener("keydown", close);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", close); };
  }, [searchOpen]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("pss-theme", next);
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 450);
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      {sidebarOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border/70 bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0", collapsed && "md:w-[68px]", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className={cn("flex h-16 items-center border-b border-sidebar-border/50 px-4", collapsed && "md:justify-center md:px-2")}><Brand compact={collapsed} /><button className="ml-auto rounded-lg p-1.5 hover:bg-sidebar-accent md:hidden" onClick={() => setSidebarOpen(false)}><X className="size-4" /></button></div>
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {navigationGroups.map((group) => {
            return <div key={group.label} className="mb-5"><p className={cn("mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40", collapsed && "md:hidden")}>{group.label}</p><div className="space-y-1">{group.items.map((item) => { const active = pathname === item.href || (item.href === "/dashboard/myClients" && pathname.startsWith("/dashboard/myClients")); return <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)} title={collapsed ? item.title : undefined} className={cn("flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-sidebar-primary/10 font-medium text-sidebar-primary" : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground", collapsed && "md:justify-center md:px-0")}><item.icon className="size-4 shrink-0" /><span className={cn(collapsed && "md:hidden")}>{item.title}</span>{active && !collapsed && <ChevronRight className="ml-auto size-3.5 opacity-50" />}</Link>; })}</div></div>;
          })}
        </nav>
        <div className={cn("border-t border-sidebar-border/50 p-3", collapsed && "md:px-2")}><div className={cn("flex items-center gap-2.5 rounded-lg bg-sidebar-accent/60 p-2", collapsed && "md:justify-center md:bg-transparent md:p-0")}><EmployeeAvatar small /><div className={cn("min-w-0", collapsed && "md:hidden")}><p className="truncate text-xs font-medium">Employee workspace</p><p className="truncate text-[10px] text-sidebar-foreground/45">{employee.workspace}</p></div></div></div>
      </aside>

      <div className={cn("min-h-svh transition-[padding] duration-200 md:pl-64", collapsed && "md:pl-[68px]")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/70 bg-background/90 px-4 backdrop-blur-xl sm:px-6"><button aria-label="Open navigation" className="rounded-lg p-2 hover:bg-muted md:hidden" onClick={() => setSidebarOpen(true)}><Menu className="size-5" /></button><button aria-label="Toggle sidebar" className="hidden rounded-lg p-2 text-muted-foreground hover:bg-muted md:block" onClick={() => setCollapsed((value) => !value)}><Menu className="size-4" /></button><span className="shrink-0 text-sm font-semibold">{currentRoute}</span><button onClick={() => setSearchOpen(true)} className="ml-auto flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted/60 sm:ml-8"><Search className="size-4 shrink-0 opacity-60" /><span className="truncate text-left">Search tasks, clients, shipments...</span><kbd className="ml-auto hidden shrink-0 text-[10px] sm:inline">⌘ K</kbd></button><Link href="/dashboard/notifications" aria-label="Notifications" className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Bell className="size-[18px]" /><span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" /></Link><button aria-label="Toggle theme" disabled={!themeReady} onClick={toggleTheme} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none">{!themeReady ? <span className="block size-4" /> : theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button><div className="relative" ref={profileRef}><button onClick={() => setProfileOpen((value) => !value)} aria-label="Open employee menu"><EmployeeAvatar small /></button>{profileOpen && <div className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-lg"><div className="border-b border-border/60 px-3 py-2"><p className="text-sm font-medium">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.email}</p></div><Link href="/dashboard/profile" onClick={() => setProfileOpen(false)} className="mt-1 block rounded-lg px-3 py-2 text-sm hover:bg-accent">Profile</Link><Link href="/dashboard/settings" onClick={() => setProfileOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-accent">Settings</Link></div>}</div></header>
        <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">{children}</main>
      </div>
      {searchOpen && <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 pt-[18vh] backdrop-blur-sm" onClick={() => setSearchOpen(false)}><div className="mx-4 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex h-14 items-center gap-3 border-b border-border/60 px-4"><Search className="size-5 text-muted-foreground" /><input ref={searchRef} placeholder="Search tasks, clients, shipments..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" /><kbd className="text-[10px] text-muted-foreground">ESC</kbd></div><div className="p-5 text-center text-sm text-muted-foreground">Start typing to search across your workspace.</div></div></div>}
    </div>
  );
}
