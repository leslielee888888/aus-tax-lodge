import { isDocumentType } from "@aus-tax-lodge/store";

import { getDocumentStore } from "../../../../../../lib/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ returnId: string; docId: string }>;
}

function notFound(): Response {
  return Response.json({ error: "document not found" }, { status: 404 });
}

/**
 * `PATCH /api/returns/:returnId/documents/:docId` — correct a document's type
 * (PRD FR-2). Body: `{ "type": DocumentType, "extractable"?: boolean }`.
 * Setting `type` to `unrecognised` keeps the file but flags it not to extract.
 */
export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId, docId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const { type, extractable } = (body ?? {}) as {
    type?: unknown;
    extractable?: unknown;
  };
  if (!isDocumentType(type)) {
    return Response.json({ error: "`type` must be a known document type" }, { status: 400 });
  }
  if (extractable !== undefined && typeof extractable !== "boolean") {
    return Response.json({ error: "`extractable` must be a boolean" }, { status: 400 });
  }

  try {
    const metadata = await getDocumentStore().setDocumentType(returnId, docId, type, extractable);
    return Response.json({ document: metadata });
  } catch {
    return notFound();
  }
}

/** `DELETE /api/returns/:returnId/documents/:docId` — remove one document. */
export async function DELETE(_request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId, docId } = await params;
  try {
    await getDocumentStore().deleteDocument(returnId, docId);
    return new Response(null, { status: 204 });
  } catch {
    return notFound();
  }
}
