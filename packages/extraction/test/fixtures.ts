import { vi } from "vitest";

import type { ClaudeClient } from "@aus-tax-lodge/ai";
import type { DocumentMetadata, StoredDocument } from "@aus-tax-lodge/store";

/** A ClaudeClient stub — the real API is never called in this suite. */
export function stubClient(
  reply: string | (() => Promise<string>),
): Pick<ClaudeClient, "askVision"> {
  return { askVision: vi.fn(async () => (typeof reply === "string" ? reply : reply())) };
}

export function testMetadata(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    docId: "doc-1",
    filename: "document.pdf",
    mimeType: "application/pdf",
    size: 1_000,
    detectedType: "income-statement",
    extractable: true,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function stubStore(doc: StoredDocument): { getDocument: ReturnType<typeof vi.fn> } {
  return { getDocument: vi.fn(async () => doc) };
}
