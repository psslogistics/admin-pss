-- Collapse the authenticated Worker bootstrap reads into one verified call.
-- The function accepts no user-controlled identity or scope and derives every
-- value from auth.uid(). It is kept in the private schema and exposed only
-- through a locked-down authenticated wrapper.
create or replace function private.get_auth_context()
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  with current_identity as (
    select auth.uid() as user_id
  ),
  role_links as (
    select ur.role_id
    from public.user_roles ur
    where ur.user_id = (select user_id from current_identity)
      and ur.is_active = true
  ),
  requested_clients as (
    select eca.client_id
    from public.employee_client_assignments eca
    where eca.employee_user_id = (select user_id from current_identity)
      and eca.is_active = true
    union
    select cm.client_id
    from public.client_memberships cm
    where cm.user_id = (select user_id from current_identity)
      and cm.membership_status = 'active'
  ),
  active_clients as (
    select ca.id
    from public.client_accounts ca
    join requested_clients rc on rc.client_id = ca.id
    where ca.status = 'active'
  )
  select case
    when (select user_id from current_identity) is null then null::jsonb
    else jsonb_build_object(
      'user_id', (select user_id from current_identity),
      'profile_status', (select p.status from public.profiles p where p.id = (select user_id from current_identity) limit 1),
      'employment_status', (select ep.employment_status from public.employee_profiles ep where ep.user_id = (select user_id from current_identity) limit 1),
      'roles', coalesce((select jsonb_agg(jsonb_build_object('role_code', r.role_code, 'scope', r.scope)) from public.roles r join role_links rl on rl.role_id = r.id), '[]'::jsonb),
      'role_ids', coalesce((select jsonb_agg(jsonb_build_object('role_id', role_id)) from role_links), '[]'::jsonb),
      'permissions', coalesce((select jsonb_agg(jsonb_build_object('permission_key', rp.permission_key)) from public.role_permissions rp join role_links rl on rl.role_id = rp.role_id), '[]'::jsonb),
      'permission_overrides', coalesce((select jsonb_agg(jsonb_build_object('permission_key', epo.permission_key, 'mode', epo.mode)) from public.employee_permission_overrides epo where epo.employee_user_id = (select user_id from current_identity)), '[]'::jsonb),
      'assignments', coalesce((select jsonb_agg(jsonb_build_object('client_id', eca.client_id)) from public.employee_client_assignments eca where eca.employee_user_id = (select user_id from current_identity) and eca.is_active = true), '[]'::jsonb),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object('client_id', cm.client_id, 'membership_status', cm.membership_status)) from public.client_memberships cm where cm.user_id = (select user_id from current_identity) and cm.membership_status = 'active'), '[]'::jsonb),
      'active_client_ids', coalesce((select jsonb_agg(ac.id) from active_clients ac), '[]'::jsonb)
    )
  end;
$$;

revoke all on function private.get_auth_context() from public, anon;
grant execute on function private.get_auth_context() to authenticated, service_role;

create or replace function public.get_auth_context()
returns jsonb
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.get_auth_context();
$$;

revoke all on function public.get_auth_context() from public, anon;
grant execute on function public.get_auth_context() to authenticated, service_role;
