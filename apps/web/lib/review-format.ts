/** Money formatting for the estimate breakdown rows (`lib/estimate/breakdown.ts`). */

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
