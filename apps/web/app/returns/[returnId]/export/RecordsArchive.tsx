"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../components/Button";
import { AlertTriangleIcon, DownloadIcon } from "../../../../components/icons";

const MIN_PASSWORD_LENGTH = 12;

const WORDS = [
  "amber",
  "birch",
  "cedar",
  "delta",
  "ember",
  "flint",
  "grove",
  "harbor",
  "ivory",
  "jetty",
  "kelp",
  "lumen",
  "marsh",
  "nimbus",
  "otter",
  "pluck",
  "quartz",
  "raven",
  "slate",
  "thorn",
  "umber",
  "veil",
  "wren",
  "yarrow",
];

/** A readable, ≥12-char passphrase: `word-word-NNNN-word`, ~19 chars. */
function generatePassphrase(): string {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  const w = (i: number) => WORDS[bytes[i]! % WORDS.length]!;
  const digits = 1000 + (bytes[3]! % 9000);
  return `${w(0)}-${w(1)}-${digits}-${w(2)}`;
}

/**
 * The records-archive block on the export screen (PRD FR-14): a user-set
 * password (generated strong, editable, shown once), the "we can't recover it"
 * notice, and the download trigger that POSTs the password and streams the
 * single AES-256 encrypted zip. The password is sent in the request body only
 * and never stored anywhere.
 */
export function RecordsArchive({
  returnId,
  targetYear,
  disabled,
  disabledReason,
}: {
  readonly returnId: string;
  readonly targetYear: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    setPassword(generatePassphrase());
  }, []);

  const regenerate = useCallback(() => {
    setPassword(generatePassphrase());
    setCopied(false);
    setDownloaded(false);
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the password and copy it manually.");
    }
  }, [password]);

  const tooShort = password.length < MIN_PASSWORD_LENGTH;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/returns/${returnId}/export/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not build the records archive. Try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tax-records-${targetYear}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch {
      setError("Could not build the records archive. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="archive-password" className="text-xs font-medium text-text">
          Archive password
        </label>
        <input
          id="archive-password"
          type="text"
          value={password}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setPassword(event.target.value);
            setCopied(false);
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm tracking-[0.5px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-describedby="archive-password-notice"
        />
        <Button size="sm" variant="default" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={regenerate}>
          Regenerate
        </Button>
      </div>

      {tooShort ? (
        <p className="text-[11px] text-danger">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
      ) : null}

      <div
        id="archive-password-notice"
        className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[11.5px] text-warn"
      >
        <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Shown once. The app cannot recover it. Save it with the archive — without it the zip
          can&rsquo;t be opened.
        </span>
      </div>

      <div>
        <Button
          variant="default"
          onClick={download}
          disabled={disabled || tooShort || busy}
          aria-busy={busy}
        >
          <DownloadIcon className="size-3.5" aria-hidden="true" />
          {busy ? "Building archive…" : "Download records archive (.zip)"}
        </Button>
        {disabled && disabledReason ? (
          <p className="mt-1.5 text-[11px] text-muted">{disabledReason}</p>
        ) : null}
        {downloaded ? (
          <p className="mt-1.5 text-[11px] text-ok">
            Archive downloaded. Keep it and the password together for your 5-year records.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1.5 text-[11px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
