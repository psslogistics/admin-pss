import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveEmployeeWorkspaceRedirect } from '@/lib/auth/workspace-redirect'
import { safeNextPath } from '@/lib/auth/workspace-routing'

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get('code'); const next = safeNextPath(url.searchParams.get('next'));
  if (code) { const supabase = await createClient(); await supabase.auth.exchangeCodeForSession(code); }
  if (next === '/dashboard') {
    const workspaceRedirect = await resolveEmployeeWorkspaceRedirect(request);
    if (workspaceRedirect) return NextResponse.redirect(workspaceRedirect);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
