/**
 * Money formatting for the export package. The engine has already applied the
 * FR-15 rounding rules — these helpers only *display*, they never re-round.
 */

/**
 * A consistent `"$1,234.56"` (always two decimal places, thousands grouped,
 * a leading `-` for a negative amount) for the PDF and the plain-text reports.
 * `null` renders as `"—"`.
 */
export function formatDollars(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const grouped = abs.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${grouped}`;
}

/** Sum of the non-null numbers in `values`, to the cent. */
export function sumToCents(values: readonly (number | null | undefined)[]): number {
  const total = values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}
