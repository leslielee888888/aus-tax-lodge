import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExportPackage } from "@aus-tax-lodge/export";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exportableModel } from "./export-fixtures";

let dir: string;

beforeAll(() => {
  process.env.RETURN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.APP_PASSPHRASE = "test-passphrase";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";
});

beforeEach(async () => {
  // A fresh data dir + module registry per test — the store/config/purge
  // singletons rebind to the new dir on first import.
  dir = await mkdtemp(join(tmpdir(), "atl-purge-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);

function fakePackage(): ExportPackage {
  return {
    pdf: {
      filename: "return-summary-2025-26.pdf",
      contentType: "application/pdf",
      bytes: bytes("%PDF-fake"),
    },
    json: {
      filename: "return-data-2025-26.json",
      contentType: "application/json",
      bytes: bytes("{}"),
    },
    validationReport: {
      filename: "validation-report-2025-26.txt",
      contentType: "text/plain; charset=utf-8",
      bytes: bytes("report"),
    },
    sourceIndex: {
      filename: "source-index-2025-26.txt",
      contentType: "text/plain; charset=utf-8",
      bytes: bytes("index"),
    },
  };
}

/** Create an exported return with a persisted export manifest dated `generatedAt`, plus one source doc. */
async function makeExportedReturn(generatedAt: string): Promise<string> {
  const { getReturnRepository } = await import("../lib/returns");
  const { getDocumentStore } = await import("../lib/store");
  const { persistExportArtifacts } = await import("../lib/export/persist");

  const envelope = await getReturnRepository().createReturn({
    data: exportableModel(),
    currentStep: "export",
  });
  await getDocumentStore().putDocument(envelope.returnId, {
    filename: "ato-prefill.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("%PDF-1.4 fake prefill"),
    detectedType: "ato-prefill-report",
  });
  await persistExportArtifacts(envelope.returnId, fakePackage(), {
    generatedAt,
    paramsVersion: "2025-26.1",
  });
  return envelope.returnId;
}

const OLD = "2020-01-01T00:00:00.000Z";

describe("maybePurgeExportedDocuments (PRD FR-18)", () => {
  it("does nothing when the toggle is off", async () => {
    const returnId = await makeExportedReturn(OLD);
    const { getDocumentStore } = await import("../lib/store");
    const { maybePurgeExportedDocuments } = await import("../lib/purge");

    const result = await maybePurgeExportedDocuments({ force: true });
    expect(result.purgedReturnIds).toEqual([]);
    expect(await getDocumentStore().listDocuments(returnId)).toHaveLength(1);
  });

  it("does nothing when the export is more recent than the window", async () => {
    const returnId = await makeExportedReturn(new Date().toISOString());
    const { writeInstanceSettings } = await import("../lib/instance-settings");
    const { getDocumentStore } = await import("../lib/store");
    const { maybePurgeExportedDocuments } = await import("../lib/purge");

    await writeInstanceSettings({ purgeSourceDocuments: { enabled: true, afterDays: 90 } });
    const result = await maybePurgeExportedDocuments({ force: true });

    expect(result.purgedReturnIds).toEqual([]);
    expect(await getDocumentStore().listDocuments(returnId)).toHaveLength(1);
  });

  it("purges only the source docs of an old exported return, keeping the return + json + export artifacts", async () => {
    const returnId = await makeExportedReturn(OLD);
    const { writeInstanceSettings } = await import("../lib/instance-settings");
    const { getDocumentStore } = await import("../lib/store");
    const { getReturnRepository } = await import("../lib/returns");
    const { readExportManifest, readPersistedArtifact } = await import("../lib/export/persist");
    const { maybePurgeExportedDocuments } = await import("../lib/purge");

    await writeInstanceSettings({ purgeSourceDocuments: { enabled: true, afterDays: 90 } });
    const result = await maybePurgeExportedDocuments({ force: true });

    expect(result.purgedReturnIds).toEqual([returnId]);
    expect(await getDocumentStore().listDocuments(returnId)).toEqual([]);

    const reloaded = await getReturnRepository().loadReturn(returnId);
    expect(reloaded.envelope.status).toBe("exported");
    await expect(stat(join(dir, "returns", returnId, "return.json"))).resolves.toBeDefined();

    const pdf = await readPersistedArtifact(returnId, "pdf");
    expect(pdf?.bytes).toBeDefined();

    const manifest = await readExportManifest(returnId);
    expect(manifest?.sourceDocumentsPurgedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A second sweep is a no-op — already marked.
    const again = await maybePurgeExportedDocuments({ force: true });
    expect(again.purgedReturnIds).toEqual([]);
  });

  it("never touches a return that has not been exported", async () => {
    const { getReturnRepository } = await import("../lib/returns");
    const { getDocumentStore } = await import("../lib/store");
    const { writeInstanceSettings } = await import("../lib/instance-settings");
    const { maybePurgeExportedDocuments } = await import("../lib/purge");

    const envelope = await getReturnRepository().createReturn({ data: exportableModel() });
    await getDocumentStore().putDocument(envelope.returnId, {
      filename: "wip.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF wip"),
      detectedType: "ato-prefill-report",
    });

    await writeInstanceSettings({ purgeSourceDocuments: { enabled: true, afterDays: 1 } });
    const result = await maybePurgeExportedDocuments({ force: true });

    expect(result.purgedReturnIds).toEqual([]);
    expect(await getDocumentStore().listDocuments(envelope.returnId)).toHaveLength(1);
  });
});
