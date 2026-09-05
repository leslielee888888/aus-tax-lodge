"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import type { DocumentMetadata, DocumentType } from "@aus-tax-lodge/store";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  FileIcon,
  UploadIcon,
} from "../../../../components/icons";
import { Select } from "../../../../components/Select";
import {
  ACCEPTED_UPLOAD_LABEL,
  DOCUMENT_TYPE_OPTIONS,
  looksLikeAcceptedUpload,
} from "../../../../lib/document-types";
import type { ExtractedDocumentSummary } from "../../../../lib/extraction-scratch";
import { extractFigures, INITIAL_EXTRACT_FIGURES_STATE, type ExtractFiguresState } from "./actions";

export interface DocumentsPanelProps {
  readonly returnId: string;
  readonly expectedRevision: number;
  readonly initialDocuments: readonly DocumentMetadata[];
  /** `model.rental.present` — whether the return's rental scope is in progress (drives the checklist's rental row). */
  readonly rentalPresent: boolean;
  readonly initialExtracted: readonly ExtractedDocumentSummary[];
}

interface UploadEntry {
  readonly id: string;
  readonly filename: string;
  readonly status: "uploading" | "rejected" | "error";
  readonly reason?: string;
}

/** The five situational document types every return checks for, plus the rental set when `rental.present` (PRD §7 step 4). */
const CORE_CHECKLIST: ReadonlyArray<{ label: string; type: DocumentType }> = [
  { label: "ATO pre-fill report", type: "ato-prefill-report" },
  { label: "Income statement", type: "income-statement" },
  { label: "Bank interest notice", type: "bank-interest-notice" },
  { label: "Dividend statement", type: "dividend-statement" },
  { label: "Private health statement", type: "private-health-statement" },
];

const RENTAL_CHECKLIST: ReadonlyArray<{ label: string; type: DocumentType }> = [
  { label: "Rental agent statement", type: "rental-agent-statement" },
  { label: "Loan interest summary", type: "loan-interest-summary" },
  { label: "QS depreciation schedule", type: "qs-depreciation-schedule" },
];

function fileListToArray(files: FileList): File[] {
  return Array.from(files);
}

/**
 * The interactive upload / classify / extract screen (PRD FR-2, FR-3). Talks
 * directly to T10's REST routes for upload and type-correction (no server
 * action needed there — they're already framework-agnostic fetches), and to
 * the `extractFigures` server action for the extraction step.
 */
