import { ShieldIcon } from "./icons";

/**
 * The persistent amber strip at the very top of every screen (PRD FR-19). It
 * lives in `app/layout.tsx` above the route content so it is always present
 * once the one-time acknowledgement has been recorded.
 */
export function DisclaimerBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 border-b border-border bg-warn-soft px-4 py-2 text-[11.5px] text-warn md:px-10"
    >
      <ShieldIcon className="size-3.5 shrink-0" />
      <p className="text-pretty">
        Not a registered tax agent <span aria-hidden="true">·</span> Estimates only, not the
        ATO&rsquo;s assessment <span aria-hidden="true">·</span> You&rsquo;re responsible for what
        you lodge
      </p>
    </div>
  );
}
