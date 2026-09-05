import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render the value in IBM Plex Mono — for TFN, BSB, dollar amounts. */
  mono?: boolean;
}

/**
 * Text input matching the design canvas. Pair with {@link Field} for the label,
 * hint and error; the consumer wires `aria-invalid` / `aria-describedby` (Field
 * documents the ids it produces). Forwards its ref so a form can focus a
 * specific field programmatically (e.g. the first invalid one on submit).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[
        "min-h-[38px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text",
        "placeholder:text-muted focus-visible:border-accent focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-danger",
        "disabled:opacity-50",
        mono ? "font-mono tabular-nums" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
});
