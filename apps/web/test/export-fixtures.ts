/** Shared export-step test fixtures (PRD FR-14). */
import type { ReturnModel } from "@aus-tax-lodge/model";

import { confirmedField, readyModel } from "./review-fixtures";

/** `readyModel()` plus the taxpayer identity fields the FR-13 export gate also requires. */
export function exportableModel(): ReturnModel {
  const base = readyModel();
  return {
    ...base,
    taxpayer: {
      fullName: confirmedField("Priya Example"),
      dateOfBirth: confirmedField("1985-03-02"),
      postalAddress: confirmedField({
        line1: "1 Test St",
        line2: "",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "Australia",
      }),
      taxFileNumber: confirmedField("123456782"),
      refundAccount: confirmedField({
        bsb: "062-000",
        accountNumber: "12345678",
        accountName: "Priya Example",
      }),
    },
  };
}

/** {@link exportableModel} with one dividend holding whose franking credits trip the FR-13 warning. */
export function modelWithFrankingWarning(): ReturnModel {
  const model = exportableModel();
  return {
    ...model,
    income: {
      ...model.income,
      dividends: [
        {
          id: "d1",
          company: confirmedField("ASX Co"),
          unfranked: confirmedField(0),
          franked: confirmedField(700),
          frankingCredits: confirmedField(50),
          tfnAmountsWithheld: confirmedField(0),
        },
      ],
    },
  };
}
