import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "default" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-sans font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 " +
  "[touch-action:manipulation]";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-accent-ink hover:bg-accent-hover",
  default: "border-border bg-surface text-text hover:bg-surface-2",
  ghost: "border-transparent bg-transparent text-text hover:bg-surface-2",
  danger: "border-border bg-surface text-danger hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-[30px] rounded-[7px] px-[11px] text-xs",
  md: "min-h-[38px] px-[15px] text-[13px]",
};

/**
 * Class string for a button-styled element. Use it on a `next/link` `<Link>`
 * when the control navigates (`buttonClassName({ variant: "ghost" })`); use the
 * {@link Button} component for real actions and form submits.
 */
export function buttonClassName(
  opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  const { variant = "default", size = "md", className } = opts;
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonClassName({ variant, size, className })} {...props} />
  );
}
