import { assembleExportPackage, type ExportPackage } from "@aus-tax-lodge/export";

import { readAcknowledgedWarningIds } from "../../../../../../lib/export/acknowledgements";
import { buildExportInput, loadExportContext } from "../../../../../../lib/export/context";
import { computeExportGate } from "../../../../../../lib/export/gate";
import {
  persistExportArtifacts,
  readPersistedArtifact,
} from "../../../../../../lib/export/persist";

export const runtime = "nodejs";

/** URL slug → export-package artifact key. */
const ARTIFACT_KEYS: Readonly<Record<string, keyof ExportPackage>> = {
  pdf: "pdf",
  json: "json",
  report: "validationReport",
  "source-index": "sourceIndex",
};

interface RouteContext {
  params: Promise<{ returnId: string; artifact: string }>;
}

function fileResponse(bytes: Uint8Array, filename: string, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * `GET /api/returns/:returnId/export/:artifact` — download one export-package
 * artifact (`pdf` | `json` | `report` | `source-index`) as an attachment
 * (PRD FR-14 a–d).
 *
 * A read-only return serves the artifact it persisted at export time (it can't
 * be recomputed against a retired parameter set — FR-16). An editable return
 * regenerates the artifact fresh, persists it encrypted at rest, and serves it
 * — but only when the FR-13 gate is clear (no blocking errors, every warning
 * acknowledged); otherwise the download is refused with `409`.
 */
export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { returnId, artifact } = await params;
  const key = ARTIFACT_KEYS[artifact];
  if (!key) return Response.json({ error: "unknown export artifact" }, { status: 404 });

  let context: Awaited<ReturnType<typeof loadExportContext>>;
  try {
    context = await loadExportContext(returnId);
  } catch {
    return Response.json({ error: "return not found" }, { status: 404 });
  }

  if (context.readOnly) {
    const persisted = await readPersistedArtifact(returnId, key);
    if (!persisted) {
      return Response.json(
        { error: "this read-only return has no saved export to download" },
        { status: 404 },
      );
    }
    return fileResponse(persisted.bytes, persisted.filename, persisted.contentType);
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
  const pkg = await assembleExportPackage(input);
  await persistExportArtifacts(returnId, pkg, {
    generatedAt,
    paramsVersion: input.paramsVersion,
  });

  const chosen = pkg[key];
  return fileResponse(chosen.bytes, chosen.filename, chosen.contentType);
}
