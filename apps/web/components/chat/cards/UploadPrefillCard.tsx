"use client";

import { useId, useState, type DragEvent } from "react";

import { UploadIcon } from "../../icons";
import type { ConversationState } from "../../../lib/conversation";
import { UPLOAD_PREFILL_HELP } from "../../../lib/upload-prefill-help";
import type { CardProps } from "./types";

/**
 * The real body for a `upload-prefill` card (PRD FR-1): a drag-and-drop zone
 * plus a "browse" file input for the ATO pre-fill report (PDF only), the
 * "where to get it" line and the "not final until ~August" note.
 *
 * On a file chosen it POSTs the file (multipart, field `file`) to
 * `/api/returns/:returnId/prefill`, shows an uploading → reading state, and
 * hands the server's updated conversation back to `ChatScreen` via
 * {@link CardProps.onResult}. A wrong-type or unreadable response keeps the
 * zone active so the user can try again (the assistant's explanation is already
 * in the returned transcript). An `out-of-scope` response is a hard stop
 * (PRD FR-9): the zone locks and the new `out-of-scope` card + hidden composer
 * in the re-rendered transcript carry the rest.
 */
type Phase = "idle" | "uploading" | "reading" | "accepted" | "error" | "stopped";

interface PrefillResponse {
  readonly ok: boolean;
  readonly reason?: string;
  readonly conversation?: ConversationState;
  readonly revision?: number;
  readonly error?: string;
}

function helpCopy(payload: unknown): { where: string; freshnessNote: string } {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    where: typeof record.where === "string" ? record.where : UPLOAD_PREFILL_HELP.where,
    freshnessNote:
      typeof record.freshnessNote === "string"
        ? record.freshnessNote
        : UPLOAD_PREFILL_HELP.freshnessNote,
  };
}

export function UploadPrefillCard({ returnId, turn, readOnly, onResult }: CardProps) {
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { where, freshnessNote } = helpCopy(turn.card.payload);
  const busy = phase === "uploading" || phase === "reading";
  const terminal = phase === "accepted" || phase === "stopped";
  const disabled = readOnly || busy || terminal;

  async function submit(file: File) {
    setMessage(null);
    setPhase("uploading");

    const body = new FormData();
    body.append("file", file);

    let response: Response;
    try {
      response = await fetch(`/api/returns/${encodeURIComponent(returnId)}/prefill`, {
        method: "POST",
        body,
      });
    } catch {
      setPhase("error");
      setMessage("Couldn't reach the server. Check your connection and try again.");
      return;
    }

    setPhase("reading");

    let payload: PrefillResponse;
    try {
      payload = (await response.json()) as PrefillResponse;
    } catch {
      setPhase("error");
      setMessage("The upload didn't complete. Try again.");
      return;
    }

    if (payload.conversation !== undefined && typeof payload.revision === "number") {
      // The transcript now carries the assistant's next turn (or its nudge).
      onResult({ conversation: payload.conversation, revision: payload.revision });
    }

    if (payload.ok) {
      setPhase("accepted");
      return;
    }

    if (payload.reason === "out-of-scope") {
      // Hard stop — the re-rendered transcript now carries the `out-of-scope`
      // card and a hidden composer; the zone just locks.
      setPhase("stopped");
      return;
    }

    setPhase("error");
    setMessage(
      payload.error ??
        (payload.reason === "wrong-type"
          ? "That doesn't look like an ATO pre-fill report. Upload the pre-fill report to start."
          : "I couldn't read that file. Try uploading it again."),
    );
  }

  function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void submit(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    onFiles(event.dataTransfer.files);
  }

  return (
    <div
      data-card-type="upload-prefill"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Upload your ATO pre-fill report
      </h3>

      <div className="px-4 py-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={[
            "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center",
            dragActive ? "border-accent bg-accent-soft" : "border-border bg-bg",
            disabled ? "opacity-60" : "",
          ].join(" ")}
        >
          <UploadIcon aria-hidden="true" className="size-5 text-muted" />
          <p className="text-[13px]">
            {phase === "accepted"
              ? "Pre-fill report received — reading it now."
              : phase === "stopped"
                ? "This return can't continue — see the note below."
                : busy
                  ? phase === "uploading"
                    ? "Uploading…"
                    : "Reading your report…"
                  : "Drag your pre-fill report here (PDF)"}
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
            accept=".pdf,application/pdf"
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

        <p className="mt-3 text-[12px] text-muted">{where}</p>
        <p className="mt-1.5 text-[12px] text-muted">{freshnessNote}</p>
      </div>
    </div>
  );
}
