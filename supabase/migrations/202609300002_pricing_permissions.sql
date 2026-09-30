-- Keep the Worker pricing permission vocabulary available to the Admin
-- deployment's shared Supabase catalogue as well.
INSERT INTO public.permissions
  (permission_key, label, description, permission_group)
VALUES
  ('admin.pricing.view', 'View client pricing', 'View client-scoped PSS Delhivery B2B pricing configuration.', 'Pricing'),
  ('admin.pricing.manage', 'Manage client pricing', 'Create and edit draft PSS Delhivery B2B pricing versions.', 'Pricing'),
  ('admin.pricing.publish', 'Publish client pricing', 'Publish a validated PSS Delhivery B2B pricing version.', 'Pricing'),
  ('admin.pricing.override', 'Override shipment pricing', 'Apply an audited client-facing shipment pricing override.', 'Pricing'),
  ('admin.provider_cost.view', 'View provider cost and margin', 'View internal Delhivery cost and margin data.', 'Pricing')
ON CONFLICT (permission_key) DO UPDATE SET
  label = excluded.label,
  description = excluded.description,
  permission_group = excluded.permission_group;
