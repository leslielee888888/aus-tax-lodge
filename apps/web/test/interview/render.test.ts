import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { renderModelForPrompt, renderTranscript } from "../../lib/interview";
import { appendTurn, emptyConversation } from "../../lib/conversation";
import { confirmedField, readyModel } from "../review-fixtures";

describe("renderModelForPrompt (PRD FR-3, FR-17)", () => {
  it("never contains the raw TFN", () => {
    const model = {
      ...readyModel(),
      taxpayer: {
        ...createEmptyReturnModel().taxpayer,
        taxFileNumber: confirmedField("123456782"),
      },
    };
    const out = renderModelForPrompt(model);
    expect(out).not.toContain("123456782");
    expect(out.toLowerCase()).not.toContain("tax file number");
  });

  it("renders income, deductions and the FR-6 facts in plain English", () => {
    const out = renderModelForPrompt(readyModel());
    expect(out).toContain("Salary from Acme Pty Ltd");
    expect(out).toContain("DEDUCTIONS");
    expect(out).toContain("Australian resident for the full year: yes");
    expect(out).toContain("RENTAL: none declared yet");
  });

  it("marks a proposed, unconfirmed figure so Claude does not treat it as settled", () => {
    const base = readyModel();
    const model = {
      ...base,
      income: {
        ...base.income,
        governmentAllowances: {
          value: 1200,
          status: "proposed" as const,
          origin: { kind: "computed" as const, from: "x" },
          proposedValue: 1200,
          edits: [],
        },
      },
    };
    expect(renderModelForPrompt(model)).toContain("(proposed, unconfirmed)");
  });
});

describe("renderTranscript", () => {
  it("renders the last turns oldest-first and caps the window", () => {
    let convo = emptyConversation();
    for (let i = 0; i < 20; i += 1) {
      convo = appendTurn(convo, { role: "user", kind: "message", text: `msg ${i}` });
    }
    const out = renderTranscript(convo);
    expect(out).not.toContain("msg 4");
    expect(out).toContain("msg 5");
    expect(out.trimEnd().endsWith("USER: msg 19")).toBe(true);
  });

  it("summarises card and file turns", () => {
    let convo = emptyConversation();
    convo = appendTurn(convo, { role: "user", kind: "file", filename: "prefill.pdf", docId: "d1" });
    convo = appendTurn(convo, {
      role: "assistant",
      kind: "card",
      card: { type: "income-checkpoint" },
    });
    const out = renderTranscript(convo);
    expect(out).toContain("USER [uploaded: prefill.pdf]");
    expect(out).toContain("ASSISTANT [card: income-checkpoint]");
  });
});
