import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function requireEmployeeAccess() {
  const supabase = await createClient(); const claimsResult = await supabase.auth.getClaims(); const userId = claimsResult.data?.claims?.sub;
  if (!userId) redirect('/sign-in');
  const { data } = await supabase.from('profiles').select('id,email,display_name,status,user_roles(role:roles(role_code,scope))').eq('id', userId).maybeSingle();
  const roles = (data?.user_roles ?? []) as Array<{ role?: { role_code?: string; scope?: string } }>;
  if (!data || data.status !== 'active' || !roles.some((item) => item.role?.scope === 'employee' || item.role?.scope === 'system')) redirect('/access-denied');
  return { userId, profile: data, roles };
}
