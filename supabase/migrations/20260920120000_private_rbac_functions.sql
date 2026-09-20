-- Keep privileged RLS helpers out of the exposed public API schema.
-- Public wrappers preserve existing policy and client RPC names.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.is_active
      and r.role_code = 'super_admin' and p.status = 'active'
  );
$$;

create or replace function private.is_client_member(target_client uuid)
returns boolean language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.client_memberships cm
    join public.profiles p on p.id = cm.user_id
    where cm.user_id = auth.uid() and p.status = 'active'
      and cm.client_id = target_client and cm.membership_status = 'active'
  );
$$;

create or replace function private.is_employee_assigned(target_client uuid)
returns boolean language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.employee_client_assignments eca
    join public.profiles p on p.id = eca.employee_user_id
    join public.employee_profiles ep on ep.user_id = eca.employee_user_id
    where eca.employee_user_id = auth.uid() and p.status = 'active'
      and ep.employment_status = 'active' and eca.client_id = target_client
  );
$$;

create or replace function private.has_permission(required_permission text)
returns boolean language sql stable security definer
set search_path = public, private
as $$
  select private.is_super_admin() or exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    left join public.employee_profiles ep on ep.user_id = ur.user_id
    where ur.user_id = auth.uid() and ur.is_active = true and p.status = 'active'
      and (r.scope = 'system' or (r.scope = 'employee' and ep.employment_status = 'active'))
      and (
        exists (select 1 from public.role_permissions rp where rp.role_id = ur.role_id and rp.permission_key = required_permission)
        or exists (select 1 from public.employee_permission_overrides e where e.employee_user_id = ur.user_id and e.permission_key = required_permission and e.mode = 'grant')
      )
      and not exists (select 1 from public.employee_permission_overrides e where e.employee_user_id = ur.user_id and e.permission_key = required_permission and e.mode = 'revoke')
  );
$$;

create or replace function private.complete_password_change()
returns void language sql security definer
set search_path = public, private
as $$
  update public.profiles set must_change_password = false, updated_at = now()
  where id = auth.uid() and status = 'active';
$$;

revoke all on function private.is_super_admin() from public;
revoke all on function private.is_client_member(uuid) from public;
revoke all on function private.is_employee_assigned(uuid) from public;
revoke all on function private.has_permission(text) from public;
revoke all on function private.complete_password_change() from public;
grant execute on function private.is_super_admin() to authenticated, service_role;
grant execute on function private.is_client_member(uuid) to authenticated, service_role;
grant execute on function private.is_employee_assigned(uuid) to authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated, service_role;
grant execute on function private.complete_password_change() to authenticated, service_role;

create or replace function public.is_super_admin()
returns boolean language sql stable security invoker set search_path = public, private
as $$ select private.is_super_admin(); $$;
create or replace function public.is_client_member(target_client uuid)
returns boolean language sql stable security invoker set search_path = public, private
as $$ select private.is_client_member(target_client); $$;
create or replace function public.is_employee_assigned(target_client uuid)
returns boolean language sql stable security invoker set search_path = public, private
as $$ select private.is_employee_assigned(target_client); $$;
create or replace function public.has_permission(required_permission text)
returns boolean language sql stable security invoker set search_path = public, private
as $$ select private.has_permission(required_permission); $$;
create or replace function public.complete_password_change()
returns void language sql security invoker set search_path = public, private
as $$ select private.complete_password_change(); $$;

revoke all on function public.is_super_admin() from public;
revoke all on function public.is_client_member(uuid) from public;
revoke all on function public.is_employee_assigned(uuid) from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.complete_password_change() from public;
grant execute on function public.is_super_admin() to authenticated, service_role;
grant execute on function public.is_client_member(uuid) to authenticated, service_role;
grant execute on function public.is_employee_assigned(uuid) to authenticated, service_role;
grant execute on function public.has_permission(text) to authenticated, service_role;
grant execute on function public.complete_password_change() to authenticated, service_role;
