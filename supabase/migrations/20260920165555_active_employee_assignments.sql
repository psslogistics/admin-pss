-- Keep assignment state explicit so API and RLS authorization share one contract.
alter table public.employee_client_assignments
  add column if not exists is_active boolean not null default true;

create index if not exists employee_client_assignments_active_scope_idx
  on public.employee_client_assignments (employee_user_id, client_id)
  where is_active = true;

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
      and eca.is_active = true
  );
$$;
