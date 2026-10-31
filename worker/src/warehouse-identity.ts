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

export function canonicalDelhiveryWarehouseName(name: string, city?: string, state?: string, pincode?: string) {
  const clean = (value: unknown) => String(value ?? "").replace(/[^A-Za-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const base = clean(name) || "PSS Warehouse";
  const suffix = [clean(city), clean(state), clean(pincode)].filter(Boolean).join(" ");
  if (suffix && base.toLowerCase().endsWith(suffix.toLowerCase())) return base;
  return [base, suffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function isVerifiedDelhiveryWarehouse<T extends {
  provider?: string | null;
  provider_account_id?: string | null;
  provider_status?: string | null;
  provider_reference?: string | null;
  provider_activated_at?: string | null;
}>(warehouse: T | null | undefined, providerAccountId?: string | null): warehouse is T {
  return Boolean(warehouse
    && String(warehouse.provider ?? "").trim().toLowerCase() === "delhivery"
    && (warehouse.provider_account_id ?? null) === (providerAccountId ?? null)
    && String(warehouse.provider_status ?? "").trim().toLowerCase() === "active"
    && warehouse.provider_reference?.trim()
    && warehouse.provider_activated_at?.trim());
}

export function delhiveryFacilityMatches(row: Record<string, unknown>, requestedName: string, requestedPincode: string, storedProviderReference?: string | null, localWarehouseName?: string | null, allowStaleProviderReference = false) {
  const rowStatus = String(row.status ?? row.facility_status ?? row.state ?? "ACTIVE").toLowerCase();
  const activeFlag = row.is_active ?? row.active ?? row.enabled ?? row.is_enabled;
  if (["inactive", "disabled", "deleted", "deactivated"].includes(rowStatus) || activeFlag === false || activeFlag === 0 || String(activeFlag).toLowerCase() === "false") return false;
  const rowPin = providerField(row, ["pincode", "pin_code", "postal_code"]);
  const rowName = providerField(row, ["facility_name", "name", "client_warehouse_name", "warehouse_name"]);
  const rowId = providerField(row, ["facility_id", "id", "client_warehouse_uuid", "uuid"]);
  if (storedProviderReference && rowId && rowId !== storedProviderReference && !allowStaleProviderReference) return false;
  const normalizedRowName = normalizeDelhiveryWarehouseIdentity(rowName);
  const nameMatches = normalizedRowName === normalizeDelhiveryWarehouseIdentity(requestedName)
    // Delhivery's console/API can return the saved facility name without the
    // canonical city/state/PIN suffix that PSS sends during registration.
    // The selected local warehouse is still the identity anchor; the PIN
    // check below prevents a same-name facility at another location from
    // being reused.
    || Boolean(localWarehouseName && normalizedRowName === normalizeDelhiveryWarehouseIdentity(localWarehouseName));
  return nameMatches && (!requestedPincode || !rowPin || rowPin.replace(/\D/g, "") === requestedPincode.replace(/\D/g, ""));
}
