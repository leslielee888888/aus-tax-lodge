"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "../../components/Button";
import { AlertTriangleIcon } from "../../components/icons";
import {
  PURGE_MAX_DAYS,
  PURGE_MIN_DAYS,
  type PurgeSourceDocumentsSetting,
} from "../../lib/instance-settings.shared";
import { savePurgeSetting } from "./actions";

type Mode = "off" | "confirming" | "on";

function warningText(days: number): string {
  return (
    `This permanently deletes the original uploaded documents from returns you've already ` +
    `exported, ${days} days after their export date. The records archive you downloaded is your ` +
    `retention copy. This cannot be undone.`
  );
}

function parseDays(raw: string): number {
  return Number(raw);
}

/**
 * The FR-18 purge toggle. Off by default; turning it on shows the warning and a
 * confirm step first. Turning it off is immediate. Plain-args server action,
 * mirroring the review screen.
 */
export function PurgeSettingForm({ initial }: { initial: PurgeSourceDocumentsSetting }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(initial.enabled ? "on" : "off");
  const [days, setDays] = useState(String(initial.afterDays));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const daysId = useId();
  const daysErrorId = useId();
  const warningId = useId();

  const daysValue = parseDays(days);
  const daysValid =
    Number.isInteger(daysValue) && daysValue >= PURGE_MIN_DAYS && daysValue <= PURGE_MAX_DAYS;
  const daysError = daysValid
    ? null
    : `Enter a whole number of days between ${PURGE_MIN_DAYS} and ${PURGE_MAX_DAYS}.`;

  function persist(enabled: boolean, onOk: () => void) {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const result = await savePurgeSetting(enabled, daysValue);
      if (!result.ok) {
        setError(result.error ?? "Could not save. Try again.");
        return;
      }
      onOk();
      router.refresh();
    });
  }

  function handleToggle(checked: boolean) {
    setError(null);
    setStatus(null);
    if (checked) {
      if (mode === "off") setMode("confirming");
    } else if (mode === "on") {
      persist(false, () => {
        setMode("off");
        setStatus("Automatic purging is off. Nothing will be deleted automatically.");
      });
    } else {
      setMode("off");
    }
  }

  const toggleChecked = mode !== "off";

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-2.5 text-xs font-medium">
        <input
          type="checkbox"
          checked={toggleChecked}
          disabled={pending}
          onChange={(event) => handleToggle(event.target.checked)}
          aria-describedby={mode === "confirming" ? warningId : undefined}
          className="mt-0.5 size-[18px] shrink-0 accent-accent"
        />
        <span>
          Purge source documents a set number of days after a return is exported
          <span className="mt-0.5 block font-normal text-muted">
            {mode === "on"
              ? `On — original uploads are cleared ${initial.afterDays} days after export.`
              : "Off — this is the default. Nothing is deleted automatically."}
          </span>
        </span>
      </label>

      {mode !== "off" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={daysId} className="text-xs font-semibold">
            Days after export
          </label>
          <input
            id={daysId}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={PURGE_MIN_DAYS}
            max={PURGE_MAX_DAYS}
            value={days}
            disabled={pending}
            onChange={(event) => {
              setDays(event.target.value);
              setStatus(null);
            }}
            aria-invalid={!daysValid}
            aria-describedby={daysError ? daysErrorId : undefined}
            className="min-h-[38px] w-32 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-danger disabled:opacity-50"
          />
          <p
            id={daysErrorId}
            role="alert"
            className="min-h-[1rem] text-[11px] font-medium text-danger"
          >
            {daysError ?? ""}
          </p>
        </div>
      ) : null}

      {mode === "confirming" ? (
        <div
          id={warningId}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2.5 text-[11.5px] text-warn"
        >
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{warningText(daysValid ? daysValue : initial.afterDays)}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === "confirming" ? (
          <>
            <Button
              variant="primary"
              disabled={pending || !daysValid}
              aria-busy={pending}
              onClick={() =>
                persist(true, () => {
                  setMode("on");
                  setStatus(`On. Source documents will be purged ${daysValue} days after export.`);
                })
              }
            >
              {pending ? "Turning on…" : "Turn on automatic purging"}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setMode("off");
                setDays(String(initial.afterDays));
              }}
            >
              Cancel
            </Button>
          </>
        ) : null}

        {mode === "on" && String(initial.afterDays) !== days ? (
          <Button
            variant="default"
            disabled={pending || !daysValid}
            aria-busy={pending}
            onClick={() =>
              persist(true, () => setStatus(`Saved. Now purging ${daysValue} days after export.`))
            }
          >
            {pending ? "Saving…" : "Save day count"}
          </Button>
        ) : null}
      </div>

      <p aria-live="polite" className="min-h-[1rem] text-[11px] text-ok">
        {status ?? ""}
      </p>
      {error ? (
        <p role="alert" className="text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
