import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function requireEmployeeAccess() {
  const supabase = await createClient(); const claimsResult = await supabase.auth.getClaims(); const userId = claimsResult.data?.claims?.sub;
  if (!userId) redirect('/sign-in');
  const { data, error: profileError } = await supabase.from('profiles').select('id,email,display_name,status,must_change_password').eq('id', userId).maybeSingle();
  if (profileError) redirect('/access-denied?reason=database');
  const { data: assignments, error: assignmentsError } = await supabase.from('user_roles').select('is_active,role_id').eq('user_id', userId);
  if (assignmentsError) redirect('/access-denied?reason=database');
  const roleIds = (assignments ?? []).map((item) => item.role_id);
  const { data: roleRows, error: rolesError } = roleIds.length ? await supabase.from('roles').select('id,role_code,scope').in('id', roleIds) : { data: [], error: null };
  if (rolesError) redirect('/access-denied?reason=database');
  const roles = (assignments ?? []).map((assignment) => ({ is_active: assignment.is_active, role: (roleRows ?? []).find((role) => role.id === assignment.role_id) }));
  if (!data || data.status !== 'active' || !roles.some((item) => item.is_active === true && (item.role?.scope === 'employee' || item.role?.scope === 'system'))) redirect('/access-denied');
  const hasSystemRole = roles.some((item) => item.is_active === true && item.role?.scope === 'system');
  if (!hasSystemRole) {
    const { data: employeeProfile, error: employeeProfileError } = await supabase.from('employee_profiles').select('employment_status').eq('user_id', userId).maybeSingle();
    if (employeeProfileError) redirect('/access-denied?reason=database');
    if (!employeeProfile || employeeProfile.employment_status !== 'active') redirect('/access-denied?reason=employee-inactive');
  }
  if (data.must_change_password === true) redirect('/reset-password?required=1');
  return { userId, profile: data, roles };
}

export async function requireEmployeePermission(permission: string) {
  const actor = await requireEmployeeAccess();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('has_permission', { required_permission: permission });
  if (error) redirect('/access-denied?reason=database');
  if (!data) redirect('/access-denied?reason=permission');
  return actor;
}
