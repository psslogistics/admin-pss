import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveEmployeeWorkspaceRedirect } from '@/lib/auth/workspace-redirect'
import { safeNextPath } from '@/lib/auth/workspace-routing'

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get('code'); const next = safeNextPath(url.searchParams.get('next'));
  const response = NextResponse.redirect(new URL(next, url.origin));
  if (code) { const supabase = await createClient(); const { error } = await supabase.auth.exchangeCodeForSession(code); if (!error && next === '/reset-password') response.cookies.set('pss_password_recovery', '1', { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', maxAge: 600, path: '/reset-password' }); }
  if (next === '/dashboard') {
    const workspaceRedirect = await resolveEmployeeWorkspaceRedirect(request);
    if (workspaceRedirect) return NextResponse.redirect(workspaceRedirect);
  }
  return response;
}
