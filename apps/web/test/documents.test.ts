import type { DocumentType, PutDocumentInput } from "@aus-tax-lodge/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ingestUploads, resolveUploadMime, type IngestDeps } from "../lib/documents";

let docSeq = 0;

function fakeDeps(classifyImpl?: (input: { filename: string }) => Promise<DocumentType>): {
  deps: IngestDeps;
  put: ReturnType<typeof vi.fn>;
  classify: ReturnType<typeof vi.fn>;
} {
  const put = vi.fn(async (returnId: string, input: PutDocumentInput) => {
    const detectedType = input.detectedType ?? "unrecognised";
    return {
      docId: `doc-${docSeq++}`,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.bytes.length,
      detectedType,
      extractable: input.extractable ?? detectedType !== "unrecognised",
      uploadedAt: "2026-09-04T00:00:00.000Z",
    };
  });
  const classify = vi.fn(classifyImpl ?? (async () => "unrecognised" as DocumentType));
  return { deps: { store: { putDocument: put }, classify }, put, classify };
}

function form(
  files: Array<{ name: string; type: string; body?: string }>,
  extra: Record<string, string> = {},
): FormData {
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", new File([f.body ?? "data"], f.name, { type: f.type }));
  }
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  docSeq = 0;
});

describe("resolveUploadMime", () => {
  it("accepts pdf / png / jpeg by declared type", () => {
    expect(resolveUploadMime("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(resolveUploadMime("a.png", "image/png")).toBe("image/png");
    expect(resolveUploadMime("a.jpg", "image/jpeg")).toBe("image/jpeg");
  });

  it("falls back to the extension when the declared type is opaque", () => {
    expect(resolveUploadMime("scan.pdf", "")).toBe("application/pdf");
    expect(resolveUploadMime("scan.JPG", "application/octet-stream")).toBe("image/jpeg");
  });

  it("rejects anything else", () => {
    expect(
      resolveUploadMime(
        "notes.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBeNull();
    expect(resolveUploadMime("data.csv", "text/csv")).toBeNull();
  });
});

describe("ingestUploads", () => {
  it("stores multiple PDF/PNG/JPG files and returns their detected types", async () => {
    const { deps, put, classify } = fakeDeps(async ({ filename }) =>
      filename.includes("prefill") ? "ato-prefill-report" : "bank-interest-notice",
    );

    const result = await ingestUploads(
      "ret1",
      form([
        { name: "prefill.pdf", type: "application/pdf" },
        { name: "interest.png", type: "image/png" },
      ]),
      deps,
    );

    expect(result.status).toBe(201);
    expect(put).toHaveBeenCalledTimes(2);
    expect(classify).toHaveBeenCalledTimes(2);
    if (result.status !== 201) throw new Error("unreachable");
    expect(result.body.documents.map((d) => d.detectedType)).toEqual([
      "ato-prefill-report",
      "bank-interest-notice",
    ]);
  });

  it("recognises an ATO pre-fill report on ingest", async () => {
    const { deps } = fakeDeps(async () => "ato-prefill-report");
    const result = await ingestUploads(
      "ret1",
      form([{ name: "prefilling-report-2025-26.pdf", type: "application/pdf" }]),
      deps,
    );
    expect(result.status).toBe(201);
    if (result.status !== 201) throw new Error("unreachable");
    expect(result.body.documents[0]?.detectedType).toBe("ato-prefill-report");
    expect(result.body.documents[0]?.extractable).toBe(true);
  });

  it("keeps an unrecognised file but flags it not to extract", async () => {
    const { deps } = fakeDeps(async () => "unrecognised");
    const result = await ingestUploads(
      "ret1",
      form([{ name: "random.pdf", type: "application/pdf" }]),
      deps,
    );
    expect(result.status).toBe(201);
    if (result.status !== 201) throw new Error("unreachable");
    expect(result.body.documents[0]).toMatchObject({
      detectedType: "unrecognised",
      extractable: false,
    });
  });

  it("rejects a .docx with a clear 4xx and stores nothing", async () => {
    const { deps, put, classify } = fakeDeps();
    const result = await ingestUploads(
      "ret1",
      form([
        {
          name: "return-notes.docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ]),
      deps,
    );

    expect(result.status).toBe(415);
    expect(result.body).toMatchObject({
      error: expect.stringContaining("PDF, PNG or JPG"),
      rejected: [{ filename: "return-notes.docx" }],
    });
    expect(put).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it("rejects the whole batch if any file is the wrong type", async () => {
    const { deps, put } = fakeDeps();
    const result = await ingestUploads(
      "ret1",
      form([
        { name: "ok.pdf", type: "application/pdf" },
        { name: "bad.docx", type: "application/msword" },
      ]),
      deps,
    );
    expect(result.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  it("400s when there are no files", async () => {
    const { deps } = fakeDeps();
    const result = await ingestUploads("ret1", new FormData(), deps);
    expect(result.status).toBe(400);
  });

  it("applies a valid `type` field to every file and skips classification", async () => {
    const { deps, classify, put } = fakeDeps();
    const result = await ingestUploads(
      "ret1",
      form(
        [
          { name: "a.pdf", type: "application/pdf" },
          { name: "b.pdf", type: "application/pdf" },
        ],
        { type: "dividend-statement" },
      ),
      deps,
    );
    expect(result.status).toBe(201);
    expect(classify).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(2);
    if (result.status !== 201) throw new Error("unreachable");
    expect(result.body.documents.every((d) => d.detectedType === "dividend-statement")).toBe(true);
  });

  it("400s on an unknown `type` field", async () => {
    const { deps } = fakeDeps();
    const result = await ingestUploads(
      "ret1",
      form([{ name: "a.pdf", type: "application/pdf" }], { type: "not-real" }),
      deps,
    );
    expect(result.status).toBe(400);
  });
});
