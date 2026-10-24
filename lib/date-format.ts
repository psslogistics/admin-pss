const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDate(value: unknown, fallback = "Not provided") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const dateOnly = raw.match(dateOnlyPattern);
  if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${String(parsed.getDate()).padStart(2, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${parsed.getFullYear()}`;
}

export function formatDateTime(value: unknown, fallback = "Not provided") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${formatDate(raw)} ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}
