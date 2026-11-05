import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'


const getEmployeeAccess = cache(async () => {
  const supabase = await createClient(); const claimsResult = await supabase.auth.getClaims(); const userId = claimsResult.data?.claims?.sub;
  if (!userId) redirect('/sign-in');
  const [{ data, error: profileError }, { data: employeeProfile, error: employeeProfileError }, { data: assignments, error: assignmentsError }, { data: authContext, error: authContextError }, { data: employeeAssignments, error: employeeAssignmentsError }] = await Promise.all([
    supabase.from('profiles').select('id,email,display_name,status,must_change_password').eq('id', userId).maybeSingle(),
    supabase.from('employee_profiles').select('employee_code,workspace_slug,employment_status').eq('user_id', userId).maybeSingle(),
    supabase.from('user_roles').select('is_active,role_id').eq('user_id', userId),
    supabase.rpc('get_auth_context'),
    supabase.from('employee_client_assignments').select('client_id,client_accounts(id,legal_name,status)').eq('employee_user_id', userId).eq('is_active', true),
  ]);
  if (profileError || employeeProfileError || assignmentsError || authContextError || employeeAssignmentsError) redirect('/access-denied?reason=database');
  const roleIds = (assignments ?? []).map((item) => item.role_id);
  const { data: roleRows, error: rolesError } = roleIds.length ? await supabase.from('roles').select('id,role_code,scope').in('id', roleIds) : { data: [], error: null };
  if (rolesError) redirect('/access-denied?reason=database');
  const roles = (assignments ?? []).map((assignment) => ({ is_active: assignment.is_active, role: (roleRows ?? []).find((role) => role.id === assignment.role_id) }));
  if (!data || data.status !== 'active' || !roles.some((item) => item.is_active === true && (item.role?.scope === 'employee' || item.role?.scope === 'system'))) redirect('/access-denied');
  const hasSystemRole = roles.some((item) => item.is_active === true && item.role?.scope === 'system');
  if (!hasSystemRole) {
    if (!employeeProfile || employeeProfile.employment_status !== 'active') redirect('/access-denied?reason=employee-inactive');
  }
  if (data.must_change_password === true) redirect('/reset-password?required=1');
  const activeRoleIds = (assignments ?? []).filter((assignment) => assignment.is_active === true).map((assignment) => assignment.role_id);
  const { data: directRolePermissions, error: directRolePermissionsError } = activeRoleIds.length
    ? await supabase.from('role_permissions').select('role_id,permission_key').in('role_id', activeRoleIds)
    : { data: [], error: null };
  if (directRolePermissionsError) redirect('/access-denied?reason=database');
  const context = (authContext && typeof authContext === 'object' ? authContext : {}) as {
    permissions?: Array<{ permission_key?: string }>; permission_overrides?: Array<{ permission_key?: string; mode?: string }>; active_client_ids?: string[];
  };
  const directPermissions = (directRolePermissions ?? []).map((item) => item.permission_key).filter((item): item is string => Boolean(item));
  // Keep the server-rendered navigation on the same permission snapshot as
  // has_permission(). The direct role query is only a fallback for older
  // deployments where get_auth_context() has not been installed yet.
  const contextPermissions = (context.permissions ?? []).map((item) => item.permission_key).filter((item): item is string => Boolean(item));
  const permissions = new Set((contextPermissions.length ? contextPermissions : directPermissions).filter((item): item is string => Boolean(item)));
  for (const override of context.permission_overrides ?? []) {
