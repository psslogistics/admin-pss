"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deriveAuthIdentity, saveAuthIdentity } from "@/lib/auth-identity";

const inputClass = "h-11 w-full border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-2 focus:ring-neutral-950/10 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:focus:border-white";

export default function AuthScreen() {
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("pss-theme");
    const next = saved === "dark" || saved === "light" ? saved : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.classList.toggle("dark", next === "dark");
    const timer = window.setTimeout(() => setTheme(next), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    window.localStorage.setItem("pss-theme", next);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const normalizedIdentity = identity.trim().toLowerCase();
    if (!normalizedIdentity || !password) { setError("Enter your official work email and password."); return; }
    if (!/^[^@\s]+@psslogistics\.in$/.test(normalizedIdentity)) { setError("Use your official @psslogistics.in email address to access this workspace."); return; }
    const authIdentity = deriveAuthIdentity(normalizedIdentity);
    if (!authIdentity) { setError("Enter a valid official work email address."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (identity.toLowerCase().includes("invalid") || password.toLowerCase().includes("invalid")) { setError("The demo credentials were not accepted. Try another value."); return; }
    saveAuthIdentity(authIdentity);
    setSubmitting(true);
    window.setTimeout(() => { setSubmitting(false); setNotice("Signed in successfully in demo mode."); window.setTimeout(() => router.push("/dashboard"), 450); }, 500);
  };

  return <main className="min-h-screen bg-neutral-100 text-neutral-950 dark:bg-neutral-950 dark:text-white"><div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-between px-5 py-6 sm:px-8 sm:py-8"><header className="flex items-center justify-between"><Link href="/sign-in" className="text-sm font-semibold tracking-[0.18em]">PSS LOGISTICS</Link><button type="button" onClick={toggleTheme} className="border border-neutral-300 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-neutral-600 hover:border-neutral-950 hover:text-neutral-950 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-white dark:hover:text-white">{theme === "dark" ? "Light" : "Dark"} mode</button></header><section className="grid w-full flex-1 place-items-center py-12"><div className="grid w-full max-w-4xl overflow-hidden border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 lg:grid-cols-[0.85fr_1.15fr]"><div className="hidden border-r border-neutral-300 bg-neutral-200 p-10 dark:border-neutral-700 dark:bg-neutral-900 lg:flex lg:flex-col lg:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500 dark:text-neutral-400">Admin access</p><h1 className="mt-6 max-w-xs text-4xl font-semibold leading-tight tracking-[-0.04em]">Keep every operation moving.</h1></div><p className="max-w-xs text-xs leading-5 text-neutral-500 dark:text-neutral-400">A focused gateway for assigned clients, tasks, support, and operational activity.</p></div><div className="p-6 sm:p-10"><div className="mb-8"><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500 dark:text-neutral-400">Admin / Employee portal</p><h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Sign in to continue</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Use your official @psslogistics.in email to open the internal operations workspace.</p></div><form onSubmit={submit} noValidate className="space-y-4"><label className="block text-xs font-semibold">Official work email<input value={identity} onChange={(event) => setIdentity(event.target.value)} className={`${inputClass} mt-1.5`} autoComplete="username" inputMode="email" /></label><label className="block text-xs font-semibold">Password<div className="relative mt-1.5"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pr-16`} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-950 dark:hover:text-white">{showPassword ? "Hide" : "Show"}</button></div></label><label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-3.5 accent-neutral-950" /> Remember me</label>{error && <p role="alert" className="border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}{notice && <p role="status" className="border border-neutral-300 bg-neutral-100 px-3 py-2.5 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">{notice}</p>}<button type="submit" disabled={submitting} className="h-11 w-full border border-neutral-950 bg-neutral-950 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-wait disabled:opacity-50 dark:border-white dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200">{submitting ? "Working…" : "Sign in"}</button></form><div className="mt-6 border-t border-neutral-200 pt-5 text-xs dark:border-neutral-800"><button type="button" onClick={() => setNotice("Password recovery is WILL DO LATER.")} className="text-neutral-500 underline underline-offset-4 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">Forgot password?</button><p className="mt-3 text-neutral-500 dark:text-neutral-400">Admin and Employee accounts are provisioned internally. There is no public sign-up.</p></div></div></div></section><footer className="flex justify-between text-[10px] uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-500"><span>Admin / Employee workspace</span><span>Frontend demo</span></footer></div></main>;
}
