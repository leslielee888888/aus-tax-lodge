"use client";

import { useId, useMemo, useState } from "react";

import { approveReturn, reopenLine } from "../../../app/returns/[returnId]/actions";
import type { ConversationState } from "../../../lib/conversation";
import type {
  ReviewSummary,
  ReviewSummaryHeadline,
  ReviewSummaryLine,
} from "../../../lib/review-summary";
import { AlertTriangleIcon, CheckIcon } from "../../icons";
import type { CardProps } from "./types";

/**
 * The whole-return review checkpoint (PRD FR-5 final checkpoint, FR-10, FR-11).
 *
 * Renders the {@link ReviewSummary} baked into `turn.card.payload` by
 * `applyInterviewStep`'s `done` case (or re-issued by a `sendMessage` review
 * correction) line by line — income by type with rental broken out, deductions,
 * taxable income, tax, offsets, levies, HELP repayment, credits and the
 * refund/owing headline. Every figure comes straight from the engine via
 * {@link import("../../../lib/estimate/breakdown").buildEstimateBreakdown}; the
 * card does no arithmetic and never shows a TFN (it shows the taxpayer's name).
 *
 * Two controls:
 * - per-line **"That's not right"** → {@link reopenLine} drops back to the
 *   interview to re-ask about that line;
 * - **Approve** → collects a records-archive password (min-length, shown once,
 *   never saved), runs {@link approveReturn} (the FR-13/FR-14 export gate), and
 *   on a pass POSTs the password to the archive route and downloads the
 *   encrypted zip. Unacknowledged validation warnings surface an
 *   "I understand" gate first.
 *
 * `readOnly` renders the summary with no password field and no buttons.
 */

const MIN_PASSWORD_LENGTH = 12;

interface Payload {
  readonly summary: ReviewSummary | null;
}

type Status =
  "idle" | "reopening" | "submitting" | "needs-ack" | "downloading" | "approved" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Tolerate a thin / missing payload — the card shows a "couldn't build it" note. */
function readPayload(raw: unknown): Payload {
  if (!isRecord(raw)) return { summary: null };
  const summary = raw.summary;
  if (!isRecord(summary) || !Array.isArray(summary.lines)) return { summary: null };
  const lines = (summary.lines as unknown[]).filter(
    (l): l is ReviewSummaryLine =>
      isRecord(l) && typeof l.lineKey === "string" && typeof l.displayAmount === "string",
  );
  const headline =
    isRecord(summary.headline) &&
    (summary.headline.kind === "refund" || summary.headline.kind === "payable")
      ? (summary.headline as unknown as ReviewSummaryHeadline)
      : null;
  return {
    summary: {
      taxpayerName: typeof summary.taxpayerName === "string" ? summary.taxpayerName : "You",
      lines,
      headline,
      caveats: Array.isArray(summary.caveats)
        ? (summary.caveats as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
      incomplete: summary.incomplete === true,
      missing: Array.isArray(summary.missing)
        ? (summary.missing as unknown[]).filter((m): m is string => typeof m === "string")
        : [],
      hasSpouseEstimate: summary.hasSpouseEstimate === true,
    },
  };
}

const INDENTED: ReadonlySet<ReviewSummaryLine["kind"]> = new Set(["sub"]);

function filenameFromDisposition(header: string | null): string {
  const match = header ? /filename="?([^"]+)"?/i.exec(header) : null;
  return match?.[1] ?? "tax-records.zip";
}

