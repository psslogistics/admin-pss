export type PssErrorCategory = "auth" | "permission" | "provider" | "configuration" | "network" | "server" | "request";
export type PssErrorDetails = { category: PssErrorCategory; message: string; technicalMessage: string; providerCode?: string; requestId?: string; retryable: boolean; staleData: boolean };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

export function getPssErrorDetails(error: unknown, fallback = "The production request could not be completed."): PssErrorDetails {
  const sourceRecord = record(error);
  const source = sourceRecord.payload && typeof sourceRecord.payload === "object" ? { ...record(sourceRecord.payload), status: sourceRecord.status } : sourceRecord;
  const nested = record(source.error);
  const technicalMessage = typeof nested.technical_message === "string" ? nested.technical_message : typeof sourceRecord.message === "string" ? sourceRecord.message : fallback;
  const contractCategory = nested.category;
  const status = Number(sourceRecord.status ?? source.status ?? nested.status ?? 0);
  const providerCode = [nested.provider_code, nested.code, source.provider_code, source.providerCode].find((value) => typeof value === "string") as string | undefined;
  const requestId = [source.request_id, source.requestId, nested.request_id, nested.requestId].find((value) => typeof value === "string") as string | undefined;
  const normalized = technicalMessage.toLowerCase();
  const category: PssErrorCategory = ["auth", "permission", "provider", "configuration", "network", "server", "request"].includes(String(contractCategory)) ? contractCategory as PssErrorCategory : status === 401 || normalized.includes("session has expired") ? "auth" : status === 403 ? "permission" : normalized.includes("not configured") || normalized.includes("configuration") ? "configuration" : providerCode || normalized.includes("provider") || normalized.includes("delhivery") ? "provider" : status >= 500 ? "server" : status === 0 ? "network" : "request";
  const message = typeof nested.user_safe_message === "string" ? nested.user_safe_message : category === "auth" ? "Your session has expired. Please sign in again." : category === "permission" ? "You do not have permission to complete this operation." : category === "configuration" ? "This operational connection is not configured yet." : category === "provider" ? "The courier provider could not complete this operation." : category === "network" || category === "server" ? "Production data is temporarily unavailable. Existing records are unchanged." : technicalMessage === "The PSS API request failed." ? fallback : technicalMessage;
  return { category, message, technicalMessage, providerCode, requestId, retryable: typeof nested.retryable === "boolean" ? nested.retryable : category === "network" || category === "server" || category === "provider" || [408, 409, 429].includes(status), staleData: typeof nested.stale_data === "boolean" ? nested.stale_data : false };
}
