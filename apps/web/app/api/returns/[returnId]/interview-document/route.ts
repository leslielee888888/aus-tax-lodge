import { classifyDocument } from "@aus-tax-lodge/ai";
import {
  applyExtractions,
  extractDocument,
  type DocumentExtractionResult,
  type PendingReconciliation,
} from "@aus-tax-lodge/extraction";
import type { RentalSchedule, ReturnModel } from "@aus-tax-lodge/model";
import type { DocumentType } from "@aus-tax-lodge/store";

import { getClaudeClient } from "../../../../../lib/ai/client";
import { recomputePendingConfirmations } from "../../../../../lib/confirmations";
import { appendTurn, type ConversationState } from "../../../../../lib/conversation";
import { ingestUploads } from "../../../../../lib/documents";
import {
  mergePendingReconciliation,
  readExtractionScratch,
  withExtractionScratch,
} from "../../../../../lib/extraction-scratch";
import { nextTurn } from "../../../../../lib/interview";
import { applyInterviewStep } from "../../../../../lib/interview-loop";
import { detectDocumentReconciliation } from "../../../../../lib/reconciliation";
import {
  assembleRentalFromDocument,
  DEPRECIATION_WARNING,
  depreciationOutstanding,
  isRentalDocType,
  RENTAL_DOC_SLOT,
  repairsConfirmationPrompt,
  summariseRentalDocument,
} from "../../../../../lib/rental-intake";
import {
  ConversationReadOnlyError,
  loadConversation,
  saveConversation,
} from "../../../../../lib/returns";
import { checkModelInScope } from "../../../../../lib/scope-check";
import { getDocumentStore } from "../../../../../lib/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ returnId: string }>;
}

type Store = ReturnType<typeof getDocumentStore>;
type Client = ReturnType<typeof getClaudeClient>;
type IngestedDoc = { docId: string; detectedType: string; filename: string; extractable: boolean };

