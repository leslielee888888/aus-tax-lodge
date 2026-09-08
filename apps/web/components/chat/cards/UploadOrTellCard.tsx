"use client";

import { useId, useState, type DragEvent } from "react";

import { tellFigureInstead } from "../../../app/returns/[returnId]/actions";
import type { ConversationState } from "../../../lib/conversation";
import { CheckIcon, UploadIcon } from "../../icons";
import type { CardProps } from "./types";

/**
 * The `upload-or-tell` card (PRD FR-6) — the assistant has reached a topic the
 * pre-fill report doesn't carry (a deduction amount, the FR-24 rental inputs)
 * and offers **both** ways to answer, in one message:
 *
 * - **Drop one document** — a compact drop zone (the same upload mechanics as
 *   {@link import("./UploadPrefillCard").UploadPrefillCard}) that POSTs to
 *   `/api/returns/:id/interview-document`, the mid-conversation document route.
 * - **I'll just tell you** — records the choice via {@link tellFigureInstead}
 *   and hands the turn back to the composer; the user types the figure and
 *   `sendMessage` / `applyUserTurn` maps it onto the right field.
 *
 * `payload.lead` is the whole ask — one topic, two paths, never a checklist of
 * "documents you should provide".
 */
type Phase =
  "idle" | "uploading" | "reading" | "accepted" | "stopped" | "telling" | "told" | "error";

interface RouteResponse {
  readonly ok: boolean;
  readonly reason?: string;
  readonly conversation?: ConversationState;
  readonly revision?: number;
  readonly error?: string;
}

function readLead(payload: unknown): string | null {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return typeof record.lead === "string" && record.lead.trim() !== "" ? record.lead : null;
}

export function UploadOrTellCard({ returnId, revision, turn, readOnly, onResult }: CardProps) {
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lead = readLead(turn.card.payload);
  const busy = phase === "uploading" || phase === "reading" || phase === "telling";
  const terminal = phase === "accepted" || phase === "stopped" || phase === "told";
  const disabled = readOnly || busy || terminal;

  async function submitFile(file: File) {
    setMessage(null);
    setPhase("uploading");

    const body = new FormData();
    body.append("file", file);

    let response: Response;
    try {
      response = await fetch(`/api/returns/${encodeURIComponent(returnId)}/interview-document`, {
        method: "POST",
        body,
      });
    } catch {
      setPhase("error");
      setMessage("Couldn't reach the server. Check your connection and try again.");
      return;
    }

    setPhase("reading");

    let payload: RouteResponse;
    try {
      payload = (await response.json()) as RouteResponse;
    } catch {
      setPhase("error");
      setMessage("The upload didn't complete. Try again.");
      return;
    }

    if (payload.conversation !== undefined && typeof payload.revision === "number") {
      onResult({ conversation: payload.conversation, revision: payload.revision });
    }

    if (payload.ok) {
      setPhase("accepted");
      return;
    }
    if (payload.reason === "out-of-scope") {
      setPhase("stopped");
      return;
    }
    setPhase("error");
    setMessage(
      payload.error ??
        "I couldn't use that document. Try another one, or tell me the figure directly.",
    );
  }

  function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void submitFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    onFiles(event.dataTransfer.files);
  }

  async function onTellInstead() {
    setMessage(null);
    setPhase("telling");
    try {
      const result = await tellFigureInstead(returnId, revision, turn.id);
      onResult({ conversation: result.conversation, revision: result.revision });
      if (result.error) {
        setPhase("error");
        setMessage(result.error);
        return;
      }
      setPhase("told");
    } catch {
      setPhase("error");
      setMessage("Something went wrong — try again.");
    }
  }

  return (
    <div
      data-card-type="upload-or-tell"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Add a document, or tell me the figure
      </h3>

      <div className="px-4 py-4">
        {lead ? <p className="mb-3 text-[13px]">{lead}</p> : null}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={[
            "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center",
            dragActive ? "border-accent bg-accent-soft" : "border-border bg-bg",
            disabled ? "opacity-60" : "",
          ].join(" ")}
        >
          <UploadIcon aria-hidden="true" className="size-5 text-muted" />
          <p className="text-[13px]">
            {phase === "accepted"
              ? "Got it — reading that now."
              : phase === "stopped"
                ? "This return can't continue — see the note below."
                : phase === "uploading"
                  ? "Uploading…"
                  : phase === "reading"
                    ? "Reading your document…"
                    : "Drop one document here (PDF, PNG or JPG)"}
          </p>
          {!terminal ? (
            <p className="text-[12px] text-muted">
              or{" "}
              <label
                htmlFor={inputId}
                className={[
                  "cursor-pointer font-medium underline",
                  disabled ? "pointer-events-none" : "text-accent",
                ].join(" ")}
              >
                browse for it
              </label>
            </p>
          ) : null}
          <input
            id={inputId}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {message ? (
          <p role="alert" className="mt-3 text-[12.5px] font-medium text-danger">
            {message}
          </p>
        ) : null}

        {phase === "told" ? (
          <p className="mt-3 inline-flex items-center gap-2 text-[12.5px] font-medium text-ok">
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center rounded-full bg-ok text-white"
            >
              <CheckIcon className="size-2.5" />
            </span>
            Type the figure in the message box.
          </p>
        ) : !terminal ? (
          <div className="mt-3">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void onTellInstead()}
              className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium disabled:opacity-60"
            >
              {phase === "telling" ? "One sec…" : "I'll just tell you"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
