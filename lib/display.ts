export function formatStatusLabel(value: unknown, fallback = "Not provided") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const words = text.replace(/[_-]+/g, " ").replace(/\s+/g, " ").split(" ").map((word) => /^[A-Z0-9/&]+$/.test(word) ? word : word.toLowerCase());
  return words.join(" ").replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}
