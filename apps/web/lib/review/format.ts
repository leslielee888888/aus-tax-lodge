/** Formatting helpers shared by the review screen's server-built rows and client rows. */

/** `1234.5` → `"$1,234.50"`; whole-dollar values drop the cents; `null` → `"—"`. Negative values use a minus sign (a rental loss). */
export function formatMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  const formatted = abs.toLocaleString("en-AU", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "−" : ""}$${formatted}`;
}

/** A plain count/number, or `"—"` for `null`. */
export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-AU");
}

/** `50` → `"50%"`, `null` → `"—"`. */
export function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}
