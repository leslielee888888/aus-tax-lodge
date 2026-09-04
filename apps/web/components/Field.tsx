import type { ReactNode } from "react";

export interface FieldProps {
  /** Visible label text. */
  label: ReactNode;
  /** `id` of the control this labels — also the stem for the hint/error ids. */
  htmlFor: string;
  /** Static helper text. Rendered with id `${htmlFor}-hint`. */
  hint?: ReactNode;
  /** Validation message. Rendered with id `${htmlFor}-error`, `role="alert"`. */
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

/**
 * Label + control + hint/error wrapper. The control is `children`; the consumer
 * connects it up:
 *
 *   <Field label="Passphrase" htmlFor="passphrase" error={state.error}>
 *     <Input id="passphrase" name="passphrase"
 *            aria-invalid={Boolean(state.error)}
 *            aria-describedby={state.error ? "passphrase-error" : undefined} />
 *   </Field>
 */
export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-sans text-xs font-semibold">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-[11px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
