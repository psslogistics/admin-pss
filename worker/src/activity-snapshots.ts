const auditSafeFields = new Set([
  "status", "priority", "assigned_to_user_id", "deadline", "due_at", "attempt", "severity",
  "settled_at", "measured_weight_kg", "billable_weight_kg", "total_weight_kg", "declared_value",
  "pieces", "is_test",
]);

type Update = { field: string; value: unknown };

export function activitySnapshotPair(before: Record<string, unknown>, updates: Update[]) {
  const prior: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const update of updates) {
    if (!auditSafeFields.has(update.field)) continue;
    prior[update.field] = before[update.field] ?? null;
    next[update.field] = update.value ?? null;
  }
  return Object.keys(next).length ? { before: prior, after: next } : {};
}