export function DocumentsPanel({
  returnId,
  expectedRevision,
  initialDocuments,
  rentalPresent,
  initialExtracted,
}: DocumentsPanelProps) {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([...initialDocuments]);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [extracted, setExtracted] = useState<Map<string, number>>(
    () => new Map(initialExtracted.map((entry) => [entry.docId, entry.figuresCount])),
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSeq = useRef(0);
  const alertRef = useRef<HTMLDivElement>(null);

  const boundExtract = extractFigures.bind(null, returnId, expectedRevision);
  const [state, formAction, pending] = useActionState<ExtractFiguresState, FormData>(
    boundExtract,
    INITIAL_EXTRACT_FIGURES_STATE,
  );

  // Fold a completed run's successes into client state so counts/badges update without a reload.
  useEffect(() => {
    if (!state.succeeded || state.succeeded.length === 0) return;
    setExtracted((prev) => {
      const next = new Map(prev);
      for (const entry of state.succeeded ?? []) next.set(entry.docId, entry.figuresCount);
      return next;
    });
  }, [state]);

  // A partial failure or a save error needs the user's attention — move focus to it,
  // the same way a form's first validation error is focused on submit.
  useEffect(() => {
    if (state.status === "partial" || state.status === "error") alertRef.current?.focus();
  }, [state]);

  async function uploadOne(id: string, file: File) {
    try {
      const body = new FormData();
      body.append("files", file);
      const res = await fetch(`/api/returns/${returnId}/documents`, { method: "POST", body });
      const payload = (await res.json()) as {
        documents?: DocumentMetadata[];
        error?: string;
        rejected?: { filename: string; reason: string }[];
      };
      if (!res.ok) {
        const reason = payload.rejected?.[0]?.reason ?? payload.error ?? "upload failed";
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: "error", reason } : u)),
        );
        return;
      }
      const uploaded = payload.documents?.[0];
      if (uploaded) setDocuments((prev) => [...prev, uploaded]);
      setUploads((prev) => prev.filter((u) => u.id !== id));
    } catch {
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: "error", reason: "network error" } : u)),
      );
    }
  }

  function handleFiles(files: File[]) {
    for (const file of files) {
      const id = `upload-${uploadSeq.current++}`;
      if (!looksLikeAcceptedUpload(file)) {
        setUploads((prev) => [
          ...prev,
          {
            id,
            filename: file.name,
            status: "rejected",
            reason: `unsupported file type (${file.type || "unknown"}) — accepts ${ACCEPTED_UPLOAD_LABEL}`,
          },
        ]);
        continue;
      }
      setUploads((prev) => [...prev, { id, filename: file.name, status: "uploading" }]);
      void uploadOne(id, file);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) handleFiles(fileListToArray(event.dataTransfer.files));
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      handleFiles(fileListToArray(event.target.files));
    }
    event.target.value = "";
  }

  async function handleTypeChange(doc: DocumentMetadata, type: DocumentType) {
    const previous = documents;
    setDocuments((prev) =>
      prev.map((d) => (d.docId === doc.docId ? { ...d, detectedType: type } : d)),
    );
    try {
      const res = await fetch(`/api/returns/${returnId}/documents/${doc.docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        setDocuments(previous);
        return;
      }
      const { document } = (await res.json()) as { document: DocumentMetadata };
      setDocuments((prev) => prev.map((d) => (d.docId === doc.docId ? document : d)));
    } catch {
      setDocuments(previous);
    }
  }

  const presentTypes = new Set(documents.map((d) => d.detectedType));
  const hasPrefillReport = presentTypes.has("ato-prefill-report");
  const checklistItems = rentalPresent ? [...CORE_CHECKLIST, ...RENTAL_CHECKLIST] : CORE_CHECKLIST;

  const failedByDocId = new Map((state.failed ?? []).map((f) => [f.docId, f.reason]));
  // Mirrors the server's `pending` set in `extractFigures` exactly: every extractable
  // document not yet successfully extracted, failed or not — a retry re-attempts it.
  const outstanding = documents.filter((doc) => doc.extractable && !extracted.has(doc.docId));
  const canExtract = documents.length > 0 && !pending;

  return (
    <div className="flex flex-col gap-5">
      <p aria-live="polite" className="sr-only">
        {pending
          ? "Extracting figures…"
          : state.status === "partial"
            ? `${state.failed?.length ?? 0} file${(state.failed?.length ?? 0) === 1 ? "" : "s"} couldn't be read.`
            : ""}
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={[
          "rounded-[11px] border-[1.5px] border-dashed p-7 text-center transition-colors",
          dragActive ? "border-accent bg-accent-soft" : "border-border bg-surface-2",
        ].join(" ")}
      >
        <UploadIcon className="mx-auto mb-1.5 size-6 text-muted" />
        <p className="text-[13px] font-medium">
          Drag files here, or{" "}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-sm text-accent underline underline-offset-2 [touch-action:manipulation] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-[11px] text-muted">{ACCEPTED_UPLOAD_LABEL}</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          onChange={onFileInputChange}
          className="sr-only"
          aria-label="Choose files to upload"
        />
      </div>

      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              Uploaded documents{documents.length > 0 ? ` (${documents.length})` : ""}
            </CardTitle>
          </CardHeader>
          <CardBody className="divide-y divide-border p-0">
            {documents.length === 0 && uploads.length === 0 ? (
              <p className="p-5 text-sm text-muted">Nothing uploaded yet.</p>
            ) : null}
            {documents.map((doc) => {
              const figuresCount = extracted.get(doc.docId);
              const isOutstanding = outstanding.some((d) => d.docId === doc.docId);
              const isBeingRead = pending && isOutstanding;
              // A stale failure from the previous run is superseded the moment a new run starts reading it again.
              const failureReason = !isBeingRead ? failedByDocId.get(doc.docId) : undefined;
              return (
                <div key={doc.docId} className="flex items-center gap-3 px-5 py-3.5">
                  <span
                    className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-surface text-muted"
                    aria-hidden="true"
                  >
                    <FileIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{doc.filename}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {doc.detectedType === "unrecognised" ? (
                        "Kept, not read"
                      ) : isBeingRead ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-3 shrink-0 rounded-full border-2 border-border border-t-accent motion-safe:animate-spin"
                            aria-hidden="true"
                          />
                          Reading…
                        </span>
                      ) : failureReason ? (
                        <span className="text-danger">
                          Couldn&rsquo;t read this file — {failureReason}
                        </span>
                      ) : figuresCount !== undefined ? (
                        <Badge tone="ok">
                          {figuresCount} figure{figuresCount === 1 ? "" : "s"} found
                        </Badge>
                      ) : !doc.extractable ? (
                        "Excluded from extraction"
                      ) : null}
                    </div>
                  </div>
                  <div className="w-[190px] shrink-0">
                    <label className="sr-only" htmlFor={`type-${doc.docId}`}>
                      {doc.filename}&rsquo;s document type
                    </label>
                    <Select
                      id={`type-${doc.docId}`}
                      value={doc.detectedType}
                      onChange={(e) => void handleTypeChange(doc, e.target.value as DocumentType)}
                    >
                      {DOCUMENT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              );
            })}
            {uploads.map((upload) => (
              <div key={upload.id} className="flex items-center gap-3 px-5 py-3.5">
                <span
                  className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-surface text-muted"
                  aria-hidden="true"
                >
                  <FileIcon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{upload.filename}</div>
                  <div className="mt-0.5 text-[11px]">
                    {upload.status === "uploading" ? (
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <span
                          className="size-3 shrink-0 rounded-full border-2 border-border border-t-accent motion-safe:animate-spin"
                          aria-hidden="true"
                        />
                        Uploading…
                      </span>
                    ) : (
                      <span role="alert" className="text-danger">
                        {upload.reason}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expected for your situation</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5">
            {checklistItems.map((item) => {
              const done = presentTypes.has(item.type);
              return (
                <div key={item.type} className="flex items-center gap-2.5 py-0.5 text-[13px]">
                  {done ? (
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-white"
                      aria-hidden="true"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        className="size-2.5"
                      >
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  ) : (
                    <span
                      className="size-4 shrink-0 rounded-full border-[1.5px] border-border"
                      aria-hidden="true"
                    />
                  )}
                  <span className={done ? "" : "text-muted"}>{item.label}</span>
                </div>
              );
            })}
            {!hasPrefillReport ? (
              <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-warn">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                No ATO pre-fill report yet — income completeness rests on your other documents and
                answers until you add one.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {state.status === "partial" && state.failed && state.failed.length > 0 ? (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-[10px] border border-danger bg-danger-soft p-4 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 focus:ring-offset-bg"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
            <AlertTriangleIcon className="size-4 shrink-0" />
            {state.failed.length} file{state.failed.length > 1 ? "s" : ""} couldn&rsquo;t be read
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-danger">
            {state.failed.map((f) => (
              <li key={f.docId}>
                <span className="font-medium">{f.filename}</span> — {f.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-danger">
            The rest of your documents were read fine. Try &ldquo;Extract figures&rdquo; again, or
            correct a file&rsquo;s type to &ldquo;Unrecognised&rdquo; above to continue without it.
          </p>
        </div>
      ) : null}

      {state.status === "error" && state.formError ? (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-danger bg-danger-soft p-3 text-xs font-medium text-danger focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 focus:ring-offset-bg"
        >
          {state.formError}
        </div>
      ) : null}

      {pending && outstanding.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Extraction running</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {outstanding.map((doc) => (
              <div key={doc.docId} className="flex items-center gap-2 text-[12.5px]">
                <span
                  className="size-[13px] shrink-0 rounded-full border-2 border-border border-t-accent motion-safe:animate-spin"
                  aria-hidden="true"
                />
                Reading {doc.filename}…
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <form action={formAction} className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {documents.length === 0
            ? "Upload at least one document to continue."
            : `${documents.length} document${documents.length === 1 ? "" : "s"} uploaded.`}
        </span>
        <Button type="submit" variant="primary" disabled={!canExtract} aria-busy={pending}>
          {pending ? "Extracting…" : "Extract figures"}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}
