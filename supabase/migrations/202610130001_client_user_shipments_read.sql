-- Client users need shipment-list read access for the Client All Shipments page.
-- Keep this idempotent so it is safe to apply to environments that already have it.
insert into public.permissions (permission_key, label, description, permission_group, panel, assignable_to_employee)
values ('shipments.read', 'View shipments', 'View client shipments and shipment details.', 'Operations', 'shared', false)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'shipments.read'
from public.roles r
where r.role_code = 'client_user'
  and not exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = r.id
      and existing.permission_key = 'shipments.read'
  );
