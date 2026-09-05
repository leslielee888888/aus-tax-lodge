// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DetailsForm } from "../app/returns/[returnId]/details/DetailsForm";
import { emptyDetailsFormValues } from "../lib/details/form";
import { DetailsReadOnly } from "../app/returns/[returnId]/details/DetailsReadOnly";
import { createEmptyReturnModel } from "@aus-tax-lodge/model";

afterEach(cleanup);

describe("DetailsForm — spouse toggle (PRD FR-1)", () => {
  it("hides spouse fields until the toggle is checked", () => {
    render(
      <DetailsForm
        returnId="ret1"
        expectedRevision={1}
        initialValues={emptyDetailsFormValues()}
        spouseIncomeCandidates={[]}
      />,
    );

    expect(screen.queryByLabelText(/Spouse name/i)).toBeNull();
    expect(screen.queryByText(/estimated/i)).toBeNull();
  });

  it("reveals spouse fields once the toggle is checked, and hides them again when unchecked", () => {
    render(
      <DetailsForm
        returnId="ret1"
        expectedRevision={1}
        initialValues={emptyDetailsFormValues()}
        spouseIncomeCandidates={[]}
      />,
    );

    const toggle = screen.getByLabelText(/I had a spouse/i);
    fireEvent.click(toggle);

    expect(screen.getByLabelText(/Spouse name/i)).toBeTruthy();
    expect(screen.getByText(/estimated/i)).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByLabelText(/Spouse name/i)).toBeNull();
  });

  it("starts with the spouse fields shown when resuming a return that already has a spouse", () => {
    render(
      <DetailsForm
        returnId="ret1"
        expectedRevision={1}
        initialValues={{ ...emptyDetailsFormValues(), hasSpouse: true, spouseName: "Alex" }}
        spouseIncomeCandidates={[]}
      />,
    );

    expect(screen.getByLabelText(/Spouse name/i)).toBeTruthy();
  });

  it("offers to copy a matching candidate's taxable income once the spouse name matches", () => {
    render(
      <DetailsForm
        returnId="ret1"
        expectedRevision={1}
        initialValues={{ ...emptyDetailsFormValues(), hasSpouse: true }}
        spouseIncomeCandidates={[{ name: "Alex Sharma", taxableIncome: 78400 }]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Copy from/i })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Spouse name/i), {
      target: { value: "Alex Sharma" },
    });

    const copyButton = screen.getByRole("button", { name: /Copy from Alex Sharma/i });
    fireEvent.click(copyButton);

    expect((screen.getByLabelText(/Spouse taxable income/i) as HTMLInputElement).value).toBe(
      "78400",
    );
  });
});

describe("DetailsReadOnly (PRD FR-16)", () => {
  it("renders values only — no inputs, selects or buttons", () => {
    const { container } = render(
      <DetailsReadOnly model={createEmptyReturnModel()} targetYear="2024-25" />,
    );

    expect(container.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
    expect(screen.getByText(/Lodged — 2024–25, read-only/)).toBeTruthy();
  });
});
