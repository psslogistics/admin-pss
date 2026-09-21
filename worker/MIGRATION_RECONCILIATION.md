# D1 migration reconciliation

This document records the distinction between Wrangler's migration ledger and the live schema. It is evidence for release review; it is not a replacement for a tested backup/rollback procedure.

Evidence collected on 2026-09-19 from the remote `psslogisticsdatabase` database:

| Source migration | Live schema evidence | Ledger status |
| --- | --- | --- |
| `0004_support_ticket_sla.sql` | `support_tickets` contains `sla_due_at` and `escalation_state` | Not recorded in `d1_migrations` |
| `0005_schema_contract_alignment.sql` | `notifications` contains `category` | Not recorded in `d1_migrations` |
| `0006_master_records.sql` | `master_records` exists with the expected columns | Not recorded in `d1_migrations` |
| `0007_employee_preferences.sql` | `employee_preferences` exists with the expected columns | Not recorded in `d1_migrations` |
| `20260917_production_contract.sql` | `tasks` and `request_rate_limits` are part of the deployed schema | Recorded in `d1_migrations` |
| `20260918_address_kinds.sql` | `client_addresses.address_kind` is present in the deployed schema | Recorded in `d1_migrations` |
| `20260918_pickup_operations.sql` | `pickup_requests` contains assignment, failure, provider, and provider-reference columns | Not recorded in `d1_migrations` |
| `20260918_shipment_addresses.sql` | `shipments` contains origin and destination address JSON columns | Not recorded in `d1_migrations` |
| `20260918_standalone_pickups.sql` | `pickup_requests.shipment_id` is nullable in the deployed table definition | Not recorded in `d1_migrations` |
| `20260918_tracking_events.sql` | `tracking_events` exists with the normalized Worker event columns | Not recorded in `d1_migrations` |
| `20260919_departments.sql` | `departments` exists with status, manager, capacity, and audit ownership columns | Applied directly with `wrangler d1 execute --remote`; intentionally not replayed through the drifted ledger |
| `20260919_provider_accounts.sql` | `provider_accounts` exists with provider, client binding, secret-name, capability, and status columns | Applied directly with `wrangler d1 execute --remote`; intentionally not replayed through the drifted ledger |
| `20260920_tracking_lookup_indexes.sql` | Dedicated indexes for `shipments.tracking_number` and `shipments.provider_reference` | Applied directly with `wrangler d1 execute --remote` on 2026-09-21; verified in `sqlite_master`; intentionally not replayed through the drifted ledger |

The remote ledger currently contains only `20260917_production_contract.sql` and `20260918_address_kinds.sql`. The unrecorded files include non-idempotent `ALTER TABLE` or table-rebuild statements; they must not be replayed against production merely to populate history. Any future reconciliation must use a verified backup, a controlled migration/rollback exercise, and explicit change approval.

The departments contract was applied directly on 2026-09-19 after the table definition was reviewed. Wrangler reported three statements executed, one schema change, and a successful production bookmark. This direct execution is recorded here so the table is not accidentally replayed by a future blanket `migrations apply` command.

The provider-account contract was applied directly on 2026-09-19 after the account-binding fields and secret-name validation were reviewed. Wrangler reported three statements executed, one schema change, and a successful production bookmark. The Worker resolves a client-specific active binding server-side and never accepts a raw provider credential from a browser.

The tracking lookup indexes were applied directly on 2026-09-21 after a live schema query confirmed both indexes were absent. Wrangler reported two statements executed, two rows written, and a successful production bookmark; a follow-up `sqlite_master` query verified `idx_shipments_tracking_number` and `idx_shipments_provider_reference_lookup`. This additive change was not inserted into the drifted migration ledger.
