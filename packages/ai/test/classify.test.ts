import { describe, expect, it, vi } from "vitest";

import { classifyDocument, parseDocumentType } from "../src/classify";
import type { ClaudeClient } from "../src/client";

/** A ClaudeClient stub — the real API is never called in the suite. */
function stubClient(reply: string | (() => Promise<string>)): ClaudeClient {
  const askVision = vi.fn(async () => (typeof reply === "string" ? reply : reply()));
  return { ask: vi.fn(), askVision };
}

const PREFILL_FIXTURE = {
  bytes: Buffer.from("%PDF-1.7 ATO pre-fill report 2025-26 ..."),
  mimeType: "application/pdf",
  filename: "prefill-report.pdf",
};

describe("parseDocumentType", () => {
  it("accepts a clean identifier", () => {
    expect(parseDocumentType("ato-prefill-report")).toBe("ato-prefill-report");
  });

  it("tolerates quoting, backticks and trailing punctuation", () => {
    expect(parseDocumentType("`rental-agent-statement`.")).toBe("rental-agent-statement");
    expect(parseDocumentType('"loan-interest-summary"')).toBe("loan-interest-summary");
  });

  it("tolerates a spelled-out answer with a leading label", () => {
    expect(parseDocumentType("Type: qs depreciation schedule")).toBe("qs-depreciation-schedule");
  });

  it("falls back to unrecognised for anything unknown", () => {
    expect(parseDocumentType("this looks like a payslip maybe")).toBe("unrecognised");
    expect(parseDocumentType("")).toBe("unrecognised");
  });
});

describe("classifyDocument", () => {
  it("maps an ATO pre-fill report fixture to ato-prefill-report", async () => {
    const client = stubClient("ato-prefill-report");
    await expect(classifyDocument(PREFILL_FIXTURE, client)).resolves.toBe("ato-prefill-report");
    expect(client.askVision).toHaveBeenCalledOnce();
  });

  it("passes the document as a PDF vision part with the filename in the prompt", async () => {
    const client = stubClient("income-statement");
    await classifyDocument({ ...PREFILL_FIXTURE, filename: "myEmployer.pdf" }, client);
    const [parts, prompt] = vi.mocked(client.askVision).mock.calls[0]!;
    expect(parts[0]).toMatchObject({ kind: "pdf", mimeType: "application/pdf" });
    expect(prompt).toContain("myEmployer.pdf");
  });

  it("treats png/jpg uploads as image parts", async () => {
    const client = stubClient("donation-receipt");
    await classifyDocument(
      { bytes: Buffer.from("PNG"), mimeType: "image/png", filename: "receipt.png" },
      client,
    );
    const [parts] = vi.mocked(client.askVision).mock.calls[0]!;
    expect(parts[0]).toMatchObject({ kind: "image", mimeType: "image/png" });
  });

  it("falls back to unrecognised when the model is unsure", async () => {
    await expect(classifyDocument(PREFILL_FIXTURE, stubClient("unrecognised"))).resolves.toBe(
      "unrecognised",
    );
  });

  it("falls back to unrecognised when the Claude call throws", async () => {
    const client = stubClient(() => Promise.reject(new Error("network")));
    await expect(classifyDocument(PREFILL_FIXTURE, client)).resolves.toBe("unrecognised");
  });
});
