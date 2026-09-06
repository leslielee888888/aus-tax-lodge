import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDocumentStore, type DocumentStore } from "../src/store";

const KEY = randomBytes(32);
const PDF = Buffer.from("%PDF-1.7\n...binary...", "utf8");

let dataDir: string;
let store: DocumentStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "atl-store-"));
  store = createDocumentStore({ dataDir, encryptionKey: KEY });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("putDocument / getDocument", () => {
  it("round-trips the bytes and metadata", async () => {
    const meta = await store.putDocument("ret1", {
      filename: "prefill.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
      detectedType: "ato-prefill-report",
    });

    expect(meta.docId).toMatch(/[0-9a-f-]{36}/);
    expect(meta.size).toBe(PDF.length);
    expect(meta.extractable).toBe(true);
    expect(meta.uploadedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const got = await store.getDocument("ret1", meta.docId);
    expect(got.bytes.equals(PDF)).toBe(true);
    expect(got.metadata).toEqual(meta);
  });

  it("defaults an unclassified document to unrecognised / not extractable", async () => {
    const meta = await store.putDocument("ret1", {
      filename: "mystery.png",
      mimeType: "image/png",
      bytes: Buffer.from("x"),
    });
    expect(meta.detectedType).toBe("unrecognised");
    expect(meta.extractable).toBe(false);
  });

  it("throws for an unknown document id", async () => {
    await expect(store.getDocument("ret1", "does-not-exist")).rejects.toThrow(/not found/);
  });
});

describe("encryption at rest", () => {
  it("writes no plaintext filename or content to disk", async () => {
    await store.putDocument("ret1", {
      filename: "super-secret-name.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("PLAINTEXT-MARKER-12345"),
    });

    const dir = join(dataDir, "returns", "ret1", "documents");
    for (const name of await readdir(dir)) {
      const raw = await readFile(join(dir, name));
      expect(raw.toString("utf8")).not.toContain("super-secret-name");
      expect(raw.toString("utf8")).not.toContain("PLAINTEXT-MARKER-12345");
    }
  });
});

describe("per-return isolation", () => {
  it("does not leak documents across returns", async () => {
    const a = await store.putDocument("retA", {
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });
    await store.putDocument("retB", {
      filename: "b.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });

    expect(await store.listDocuments("retB")).toHaveLength(1);
    expect((await store.listDocuments("retB"))[0]?.filename).toBe("b.pdf");
    await expect(store.getDocument("retB", a.docId)).rejects.toThrow(/not found/);
  });

  it("listDocuments returns [] for an unknown return", async () => {
    expect(await store.listDocuments("nope")).toEqual([]);
  });
});

describe("setDocumentType (user correction)", () => {
  it("updates the type and re-derives extractable", async () => {
    const meta = await store.putDocument("ret1", {
      filename: "statement.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });
    expect(meta.extractable).toBe(false);

    const corrected = await store.setDocumentType("ret1", meta.docId, "rental-agent-statement");
    expect(corrected.detectedType).toBe("rental-agent-statement");
    expect(corrected.extractable).toBe(true);

    const persisted = await store.getDocument("ret1", meta.docId);
    expect(persisted.metadata.detectedType).toBe("rental-agent-statement");
  });

  it("rejects an unknown type", async () => {
    const meta = await store.putDocument("ret1", {
      filename: "x.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });
    await expect(
      // @ts-expect-error deliberately invalid
      store.setDocumentType("ret1", meta.docId, "not-a-type"),
    ).rejects.toThrow(/unknown document type/);
  });
});

describe("deletion", () => {
  it("deleteDocument removes the blob and its metadata", async () => {
    const meta = await store.putDocument("ret1", {
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });
    await store.deleteDocument("ret1", meta.docId);
    expect(await store.listDocuments("ret1")).toEqual([]);
    await expect(store.deleteDocument("ret1", meta.docId)).rejects.toThrow(/not found/);
  });

  it("deleteReturn removes the whole return directory (PRD FR-18)", async () => {
    await store.putDocument("ret1", {
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });
    await store.putDocument("ret1", {
      filename: "b.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });

    await store.deleteReturn("ret1");

    await expect(stat(join(dataDir, "returns", "ret1"))).rejects.toThrow();
    expect(await store.listDocuments("ret1")).toEqual([]);
  });

  it("deleteReturn on an unknown return is a no-op", async () => {
    await expect(store.deleteReturn("ghost")).resolves.toBeUndefined();
  });

  it("deleteReturn also removes the T20 export/ subdirectory and its artifacts (PRD FR-18)", async () => {
    await store.putDocument("ret1", {
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: PDF,
    });
    // Simulate T20's persisted (encrypted-at-rest) export package.
    const exportSubdir = join(dataDir, "returns", "ret1", "export");
    await mkdir(exportSubdir, { recursive: true });
    await writeFile(join(exportSubdir, "manifest.json"), "encrypted-manifest-bytes");
    await writeFile(join(exportSubdir, "return-data-2025-26.json"), "encrypted-json-bytes");

    await store.deleteReturn("ret1");

    await expect(stat(exportSubdir)).rejects.toThrow();
    await expect(stat(join(dataDir, "returns", "ret1"))).rejects.toThrow();
  });
});

describe("path safety", () => {
  it("rejects a returnId that would escape the data dir", async () => {
    await expect(
      store.putDocument("../evil", {
        filename: "a.pdf",
        mimeType: "application/pdf",
        bytes: PDF,
      }),
    ).rejects.toThrow(/invalid returnId/);
  });
});
