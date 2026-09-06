import { describe, expect, it, vi } from "vitest";

import {
  checkDocumentForOutOfScopeContent,
  parseScopeContentReply,
  SCOPE_CONTENT_CHECK_PROMPT,
  type ScopeVisionClient,
} from "../src/content-check";
import { detectOutOfScope } from "../src/detect";
import { cleanSalaryReturn } from "./fixtures";

function stubClient(reply: string): ScopeVisionClient {
  return { askVision: vi.fn(async () => reply) };
}

const PART = { kind: "pdf" as const, mimeType: "application/pdf", bytes: Buffer.from("%PDF fund") };

describe("parseScopeContentReply", () => {
  it("reads a clean JSON array", () => {
    expect(parseScopeContentReply('["capital-gains","foreign-income"]')).toEqual([
      "capital-gains",
      "foreign-income",
    ]);
  });

  it("returns [] for an empty array", () => {
    expect(parseScopeContentReply("[]")).toEqual([]);
  });

  it("tolerates a leading label and prose around the array", () => {
    expect(
      parseScopeContentReply(
        'Categories: ["trust-partnership-managed-fund-distribution"] — flagged.',
      ),
    ).toEqual(["trust-partnership-managed-fund-distribution"]);
  });

  it("tolerates underscores and spaces instead of hyphens", () => {
    expect(parseScopeContentReply('["employee_share_scheme"]')).toEqual(["employee-share-scheme"]);
  });

  it("drops unknown tokens", () => {
    expect(parseScopeContentReply('["capital-gains","rental-income","salary"]')).toEqual([
      "capital-gains",
    ]);
  });

  it("de-duplicates", () => {
    expect(parseScopeContentReply('["capital-gains","capital-gains"]')).toEqual(["capital-gains"]);
  });
});

describe("checkDocumentForOutOfScopeContent", () => {
  it("classifies a managed-fund statement and passes the scope prompt", async () => {
    const client = stubClient('["trust-partnership-managed-fund-distribution"]');
    const result = await checkDocumentForOutOfScopeContent(
      { docId: "d7", filename: "managed-fund.pdf", parts: [PART] },
      client,
    );
    expect(result).toEqual({
      docId: "d7",
      filename: "managed-fund.pdf",
      categories: ["trust-partnership-managed-fund-distribution"],
    });
    const [parts, prompt, options] = vi.mocked(client.askVision).mock.calls[0]!;
    expect(parts).toEqual([PART]);
    expect(prompt).toBe(SCOPE_CONTENT_CHECK_PROMPT);
    // FR-19: the scope gate is not an advice step.
    expect(options?.system).toContain("does not give tax advice");
  });

  it("returns no categories for an in-scope document", async () => {
    const result = await checkDocumentForOutOfScopeContent(
      { docId: "d1", filename: "dividends.pdf", parts: [PART] },
      stubClient("[]"),
    );
    expect(result.categories).toEqual([]);
  });

  it("propagates a Claude call failure rather than reporting the document clean", async () => {
    const client: ScopeVisionClient = {
      askVision: vi.fn(async () => {
        throw new Error("network");
      }),
    };
    await expect(
      checkDocumentForOutOfScopeContent({ docId: "d1", filename: "x.pdf", parts: [PART] }, client),
    ).rejects.toThrow("network");
  });

  it("feeds a mocked classification straight into detectOutOfScope", async () => {
    const client = stubClient('["trust-partnership-managed-fund-distribution"]');
    const contentFindings = [
      await checkDocumentForOutOfScopeContent(
        { docId: "d7", filename: "managed-fund.pdf", parts: [PART] },
        client,
      ),
    ];
    const findings = detectOutOfScope({ model: cleanSalaryReturn(), contentFindings });
    expect(findings.map((f) => f.code)).toEqual(["trust-partnership-managed-fund-distribution"]);
  });
});
