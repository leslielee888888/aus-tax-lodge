import { readAcknowledgedWarningIds } from "../../../../../../lib/export/acknowledgements";
import {
  buildRecordsArchive,
  MIN_ARCHIVE_PASSWORD_LENGTH,
  WeakArchivePasswordError,
} from "../../../../../../lib/export/archive";
import { buildExportInput, loadExportContext } from "../../../../../../lib/export/context";
import { computeExportGate } from "../../../../../../lib/export/gate";
import { persistExportArtifacts } from "../../../../../../lib/export/persist";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ returnId: string }>;
}

/**
 * `POST /api/returns/:returnId/export/archive` — build and download the single
 * AES-256 encrypted records archive (PRD FR-14, FR-18).
 *
 * The password comes in the POST body (`{ "password": "…" }`) — never a query
 * param, never logged, never persisted. The four package artifacts that go
 * into the zip are also persisted encrypted at rest so a later read-only view
 * of this return can re-download the individual files (FR-16). The archive zip
 * itself is not persisted — regenerate it on demand.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body with a `password`" }, { status: 400 });
  }
  const password = (body as { password?: unknown }).password;
  if (typeof password !== "string" || password.length < MIN_ARCHIVE_PASSWORD_LENGTH) {
    return Response.json(
      { error: `the archive password must be at least ${MIN_ARCHIVE_PASSWORD_LENGTH} characters` },
      { status: 400 },
    );
  }

  let context: Awaited<ReturnType<typeof loadExportContext>>;
  try {
    context = await loadExportContext(returnId);
  } catch {
    return Response.json({ error: "return not found" }, { status: 404 });
  }

  if (context.readOnly) {
    return Response.json(
      { error: "a read-only return can only re-download its saved artifacts, not a new archive" },
      { status: 409 },
    );
  }
  if (!context.ready || !context.assessment) {
    return Response.json(
      { error: "finish the review and questions steps before exporting" },
      { status: 409 },
    );
  }

  const acknowledgedWarningIds = await readAcknowledgedWarningIds(returnId);
  const gate = computeExportGate(context.model, context.assessment, acknowledgedWarningIds);
  if (!gate.downloadsEnabled) {
    return Response.json(
      {
        error: gate.blocked
          ? "the return has validation errors that block export"
          : "acknowledge every validation warning before downloading",
        errors: gate.errors,
        warnings: gate.warnings,
      },
      { status: 409 },
    );
  }

  const generatedAt = new Date().toISOString();
  const input = buildExportInput(context, acknowledgedWarningIds, generatedAt);

  let archive: Awaited<ReturnType<typeof buildRecordsArchive>>;
  try {
    archive = await buildRecordsArchive(returnId, input, password);
  } catch (err) {
    if (err instanceof WeakArchivePasswordError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  await persistExportArtifacts(returnId, archive.pkg, {
    generatedAt,
    paramsVersion: input.paramsVersion,
  });

  return new Response(new Uint8Array(archive.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