/**
 * `POST /api/returns/:returnId/interview-document` — a document dropped
 * mid-interview (PRD FR-6, FR-7, FR-24). `multipart/form-data` with one `file`.
 *
 * This is the "drop the one relevant document" path the `upload-or-tell` card
 * offers, distinct from the v1 bulk-upload route at `/documents` (removed in
 * T11). It mirrors the pre-fill route's structure, then branches on the
 * classified type:
 *
 * - **A rental source document** (`rental-agent-statement` / `loan-interest-summary`
 *   / `qs-depreciation-schedule`) → folded into the rental schedule via
 *   `assembleRentalSchedule` (`lib/rental-intake.ts`); the assistant recaps the
 *   figures it read and, with no QS schedule, warns about under-claimed
 *   depreciation (PRD FR-24, Q23), and asks about an over-$1,000 repairs line
 *   (PRD Q25).
 * - **A generic income / deduction document** → `extractDocument` +
 *   `applyExtractions` (PRD FR-3). A figure that disagrees with one already on
 *   the model is held back and surfaced as a `PendingReconciliation` for the
 *   `reconcile` card (PRD FR-7) — never silently overwritten.
 * - **A wrong / unhelpful document** → the assistant says so plainly and the
 *   interview carries on — no "documents you must provide" checklist.
 *
 * The resulting model then goes through the out-of-scope gate
 * (`checkModelInScope`, T7 — reused, not reimplemented): a mid-interview
 * document can be out of scope (a trust distribution, a CGT event). On a
 * finding the interview does not continue — an `out-of-scope` card is appended,
 * `phase` → `stopped`, and the **pre-document model** is persisted (PRD FR-9).
 *
 * Otherwise doubtful figures land in `pendingConfirmations` (so `nextTurn`
 * raises `confirm-figure`), fresh mismatches land in the `__t16Extraction`
 * scratch (so `nextTurn` raises `reconcile`), and the assistant's next move is
 * folded into the transcript. Every response carries `{ conversation, revision }`.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, reason: "bad-request", error: "expected multipart/form-data" }, 415);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ ok: false, reason: "no-file", error: "no file in the `file` field" }, 400);
  }

  const client = getClaudeClient();
  const store = getDocumentStore();

  const ingestForm = new FormData();
  ingestForm.append("files", file);
  const ingest = await ingestUploads(returnId, ingestForm, {
    store,
    classify: (input) => classifyDocument(input, client),
  });
  if (ingest.status !== 201) {
    return json({ ok: false, reason: "rejected", error: ingest.body.error }, ingest.status);
  }
  const doc = ingest.body.documents[0]! as IngestedDoc;

  let loaded: Awaited<ReturnType<typeof loadConversation>>;
  try {
    loaded = await loadConversation(returnId);
  } catch {
    return json({ ok: false, reason: "load-failed", error: "couldn't load this return" }, 500);
  }
  if (loaded.readOnly) {
    return json({ ok: false, reason: "locked", error: "this return is locked" }, 409);
  }
  if (loaded.conversation.phase !== "interview") {
    return json(
      {
        ok: false,
        reason: "not-in-interview",
        error: "documents can only be added once the interview is under way",
      },
      409,
    );
  }

  const { conversation, model } = loaded;
  const withFile = appendTurn(conversation, {
    role: "user",
    kind: "file",
    filename: doc.filename,
    docId: doc.docId,
  });

  const save = (next: ConversationState, nextModel: ReturnModel = model) =>
    persist(returnId, next, nextModel, loaded.envelope.revision);

  try {
    const folded = isRentalDocType(doc.detectedType)
      ? await foldRentalDocument(returnId, doc, model, store, client)
      : doc.extractable
        ? await foldGenericDocument(returnId, doc, model, store, client)
        : notHelpful(model);

    // Out-of-scope gate over the resulting model (PRD FR-8, FR-9, FR-20).
    const { findings, model: checkedModel } = await checkModelInScope({
      returnId,
      model: folded.model,
      store,
      visionClient: client,
    });

    if (findings.length > 0) {
      let stopped = appendTurn(withFile, {
        role: "assistant",
        kind: "card",
        card: { type: "out-of-scope", payload: { findings } },
      });
      stopped = { ...stopped, phase: "stopped", stoppedReason: findings[0]!.item };
      // FR-9: the out-of-scope document's figures are NOT persisted.
      const result = await save(stopped, model);
      return json({ ...result, ok: false, reason: "out-of-scope" as const }, 200);
    }

    const scratch = readExtractionScratch(model);
    const nextModel: ReturnModel = withExtractionScratch(checkedModel, {
      extracted: [...scratch.extracted, { docId: doc.docId, figuresCount: folded.figuresCount }],
      pendingReconciliation: mergePendingReconciliation(
        scratch.pendingReconciliation,
        folded.pendingReconciliation,
      ),
    });

    const pendingConfirmations = recomputePendingConfirmations(
      nextModel,
      conversation.pendingConfirmations,
    );

    let next: ConversationState = { ...withFile, pendingConfirmations };
    for (const line of folded.assistantLines) {
      next = appendTurn(next, { role: "assistant", kind: "message", text: line });
    }

    const step = await nextTurn({ model: nextModel, conversation: next, client });
    next = applyInterviewStep(next, step, { model: nextModel, pendingConfirmations });

    const result = await save(next, nextModel);
    return json({ ...result, ok: true, reason: folded.reason }, 200);
  } catch {
    const said = appendTurn(withFile, {
      role: "assistant",
      kind: "message",
      text: "I couldn't read that file just now — try uploading it again, or tell me the figures directly.",
    });
    const result = await save(said);
    return json({ ...result, ok: false, reason: "unreadable" as const }, 200);
  }
}

// ---------------------------------------------------------------------------
// Per-branch document folding
// ---------------------------------------------------------------------------

interface FoldedDocument {
  readonly model: ReturnModel;
  readonly figuresCount: number;
  readonly pendingReconciliation: readonly PendingReconciliation[];
  readonly assistantLines: readonly string[];
  readonly reason: "rental" | "generic" | "not-helpful";
}

async function foldRentalDocument(
  returnId: string,
  doc: IngestedDoc,
  model: ReturnModel,
  store: Store,
  client: Client,
): Promise<FoldedDocument> {
  const slot = RENTAL_DOC_SLOT[doc.detectedType as keyof typeof RENTAL_DOC_SLOT];
  const stored = await store.getDocument(returnId, doc.docId);

  const before: RentalSchedule = model.rental;
  const schedule = await assembleRentalFromDocument({
    model,
    slot,
    source: { docId: doc.docId, bytes: stored.bytes, mimeType: stored.metadata.mimeType },
    client,
  });
  const nextModel: ReturnModel = { ...model, rental: schedule };

  const lines: string[] = [summariseRentalDocument(before, schedule, slot)];

  const hasQsSchedule = (await store.listDocuments(returnId)).some(
    (d) => d.detectedType === "qs-depreciation-schedule",
  );
  if (depreciationOutstanding(schedule, hasQsSchedule)) lines.push(DEPRECIATION_WARNING);

  if (needsRepairsCheck(schedule)) {
    const repairs = repairsConfirmationPrompt(schedule);
    if (repairs) lines.push(repairs);
  }

  return {
    model: nextModel,
    figuresCount: countRentalFiguresRead(before, schedule),
    pendingReconciliation: [],
    assistantLines: lines,
    reason: "rental",
  };
}

async function foldGenericDocument(
  returnId: string,
  doc: IngestedDoc,
  model: ReturnModel,
  store: Store,
  client: Client,
): Promise<FoldedDocument> {
  const extraction = await extractDocument(returnId, doc.docId, { store, client });

  if (extraction.figures.length === 0) {
    return {
      model,
      figuresCount: 0,
      pendingReconciliation: [],
      assistantLines: [
        `I read ${doc.filename}, but couldn't pull any figures I can use from it. ` +
          "If it covers something we still need, tell me the amount directly.",
      ],
      reason: "not-helpful",
    };
  }

  const documentTypeByDocId = Object.fromEntries(
    (await store.listDocuments(returnId)).map((d) => [d.docId, d.detectedType as DocumentType]),
  );
  const mismatches = detectDocumentReconciliation(model, extraction, documentTypeByDocId);
  const conflictedPaths = new Set(mismatches.map((m) => m.modelPath));

  // Apply only the figures that do not conflict with a value already on the
  // model — a conflicting figure stays put until the user resolves the
  // `reconcile` card (PRD FR-7); nothing silently overwrites the pre-fill.
  const nonConflicting: DocumentExtractionResult = {
    ...extraction,
    figures: extraction.figures.filter((f) => !conflictedPaths.has(f.modelPath)),
  };
  const { model: applied, pendingReconciliation: within } = applyExtractions(model, [
    nonConflicting,
  ]);

  return {
    model: applied,
    figuresCount: nonConflicting.figures.length,
    pendingReconciliation: [...mismatches, ...within],
    assistantLines: [
      describeGenericRead(doc.filename, nonConflicting.figures.length, mismatches.length),
    ],
    reason: "generic",
  };
}

function notHelpful(model: ReturnModel): FoldedDocument {
  return {
    model,
    figuresCount: 0,
    pendingReconciliation: [],
    assistantLines: [
      "That doesn't look like a document I can read figures from. If it covers something we " +
        "still need, just tell me the amount and I'll use that.",
    ],
    reason: "not-helpful",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function needsRepairsCheck(schedule: RentalSchedule): boolean {
  const amount = schedule.expenses.repairsAndMaintenance.amount.value;
  return amount != null && amount > 1000 && !schedule.repairsConfirmedNotCapital;
}

function countRentalFiguresRead(before: RentalSchedule, after: RentalSchedule): number {
  let count = 0;
  if (after.grossRent.value !== before.grossRent.value) count += 1;
  if (after.otherRentalIncome.value !== before.otherRentalIncome.value) count += 1;
  for (const key of Object.keys(after.expenses) as (keyof RentalSchedule["expenses"])[]) {
    if (after.expenses[key].amount.value !== before.expenses[key].amount.value) count += 1;
  }
  return count;
}

function describeGenericRead(filename: string, figureCount: number, mismatchCount: number): string {
  const base =
    figureCount === 0
      ? `I read ${filename}.`
      : `I read ${filename} and picked up ${figureCount} figure${figureCount === 1 ? "" : "s"} from it.`;
  return mismatchCount > 0
    ? `${base} One or more figures disagree with what I already had — I'll ask you which is right.`
    : base;
}

interface PersistResult {
  readonly conversation: ConversationState;
  readonly revision: number;
  readonly conflict?: boolean;
  readonly error?: string;
}

async function persist(
  returnId: string,
  next: ConversationState,
  model: ReturnModel,
  expectedRevision: number,
): Promise<PersistResult> {
  try {
    const result = await saveConversation(returnId, {
      model,
      conversation: next,
      expectedRevision,
    });
    if (result.conflict) {
      const fresh = await loadConversation(returnId);
      return {
        conversation: fresh.conversation,
        revision: fresh.envelope.revision,
        conflict: true,
        error: "This return changed in another tab — reload to see the latest version.",
      };
    }
    return { conversation: next, revision: result.envelope.revision };
  } catch (error) {
    if (error instanceof ConversationReadOnlyError) {
      const fresh = await loadConversation(returnId);
      return {
        conversation: fresh.conversation,
        revision: fresh.envelope.revision,
        error: "This return is locked and can't be changed.",
      };
    }
    throw error;
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}
