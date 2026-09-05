import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native `<select>` styled to match {@link Input}. Pair with {@link Field} the
 * same way. A native element keeps full keyboard support for free.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={[
        "min-h-[38px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text",
        "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "aria-[invalid=true]:border-danger disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
});
