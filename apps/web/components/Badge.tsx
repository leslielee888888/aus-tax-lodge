import type { ReactNode } from "react";

export type BadgeTone = "ok" | "warn" | "danger" | "unverified" | "muted" | "accent";

const TONES: Record<BadgeTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  unverified: "bg-unverified-soft text-unverified",
  muted: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
};

/**
 * Small status pill (confidence, return status, "estimated" markers). Text is
 * the label — keep it short. `tone` carries meaning by colour, so the label
 * must still read on its own for anyone not perceiving the colour.
 */
export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11px] font-semibold",
        TONES[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}
