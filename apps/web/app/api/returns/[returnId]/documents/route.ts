import { classifyDocument } from "@aus-tax-lodge/ai";

import { getClaudeClient } from "../../../../../lib/ai/client";
import { ingestUploads } from "../../../../../lib/documents";
import { getDocumentStore } from "../../../../../lib/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ returnId: string }>;
}

/**
 * `POST /api/returns/:returnId/documents` — upload one or more tax documents
 * (`multipart/form-data`, repeated `files` field; PDF / PNG / JPG only). Each
 * file is classified and stored AES-encrypted in the return's directory
 * (PRD FR-2, FR-17). Returns the created documents with their detected types.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data" }, { status: 415 });
  }

  const client = getClaudeClient();
  const result = await ingestUploads(returnId, formData, {
    store: getDocumentStore(),
    classify: (input) => classifyDocument(input, client),
  });

  return Response.json(result.body, { status: result.status });
}

/** `GET /api/returns/:returnId/documents` — list the return's documents (metadata only). */
export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId } = await params;
  const documents = await getDocumentStore().listDocuments(returnId);
  return Response.json({ documents });
}
