import type { HTMLAttributes, ReactNode } from "react";

/**
 * Surface container from the design canvas — `~11px` radius, hairline border,
 * soft shadow. Compose with {@link CardHeader} / {@link CardBody}, or drop
 * arbitrary children (e.g. a `divide-y` list of rows) straight in.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["rounded-card border border-border bg-surface shadow-card", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function CardHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["flex items-center gap-2.5 border-b border-border px-5 py-3.5", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/** Uppercase section label used inside a {@link CardHeader}. */
export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.06em] text-muted">
      {children}
    </h2>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["px-5 py-4", className].filter(Boolean).join(" ")}>{children}</div>
  );
}
