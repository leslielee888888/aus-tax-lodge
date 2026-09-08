import { classifyDocument } from "@aus-tax-lodge/ai";
import { applyExtractions, extractDocument } from "@aus-tax-lodge/extraction";

import { getClaudeClient } from "../../../../../lib/ai/client";
import { appendTurn, type ConversationState } from "../../../../../lib/conversation";
import { ingestUploads } from "../../../../../lib/documents";
import {
  mergePendingReconciliation,
  readExtractionScratch,
  withExtractionScratch,
} from "../../../../../lib/extraction-scratch";
import { summariseIncomeFound } from "../../../../../lib/income-summary";
import { nextTurn } from "../../../../../lib/interview";
import { applyInterviewStep } from "../../../../../lib/interview-loop";
import {
  ConversationReadOnlyError,
  loadConversation,
  saveConversation,
} from "../../../../../lib/returns";
import { getDocumentStore } from "../../../../../lib/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ returnId: string }>;
}

/**
 * `POST /api/returns/:returnId/prefill` — the in-chat pre-fill upload (PRD FR-1,
 * FR-2). `multipart/form-data` with one `file` (PDF).
 *
 * The file is stored AES-encrypted and classified (`@aus-tax-lodge/ai`). Then:
 *
 * - **not an `ato-prefill-report`** → no extraction; the assistant asks for the
 *   right file, `phase` stays `upload`. `{ ok:false, reason:"wrong-type" }`.
 * - **a pre-fill report** → vision extraction (`@aus-tax-lodge/extraction`,
 *   PRD Q3) seeds the model, the assistant summarises what it read **from the
 *   model** (`summariseIncomeFound`), `phase` → `interview`, and `nextTurn`
 *   (T2) opens the interview. `{ ok:true }`.
 * - **extraction / Claude throws** → the assistant says it couldn't read the
 *   file, `phase` stays `upload`. `{ ok:false, reason:"unreadable" }`. (T10
 *   hardens the failure path; here it just must not crash or advance.)
 *
 * Every response body carries `{ conversation, revision }` so the drop-zone
 * card can advance the transcript in place.
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

  // `ingestUploads` reads a repeated `files` field — re-pack the single `file`.
  const ingestForm = new FormData();
  ingestForm.append("files", file);
  const ingest = await ingestUploads(returnId, ingestForm, {
    store,
    classify: (input) => classifyDocument(input, client),
  });
  if (ingest.status !== 201) {
    return json({ ok: false, reason: "rejected", error: ingest.body.error }, ingest.status);
  }
  const doc = ingest.body.documents[0]!;

  let loaded: Awaited<ReturnType<typeof loadConversation>>;
  try {
    loaded = await loadConversation(returnId);
  } catch {
    return json({ ok: false, reason: "load-failed", error: "couldn't load this return" }, 500);
  }
  if (loaded.readOnly) {
    return json({ ok: false, reason: "locked", error: "this return is locked" }, 409);
  }

  const { conversation, model } = loaded;
  const withFile = appendTurn(conversation, {
    role: "user",
    kind: "file",
    filename: doc.filename,
    docId: doc.docId,
  });

  const save = (next: ConversationState, nextModel = model) =>
    persist(returnId, next, nextModel, loaded.envelope.revision);

  // --- Wrong document: ask again, don't extract, stay in `upload` -----------
  if (doc.detectedType !== "ato-prefill-report") {
    const said = appendTurn(withFile, {
      role: "assistant",
      kind: "message",
      text:
        `That looks like a ${humanType(doc.detectedType)} — I need your ATO pre-fill report to start. ` +
        "Get it from myGov → ATO → Tax → Lodgments → Income tax → Pre-fill.",
    });
    const result = await save(said);
    return json({ ...result, ok: false, reason: "wrong-type" as const }, 200);
  }

  // --- A pre-fill report: extract, seed, open the interview ----------------
  try {
    const extraction = await extractDocument(returnId, doc.docId, { store, client });
    const { model: seeded, pendingReconciliation } = applyExtractions(model, [extraction]);

    const scratch = readExtractionScratch(model);
    const seededWithScratch = withExtractionScratch(seeded, {
      extracted: [
        ...scratch.extracted,
        { docId: doc.docId, figuresCount: extraction.figures.length },
      ],
      pendingReconciliation: mergePendingReconciliation(
        scratch.pendingReconciliation,
        pendingReconciliation,
      ),
    });

    let next = appendTurn(withFile, {
      role: "assistant",
      kind: "message",
      text: summariseIncomeFound(seeded),
    });
    next = { ...next, phase: "interview" };

    const step = await nextTurn({ model: seeded, conversation: next, client });
    next = applyInterviewStep(next, step);

    const result = await save(next, seededWithScratch);
    return json({ ...result, ok: true }, 200);
  } catch {
    const said = appendTurn(withFile, {
      role: "assistant",
      kind: "message",
      text: "I couldn't read that file just now — try uploading it again.",
    });
    const result = await save(said);
    return json({ ...result, ok: false, reason: "unreadable" as const }, 200);
  }
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
  model: Parameters<typeof saveConversation>[1]["model"],
  expectedRevision: number,
): Promise<PersistResult> {
  try {
    const result = await saveConversation(returnId, { model, conversation: next, expectedRevision });
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

function humanType(type: string): string {
  return type.replace(/-/g, " ");
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}
