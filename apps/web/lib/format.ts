/** `"2025-26"` → `"2025–26"` (en dash), matching the design canvas. */
export function formatIncomeYear(year: string): string {
  return year.replace("-", "–");
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" });

/** ISO-8601 → `"3 Sept 2026"`. Returns `"unknown"` for an unparseable value. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : DATE_FORMAT.format(date);
}