export function ReviewSummaryCard({ returnId, revision, turn, readOnly, onResult }: CardProps) {
  const { summary } = useMemo(() => readPayload(turn.card.payload), [turn.card.payload]);
  const passwordId = useId();
  const ackId = useId();

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [warnings, setWarnings] = useState<readonly { id: string; message: string }[]>([]);
  const [ackChecked, setAckChecked] = useState(false);

  const busy = status === "submitting" || status === "downloading" || status === "reopening";
  const done = status === "approved";
  const controlsDisabled = readOnly || busy || done;

  function handInFresh(
    conversation: ConversationState | undefined,
    nextRevision: number | undefined,
  ) {
    if (conversation && typeof nextRevision === "number") {
      onResult({ conversation, revision: nextRevision });
    }
  }

  async function onReopen(lineKey: string) {
    setMessage(null);
    setStatus("reopening");
    try {
      const result = await reopenLine(returnId, revision, turn.id, lineKey);
      handInFresh(result.conversation, result.revision);
      if (result.error) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      setStatus("approved"); // the summary is superseded by the reopened interview
    } catch {
      setStatus("error");
      setMessage("Something went wrong reopening that line — try again.");
    }
  }

  async function downloadArchive(): Promise<void> {
    const response = await fetch(`/api/returns/${returnId}/export/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      let detail =
        "The archive couldn't be built. Your return is approved — try the download again.";
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === "string") detail = body.error;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(detail);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filenameFromDisposition(response.headers.get("Content-Disposition"));
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function onApprove() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus("error");
      setMessage(`Choose an archive password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (status === "needs-ack" && !ackChecked) {
      setStatus("error");
      setMessage("Tick the box to confirm you understand the warnings.");
      return;
    }

    setMessage(null);
    setStatus("submitting");
    try {
      const ackIds = status === "needs-ack" ? warnings.map((w) => w.id) : undefined;
      const result = await approveReturn(returnId, revision, turn.id, password, ackIds);

      if (result.needsWarningAck && result.warnings) {
        setWarnings(result.warnings.map((w) => ({ id: w.id, message: w.message })));
        setStatus("needs-ack");
        setMessage(null);
        return;
      }
      if (result.blockedErrors && result.blockedErrors.length > 0) {
        setStatus("error");
        setMessage(`This return can't be exported yet: ${result.blockedErrors.join("; ")}`);
        return;
      }
      if (!result.ok) {
        if (result.conversation) handInFresh(result.conversation, result.revision);
        setStatus("error");
        setMessage(result.error ?? "That didn't go through — try again.");
        return;
      }

      handInFresh(result.conversation, result.revision);
      setStatus("downloading");
      try {
        await downloadArchive();
        setStatus("approved");
      } catch (error) {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "The archive couldn't be downloaded — try again.",
        );
      }
    } catch {
      setStatus("error");
      setMessage("Something went wrong approving the return — try again.");
    }
  }

  return (
    <div
      data-card-type="review-summary"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Review your whole return
      </h3>

      <div className="px-4 py-4">
        {!summary ? (
          <p className="text-[13px] text-muted">
            I couldn&apos;t build the summary just now. Send me a message and I&apos;ll try again.
          </p>
        ) : summary.incomplete ? (
          <div className="text-[13px]">
            <p className="mb-2">
              I can&apos;t finish {summary.taxpayerName}&apos;s estimate yet — there&apos;s still
              something outstanding:
            </p>
            <ul className="list-disc pl-5 text-muted">
              {summary.missing.length > 0 ? (
                summary.missing.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>a few remaining details</li>
              )}
            </ul>
          </div>
        ) : (
          <>
            <p className="mb-3 text-[13px]">
              Here&apos;s {summary.taxpayerName}&apos;s return, line by line. Every figure is worked
              out by the tax engine.
            </p>

            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">
                {summary.taxpayerName}&apos;s return, line by line
              </caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {summary.lines.map((line, index) => (
                  <tr
                    key={`${line.lineKey}-${index}`}
                    className={
                      line.kind === "net" || line.kind === "subtotal"
                        ? "border-t border-border font-medium"
                        : "border-t border-border"
                    }
                  >
                    <th
                      scope="row"
                      className={[
                        "py-1.5 pr-3 text-left font-normal align-top",
                        INDENTED.has(line.kind) ? "pl-4 text-muted" : "",
                      ].join(" ")}
                    >
                      <span className={line.kind === "net" ? "font-semibold" : ""}>
                        {line.label}
                        {line.note ? <span className="text-muted"> {line.note}</span> : null}
                      </span>
                      {line.estimated ? (
                        <span className="ml-1.5 rounded bg-surface-2 px-1 py-0.5 text-[10.5px] font-medium text-muted">
                          estimated
                        </span>
                      ) : null}
                      <span className="block text-[11px] text-muted">{line.source}</span>
                    </th>
                    <td className="py-1.5 pl-3 text-right align-top tabular-nums whitespace-nowrap">
                      {line.displayAmount}
                    </td>
                    <td className="py-1.5 pl-3 text-right align-top">
                      {line.reopenable && !readOnly ? (
                        <button
                          type="button"
                          disabled={controlsDisabled}
                          onClick={() => void onReopen(line.lineKey)}
                          className="rounded-md border border-border px-2 py-1 text-[11.5px] font-medium disabled:opacity-60"
                        >
                          That&apos;s not right
                          <span className="sr-only"> — reopen {line.label}</span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {summary.headline ? (
              <p
                className={[
                  "mt-4 rounded-lg px-3 py-2 text-[14px] font-semibold",
                  summary.headline.kind === "refund"
                    ? "bg-ok-soft text-ok"
                    : "bg-accent-soft text-text",
                ].join(" ")}
              >
                {summary.headline.label}: {summary.headline.displayAmount}
              </p>
            ) : null}

            {summary.caveats.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-[11.5px] text-muted">
                {summary.caveats.map((caveat) => (
                  <li key={caveat} className="flex gap-1.5">
                    <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                    <span>{caveat}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {done ? (
              <p className="mt-4 inline-flex items-center gap-2 text-[12.5px] font-medium text-ok">
                <span
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center rounded-full bg-ok text-white"
                >
                  <CheckIcon className="size-2.5" />
                </span>
                Approved — your records archive has downloaded.
              </p>
            ) : readOnly ? null : (
              <form
                className="mt-5 border-t border-border pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onApprove();
                }}
              >
                <p className="mb-2 text-[13px] font-medium">
                  Approve and build your lodgement package
                </p>

                <div className="flex flex-col gap-1">
                  <label htmlFor={passwordId} className="text-[12.5px] font-medium">
                    Records-archive password
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={passwordId}
                      type={revealed ? "text" : "password"}
                      value={password}
                      minLength={MIN_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      disabled={controlsDisabled}
                      aria-describedby={`${passwordId}-hint`}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-56 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => setRevealed((shown) => !shown)}
                      className="rounded-md border border-border px-2 py-1 text-[11.5px] font-medium disabled:opacity-60"
                    >
                      {revealed ? "Hide" : "Show"}
                    </button>
                  </div>
                  <p id={`${passwordId}-hint`} className="text-[11px] text-muted">
                    At least {MIN_PASSWORD_LENGTH} characters. You&apos;ll need this to open the
                    archive later — it is not saved anywhere, so write it down now.
                  </p>
                </div>

                {status === "needs-ack" && warnings.length > 0 ? (
                  <fieldset className="mt-4 rounded-md border border-border p-3">
                    <legend className="px-1 text-[12px] font-medium">
                      Check these before approving
                    </legend>
                    <ul className="mb-2 list-disc pl-5 text-[12px] text-muted">
                      {warnings.map((warning) => (
                        <li key={warning.id}>{warning.message}</li>
                      ))}
                    </ul>
                    <label htmlFor={ackId} className="flex items-start gap-2 text-[12.5px]">
                      <input
                        id={ackId}
                        type="checkbox"
                        checked={ackChecked}
                        disabled={controlsDisabled}
                        onChange={(event) => setAckChecked(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>I understand these warnings and want to build the package anyway.</span>
                    </label>
                  </fieldset>
                ) : null}

                {message ? (
                  <p role="alert" className="mt-3 text-[12.5px] font-medium text-danger">
                    {message}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={controlsDisabled}
                  className="mt-4 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
                >
                  {status === "submitting"
                    ? "Checking…"
                    : status === "downloading"
                      ? "Building archive…"
                      : status === "needs-ack"
                        ? "Approve and download"
                        : "Approve return"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
