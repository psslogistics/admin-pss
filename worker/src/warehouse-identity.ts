function providerField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return "";
}

export function normalizeDelhiveryWarehouseIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function delhiveryFacilityMatches(row: Record<string, unknown>, requestedName: string, requestedPincode: string, storedProviderReference?: string | null) {
  const rowStatus = String(row.status ?? row.facility_status ?? row.state ?? "ACTIVE").toLowerCase();
  const activeFlag = row.is_active ?? row.active ?? row.enabled ?? row.is_enabled;
  if (["inactive", "disabled", "deleted", "deactivated"].includes(rowStatus) || activeFlag === false || activeFlag === 0 || String(activeFlag).toLowerCase() === "false") return false;
  const rowPin = providerField(row, ["pincode", "pin_code", "postal_code"]);
  const rowName = providerField(row, ["facility_name", "name", "client_warehouse_name", "warehouse_name"]);
  const rowId = providerField(row, ["facility_id", "id", "client_warehouse_uuid", "uuid"]);
  if (storedProviderReference && rowId && rowId !== storedProviderReference) return false;
  const nameMatches = normalizeDelhiveryWarehouseIdentity(rowName) === normalizeDelhiveryWarehouseIdentity(requestedName);
  return nameMatches && (!requestedPincode || !rowPin || rowPin.replace(/\D/g, "") === requestedPincode.replace(/\D/g, ""));
}
