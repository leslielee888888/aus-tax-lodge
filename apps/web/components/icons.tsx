import type { SVGProps } from "react";

/**
 * Small stroke icons matching the design canvas. Decorative by default —
 * callers that use an icon as the only content of a control must still give the
 * control an `aria-label`. Pass `aria-hidden` is applied here so screen readers
 * skip them.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    </Icon>
  );
}

export function MarkIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <path d="M6 4h9l4 4v12H6z" />
      <path d="M9 13l2 2 4-4" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth={3} {...props}>
      <path d="M20 6L9 17l-5-5" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <path d="M12 15V4M7 9l5-5 5 5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </Icon>
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4M12 17h.01" />
    </Icon>
  );
}
