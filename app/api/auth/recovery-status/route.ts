import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ allowed: false }, { status: 401 });
  const required = new URL(request.url).searchParams.get('required') === '1';
  if (required) { const { data: profile } = await supabase.from('profiles').select('must_change_password').eq('id', user.id).maybeSingle(); if (profile?.must_change_password !== true) return NextResponse.json({ allowed: false }, { status: 403 }); }
  else if ((await cookies()).get('pss_password_recovery')?.value !== '1') return NextResponse.json({ allowed: false }, { status: 401 });
  return NextResponse.json({ allowed: true });
}
