/**
 * T6 — `lib/rental-intake.ts`: the mid-conversation rental-document machine
 * (PRD FR-24, Q23-Q25). Ported substance of v1's `extractFigures` rental path.
 */
import {
  createEmptyReturnModel,
  needsRepairsConfirmation,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assembleRentalFromDocument,
  DEPRECIATION_WARNING,
  depreciationOutstanding,
  isRentalDocType,
  RENTAL_DOC_SLOT,
  repairsConfirmationPrompt,
  summariseRentalDocument,
} from "../lib/rental-intake";

function rentalModel(): ReturnModel {
  const base = createEmptyReturnModel("2025-26");
  return { ...base, rental: { ...base.rental, present: true } };
}

const source = { docId: "agent1", bytes: Buffer.from("pdf"), mimeType: "application/pdf" };

describe("rental-intake — document type routing", () => {
  it("recognises the three rental source document types and nothing else", () => {
    expect(isRentalDocType("rental-agent-statement")).toBe(true);
    expect(isRentalDocType("loan-interest-summary")).toBe(true);
    expect(isRentalDocType("qs-depreciation-schedule")).toBe(true);
    expect(isRentalDocType("dividend-statement")).toBe(false);
    expect(RENTAL_DOC_SLOT["rental-agent-statement"]).toBe("agentStatement");
  });
});

describe("rental-intake — agent statement (PRD FR-24)", () => {
  it("folds the agent statement into the schedule and summarises what it read", async () => {
    const askVision = vi.fn(async (_parts: unknown, prompt: string) => {
      if (prompt.includes("managing agent's annual statement")) {
        return JSON.stringify({
          grossRent: { amount: 24000, page: 1, snippet: "Rent collected $24,000" },
          otherRentalIncome: null,
          expenses: [
            {
              key: "agentFees",
              amount: 1800,
              page: 1,
              snippet: "Management fee $1,800",
              description: "",
            },
          ],
        });
      }
      return "{}";
    });

    const before = rentalModel().rental;
    const schedule = await assembleRentalFromDocument({
      model: rentalModel(),
      slot: "agentStatement",
      source,
      client: { askVision } as never,
    });

    expect(schedule.present).toBe(true);
    expect(schedule.grossRent.value).toBe(24000);
    expect(schedule.grossRent.status).toBe("proposed");
    expect(schedule.expenses.agentFees.amount.value).toBe(1800);
    expect(schedule.netRentalResult.value).toBe(24000 - 1800);

    const summary = summariseRentalDocument(before, schedule, "agentStatement");
    expect(summary).toMatch(/managing agent statement/);
    expect(summary).toMatch(/\$24,000 gross rent/);
    expect(summary).toMatch(/\$1,800 agent fees/);
  });

  it("flags a repairs line over $1,000 for an explicit genuine-repair confirmation (PRD Q25)", async () => {
    const askVision = vi.fn(async (_parts: unknown, prompt: string) => {
      if (prompt.includes("managing agent's annual statement")) {
        return JSON.stringify({
          grossRent: { amount: 20000, page: 1, snippet: "Rent $20,000" },
          otherRentalIncome: null,
          expenses: [
            {
              key: "repairsAndMaintenance",
              amount: 4200,
              page: 2,
              snippet: "Repairs $4,200",
              description: "",
            },
          ],
        });
      }
      return "{}";
    });

    const schedule = await assembleRentalFromDocument({
      model: rentalModel(),
      slot: "agentStatement",
      source,
      client: { askVision } as never,
    });

    expect(needsRepairsConfirmation(schedule)).toBe(true);
    const prompt = repairsConfirmationPrompt(schedule);
    expect(prompt).toMatch(/\$4,200/);
    expect(prompt).toMatch(/genuine repair|improvement/i);
  });

  it("does not flag a repairs line at or under $1,000", async () => {
    const askVision = vi.fn(async (_parts: unknown, prompt: string) =>
      prompt.includes("managing agent's annual statement")
        ? JSON.stringify({
            grossRent: { amount: 20000, page: 1, snippet: "x" },
            otherRentalIncome: null,
            expenses: [
              {
                key: "repairsAndMaintenance",
                amount: 600,
                page: 1,
                snippet: "Repairs $600",
                description: "",
              },
            ],
          })
        : "{}",
    );
    const schedule = await assembleRentalFromDocument({
      model: rentalModel(),
      slot: "agentStatement",
      source,
      client: { askVision } as never,
    });
    expect(needsRepairsConfirmation(schedule)).toBe(false);
  });
});

describe("rental-intake — depreciation with no QS schedule (PRD Q23)", () => {
  it("depreciationOutstanding is true only when there is no QS schedule and both lines are unset", () => {
    const schedule = rentalModel().rental;
    expect(depreciationOutstanding(schedule, false)).toBe(true);
    expect(depreciationOutstanding(schedule, true)).toBe(false);
  });

  it("the warning names the under-claiming risk and offers both choices", () => {
    expect(DEPRECIATION_WARNING).toMatch(/under-claiming/i);
    expect(DEPRECIATION_WARNING).toMatch(/quantity surveyor/i);
    expect(DEPRECIATION_WARNING).toMatch(/proceed without/i);
  });
});
