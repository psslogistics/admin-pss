import { NextResponse } from 'next/server';
import { resolveEmployeeWorkspaceRedirect } from '@/lib/auth/workspace-redirect';

export async function GET(request: Request) {
  const redirectTo = await resolveEmployeeWorkspaceRedirect(request);
  return NextResponse.json({ ok: true, redirect_to: redirectTo }, { headers: { 'Cache-Control': 'no-store' } });
}
