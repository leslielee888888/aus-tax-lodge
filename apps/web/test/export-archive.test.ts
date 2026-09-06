import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exportableModel } from "./export-fixtures";

let dir: string;

/**
 * Config (`getServerConfig`) is read lazily inside the store/export helpers, so
 * setting the env in `beforeAll` — before the first call — is enough.
 */
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "atl-export-archive-"));
  process.env.RETURN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.APP_PASSPHRASE = "test-passphrase";
  process.env.DATA_DIR = dir;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("records archive (PRD FR-14, FR-17)", () => {
  it("builds one standard AES zip with the four artifacts, the how-to note and the source docs", async () => {
    const { getReturnRepository } = await import("../lib/returns");
    const { getDocumentStore } = await import("../lib/store");
    const { loadExportContext, buildExportInput } = await import("../lib/export/context");
    const { buildRecordsArchive } = await import("../lib/export/archive");
    const { persistExportArtifacts, readExportManifest, readPersistedArtifact } =
      await import("../lib/export/persist");

    const repo = getReturnRepository();
    const store = getDocumentStore();
    const envelope = await repo.createReturn({
      data: exportableModel(),
      currentStep: "export",
    });
    await store.putDocument(envelope.returnId, {
      filename: "ato-prefill.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 fake prefill"),
      detectedType: "ato-prefill-report",
    });

    const context = await loadExportContext(envelope.returnId);
    expect(context.assessment).not.toBeNull();

    const input = buildExportInput(context, [], "2026-07-10T00:00:00.000Z");
    const archive = await buildRecordsArchive(envelope.returnId, input, "amber-otter-1234-slate");

    expect(archive.filename).toBe("tax-records-2025-26.zip");
    expect(archive.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(archive.bytes.length).toBeGreaterThan(800);
    expect(archive.pkg.pdf.filename).toBe("return-summary-2025-26.pdf");

    // The four package artifacts persist encrypted at rest and read back.
    await persistExportArtifacts(envelope.returnId, archive.pkg, {
      generatedAt: "2026-07-10T00:00:00.000Z",
      paramsVersion: input.paramsVersion,
    });
    const manifest = await readExportManifest(envelope.returnId);
    expect(manifest?.artifacts).toHaveLength(4);
    const pdf = await readPersistedArtifact(envelope.returnId, "pdf");
    expect(pdf?.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Export marks the return "exported".
    const reloaded = await repo.loadReturn(envelope.returnId);
    expect(reloaded.envelope.status).toBe("exported");
  });

  it("rejects a password shorter than the minimum", async () => {
    const { getReturnRepository } = await import("../lib/returns");
    const { loadExportContext, buildExportInput } = await import("../lib/export/context");
    const { buildRecordsArchive, WeakArchivePasswordError } = await import("../lib/export/archive");

    const envelope = await getReturnRepository().createReturn({
      data: exportableModel(),
      currentStep: "export",
    });
    const context = await loadExportContext(envelope.returnId);
    const input = buildExportInput(context, [], "2026-07-10T00:00:00.000Z");

    await expect(buildRecordsArchive(envelope.returnId, input, "short")).rejects.toBeInstanceOf(
      WeakArchivePasswordError,
    );
  });
});
