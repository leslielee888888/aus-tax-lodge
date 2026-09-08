import { classifyDocument } from "@aus-tax-lodge/ai";
import { applyExtractions, extractDocument } from "@aus-tax-lodge/extraction";

import { getClaudeClient } from "../../../../../lib/ai/client";
import { classifyConversationFailure } from "../../../../../lib/ai/failure";
import { recomputePendingConfirmations } from "../../../../../lib/confirmations";
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
import { checkModelInScope } from "../../../../../lib/scope-check";
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
 *   PRD Q3) seeds the model. The seeded model + the uploaded document(s) then go
 *   through the out-of-scope gate (`checkModelInScope`, PRD FR-8/FR-20). If it
 *   finds nothing, the assistant summarises what it read **from the model**
 *   (`summariseIncomeFound`), `phase` → `interview`, and `nextTurn` (T2) opens
 *   the interview. `{ ok:true }`.
 * - **out of scope** → the interview does not open: an `out-of-scope` card turn
 *   is appended, `phase` → `stopped`, and the **loaded (pre-extraction) model**
 *   is persisted, not the seeded one (PRD FR-9). `{ ok:false, reason:"out-of-scope" }`.
 * - **extraction / Claude throws** (FR-14) → the assistant says it couldn't
 *   read the file in plain language, `phase` stays `upload`, the loaded model is
 *   persisted unchanged. `{ ok:false, reason:"unreadable", rateLimited }` — a
 *   429 sets `rateLimited:true` (a resumable pause).
 * - **the scope check can't complete** (FR-14) → the interview does NOT open
 *   (the assistant never assumes in-scope): `phase` stays `upload`, the loaded
 *   model is kept, a plain message is appended.
 *   `{ ok:false, reason:"scope-check-failed", rateLimited }`.
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

  // --- A pre-fill report: extract, seed, scope-check, open the interview ---
  try {
    const extraction = await extractDocument(returnId, doc.docId, { store, client });
    const { model: seededBase, pendingReconciliation } = applyExtractions(model, [extraction]);

    // Out-of-scope gate on the seeded model + the uploaded document(s)
    // (PRD FR-8 "on every ... document", FR-20). `seeded` carries the refreshed
    // document content-cache.
    //
    // FR-14 — if the scope check can't complete, the interview does NOT open:
    // the assistant must never assume the return is in scope. Stay in `upload`
    // with the loaded model, say so plainly, and let the user resend.
    let scoped: Awaited<ReturnType<typeof checkModelInScope>>;
    try {
      scoped = await checkModelInScope({
        returnId,
        model: seededBase,
        store,
        visionClient: client,
      });
    } catch (err) {
      const failure = classifyConversationFailure(err, { step: "scope-check" });
      const said = appendTurn(withFile, {
        role: "assistant",
        kind: "message",
        text: failure.assistantMessage,
      });
      const result = await save(said);
      return json(
        {
          ...result,
          ok: false,
          reason: "scope-check-failed" as const,
          rateLimited: failure.resumablePause,
        },
        200,
      );
    }
    const { findings, model: seeded } = scoped;

    if (findings.length > 0) {
      let stopped = appendTurn(withFile, {
        role: "assistant",
        kind: "card",
        card: { type: "out-of-scope", payload: { findings } },
      });
      stopped = { ...stopped, phase: "stopped", stoppedReason: findings[0]!.item };
      // FR-9: the out-of-scope extraction is NOT persisted — save the loaded model.
      const result = await save(stopped, model);
      return json({ ...result, ok: false, reason: "out-of-scope" as const }, 200);
    }

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

    // Flag the doubtful figures now (PRD FR-5) so the income checkpoint and
    // T8's review both have them.
    const pendingConfirmations = recomputePendingConfirmations(
      seeded,
      conversation.pendingConfirmations,
    );

    let next = appendTurn(withFile, {
      role: "assistant",
      kind: "message",
      text: summariseIncomeFound(seeded),
    });
    next = { ...next, phase: "interview", pendingConfirmations };

    const step = await nextTurn({ model: seeded, conversation: next, client });
    next = applyInterviewStep(next, step, { model: seeded, pendingConfirmations });

    const result = await save(next, seededWithScratch);
    return json({ ...result, ok: true }, 200);
  } catch (err) {
    // FR-14 — extraction / Claude failed. `phase` stays `upload`, the loaded
    // model is persisted unchanged (nothing proceeds as if it succeeded), and
    // the assistant says so in plain language. A 429 is flagged a resumable
    // pause via `rateLimited`.
    const failure = classifyConversationFailure(err, { step: "extraction" });
    const said = appendTurn(withFile, {
      role: "assistant",
      kind: "message",
      text: failure.assistantMessage,
    });
    const result = await save(said);
    return json(
      {
        ...result,
        ok: false,
        reason: "unreadable" as const,
        rateLimited: failure.resumablePause,
      },
      200,
    );
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

function humanType(type: string): string {
  return type.replace(/-/g, " ");
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}
