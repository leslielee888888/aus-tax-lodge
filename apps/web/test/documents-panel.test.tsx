// @vitest-environment jsdom
import type { DocumentMetadata } from "@aus-tax-lodge/store";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentsPanel } from "../app/returns/[returnId]/documents/DocumentsPanel";

afterEach(cleanup);

function doc(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    docId: "doc1",
    filename: "prefill.pdf",
    mimeType: "application/pdf",
    size: 1000,
    detectedType: "ato-prefill-report",
    extractable: true,
    uploadedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DocumentsPanel (PRD FR-2, FR-3, §7 step 4)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the empty state with nothing uploaded", () => {
    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[]}
        rentalPresent={false}
        initialExtracted={[]}
      />,
    );
    expect(screen.getByText(/Nothing uploaded yet/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Extract figures/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("uploads a file via the file input and renders it once the route returns it", async () => {
    const uploaded = doc({
      docId: "new-doc",
      filename: "income_statement.pdf",
      detectedType: "income-statement",
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ documents: [uploaded] }, 201));

    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[]}
        rentalPresent={false}
        initialExtracted={[]}
      />,
    );

    const input = screen.getByLabelText(/Choose files to upload/i) as HTMLInputElement;
    const file = new File(["dummy"], "income_statement.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("income_statement.pdf")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(
      "/api/returns/ret1/documents",
      expect.objectContaining({ method: "POST" }),
    );
    const [, requestInit] = vi.mocked(fetch).mock.calls[0]!;
    const body = requestInit!.body as FormData;
    expect(body.get("files")).toBeInstanceOf(File);
  });

  it("shows a rejected file's reason without calling the upload route", () => {
    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[]}
        rentalPresent={false}
        initialExtracted={[]}
      />,
    );

    const input = screen.getByLabelText(/Choose files to upload/i) as HTMLInputElement;
    const file = new File(["dummy"], "return-notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/unsupported file type/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("PATCHes a type correction and updates the row", async () => {
    const corrected = doc({ detectedType: "income-statement" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ document: corrected }));

    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[doc()]}
        rentalPresent={false}
        initialExtracted={[]}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("ato-prefill-report");

    fireEvent.change(select, { target: { value: "income-statement" } });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/returns/ret1/documents/doc1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ type: "income-statement" }),
        }),
      ),
    );
    await waitFor(() => expect(select.value).toBe("income-statement"));
  });

  it("shows a 'kept, not read' note for an unrecognised file", () => {
    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[doc({ detectedType: "unrecognised", extractable: false })]}
        rentalPresent={false}
        initialExtracted={[]}
      />,
    );
    expect(screen.getByText("Kept, not read")).toBeTruthy();
  });

  it("checklist ticks off uploaded situational documents and warns when there's no pre-fill report", () => {
    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[doc({ docId: "d1", detectedType: "income-statement" })]}
        rentalPresent={false}
        initialExtracted={[]}
      />,
    );

    const checklist = screen
      .getByText("Expected for your situation")
      .closest("div")!.parentElement!;
    expect(within(checklist).getByText("Income statement")).toBeTruthy();
    expect(screen.getByText(/No ATO pre-fill report yet/)).toBeTruthy();
    // The rental checklist rows are not shown when the return has no rental.
    expect(within(checklist).queryByText("Rental agent statement")).toBeNull();
  });

  it("checklist shows the rental document set when the return's rental is in progress", () => {
    render(
      <DocumentsPanel
        returnId="ret1"
        expectedRevision={1}
        initialDocuments={[doc({ docId: "d1", detectedType: "ato-prefill-report" })]}
        rentalPresent={true}
        initialExtracted={[]}
      />,
    );

    const checklist = screen
      .getByText("Expected for your situation")
      .closest("div")!.parentElement!;
    expect(screen.queryByText(/No ATO pre-fill report yet/)).toBeNull();
    expect(within(checklist).getByText("Rental agent statement")).toBeTruthy();
    expect(within(checklist).getByText("Loan interest summary")).toBeTruthy();
    expect(within(checklist).getByText("QS depreciation schedule")).toBeTruthy();
  });
});
