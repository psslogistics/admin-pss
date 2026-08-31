import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function requireEmployeeAccess() {
  const supabase = await createClient(); const claimsResult = await supabase.auth.getClaims(); const userId = claimsResult.data?.claims?.sub;
  if (!userId) redirect('/sign-in');
  const { data, error: profileError } = await supabase.from('profiles').select('id,email,display_name,status,user_roles(is_active,role:roles(role_code,scope))').eq('id', userId).maybeSingle();
  if (profileError) redirect('/access-denied?reason=database');
  const roles = (data?.user_roles ?? []) as Array<{ is_active?: boolean; role?: { role_code?: string; scope?: string } }>;
  if (!data || data.status !== 'active' || !roles.some((item) => item.is_active === true && (item.role?.scope === 'employee' || item.role?.scope === 'system'))) redirect('/access-denied');
  const hasSystemRole = roles.some((item) => item.is_active === true && item.role?.scope === 'system');
  if (!hasSystemRole) {
    const { data: employeeProfile, error: employeeProfileError } = await supabase.from('employee_profiles').select('employment_status').eq('user_id', userId).maybeSingle();
    if (employeeProfileError) redirect('/access-denied?reason=database');
    if (!employeeProfile || employeeProfile.employment_status !== 'active') redirect('/access-denied?reason=employee-inactive');
  }
  return { userId, profile: data, roles };
}
