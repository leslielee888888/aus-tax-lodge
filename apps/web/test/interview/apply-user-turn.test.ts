import type { ReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it, vi } from "vitest";

import { applyUserTurn, InterviewFieldError } from "../../lib/interview";
import type { InterviewClient } from "../../lib/interview";
import { appendTurn, emptyConversation, type ConversationState } from "../../lib/conversation";
import { readyModel } from "../review-fixtures";

function mockClient(reply: string): { client: InterviewClient; ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async () => reply);
  return { client: { ask }, ask };
}

function convoAsking(text: string): ConversationState {
  return appendTurn(
    { ...emptyConversation(), phase: "interview" },
    { role: "assistant", kind: "message", text },
  );
}

const BASE: ReturnModel = readyModel();

describe("applyUserTurn (PRD FR-4)", () => {
  it("maps 'I worked from home about 5 hours a week' onto the WFH fields with user-entered provenance", async () => {
    const { client } = mockClient(
      JSON.stringify({
        updates: [{ path: "deductions.workFromHome.hours", value: 260, kind: "number" }],
      }),
    );
    const result = await applyUserTurn({
      model: BASE,
      conversation: convoAsking("Did you work from home this year?"),
      text: "I worked from home about 5 hours a week",
      client,
    });

    expect(result.appliedPaths).toEqual(["deductions.workFromHome.hours"]);
    expect(result.model.deductions.workFromHome.hours).toMatchObject({
      value: 260,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(result.clarify).toBeUndefined();
    expect(result.outOfScope).toBeUndefined();
  });

  it("returns a clarifying question and leaves the model untouched for an un-splittable reply", async () => {
    const { client } = mockClient(
      JSON.stringify({ clarify: "Roughly how much was tools, and how much union fees?" }),
    );
    const result = await applyUserTurn({
      model: BASE,
      conversation: convoAsking("Any other work-related expenses?"),
      text: "about two grand for tools and some union fees",
      client,
    });

    expect(result.clarify).toMatch(/tools/i);
    expect(result.appliedPaths).toEqual([]);
    expect(result.model).toBe(BASE);
  });

  it("reports a capital-gains scope finding for 'I sold some shares this year' — not swallowed", async () => {
    const { client } = mockClient(JSON.stringify({ updates: [], outOfScope: ["capital-gains"] }));
    const result = await applyUserTurn({
      model: BASE,
      conversation: convoAsking("Anything else about your income?"),
      text: "I sold some shares this year",
      client,
    });

    expect(result.outOfScope?.map((f) => f.code)).toContain("capital-gains");
    expect(result.appliedPaths).toEqual([]);
  });

  it("surfaces a deterministic scope finding when an answer takes the return out of scope", async () => {
    const { client } = mockClient(
      JSON.stringify({
        updates: [{ path: "questionnaire.residencyFullYear", value: false, kind: "boolean" }],
      }),
    );
    const result = await applyUserTurn({
      model: BASE,
      conversation: convoAsking("Were you an Australian resident for the whole year?"),
      text: "No, I moved overseas in March",
      client,
    });

    expect(result.outOfScope?.map((f) => f.code)).toContain("residency-not-full-year-resident");
    expect(result.model.questionnaire.residencyFullYear.value).toBe(false);
  });

  it("throws for a Claude-proposed path outside the closed allow-list — never writes it", async () => {
    const { client } = mockClient(
      JSON.stringify({
        updates: [{ path: "taxpayer.taxFileNumber", value: "999999999", kind: "string" }],
      }),
    );
    await expect(
      applyUserTurn({
        model: BASE,
        conversation: convoAsking("What's your TFN?"),
        text: "it's 999 999 999",
        client,
      }),
    ).rejects.toThrow(InterviewFieldError);
  });

  it("keeps context and questionnaire in step for the study-loan fact", async () => {
    const { client } = mockClient(
      JSON.stringify({
        updates: [{ path: "context.holdsStudyLoan", value: true, kind: "boolean" }],
      }),
    );
    const result = await applyUserTurn({
      model: BASE,
      conversation: convoAsking("Do you have a HELP or study loan?"),
      text: "yes I've still got a HECS debt",
      client,
    });
    expect(result.model.context.holdsStudyLoan.value).toBe(true);
    expect(result.model.questionnaire.studyLoanHeld.value).toBe(true);
    expect(result.model.questionnaire.studyLoanHeld.origin).toEqual({ kind: "user-answer" });
  });
});
