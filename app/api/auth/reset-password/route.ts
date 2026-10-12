import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Your session has expired.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { password?: string; required?: boolean };
  const required = body.required === true;
  if (required) { const { data: profile } = await supabase.from('profiles').select('must_change_password').eq('id', user.id).maybeSingle(); if (profile?.must_change_password !== true) return NextResponse.json({ error: 'This password-change request is not authorized.' }, { status: 403 }); }
  else if ((await cookies()).get('pss_password_recovery')?.value !== '1') return NextResponse.json({ error: 'Use the secure password-reset link sent to your email.' }, { status: 401 });
  if (!body.password || body.password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  const { error } = await supabase.auth.updateUser({ password: body.password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
