"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, Mail, LockKeyhole } from "lucide-react";
import AuthShell from "./auth-shell";

export default function AuthScreen() {
  const router = useRouter(); const supabase = createClient();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setPending(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return setError(error.message);
      const response = await fetch("/api/auth/workspace-redirect", { cache: "no-store" });
      const result = await response.json() as { redirect_to?: string | null };
      if (result.redirect_to) return window.location.assign(result.redirect_to);
      router.replace("/dashboard"); router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to contact the authentication service. Please try again.");
    } finally { setPending(false); }
  }
  async function resetPassword() { setError(""); setNotice(""); if (!email.trim()) return setError("Enter your work email first."); const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` }); if (error) setError(error.message); else setNotice("Check your email for a password reset link."); }
  return <AuthShell eyebrow="Employee workspace" title="Welcome back" description="Sign in to coordinate shipments, clients, and daily operations."><form onSubmit={submit} className="space-y-5"><label className="block text-xs font-semibold text-[#344259]">Work email<div className="relative mt-2"><Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94a3b8]" /><input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your work email" className="h-12 w-full rounded-xl border border-[#dbe5f2] bg-[#f8fafc] pl-10 pr-3 text-sm text-[#172033] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-[#2563eb]/10" /></div></label><label className="block text-xs font-semibold text-[#344259]">Password<div className="relative mt-2"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94a3b8]" /><input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className="h-12 w-full rounded-xl border border-[#dbe5f2] bg-[#f8fafc] pl-10 pr-11 text-sm text-[#172033] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-[#2563eb]/10" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#94a3b8] hover:text-[#2563eb]">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></label>{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-700">{notice}</p>}<button disabled={pending} className="h-12 w-full rounded-xl bg-[#2563eb] text-sm font-semibold text-white shadow-lg shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Signing in…" : "Sign in to workspace"}</button><button type="button" onClick={resetPassword} className="mx-auto block text-xs font-semibold text-[#2563eb] hover:underline">Forgot password?</button></form></AuthShell>;
}
