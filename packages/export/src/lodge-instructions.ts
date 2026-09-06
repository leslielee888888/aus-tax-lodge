/**
 * "How to lodge this in myTax" (PRD FR-14 §7 step 8) — rendered on the export
 * screen and included as a text file in the records archive. Explicitly states
 * that no ATO transmission occurs.
 */
import { formatDollars } from "./money";
import type { ExportPackageInput } from "./types";
import { buildReturnView } from "./view";

export interface LodgeStep {
  readonly heading: string;
  readonly body: string;
}

export interface LodgeInstructions {
  readonly headline: string;
  readonly steps: readonly LodgeStep[];
  readonly noTransmissionNotice: string;
}

/** The structured "how to lodge" content. */
export function buildLodgeInstructionsData(input: ExportPackageInput): LodgeInstructions {
  const view = buildReturnView(input);
  const outcome = view.estimate;
  const outcomeText =
    outcome.outcomeKind === "refund"
      ? `${formatDollars(outcome.outcomeAmount)} refund`
      : `${formatDollars(outcome.outcomeAmount)} to pay`;

  return {
    headline: `How to lodge your ${view.targetYear} return in myTax`,
    steps: [
      {
        heading: "1. Sign in to ATO myTax through myGov",
        body: "Go to my.gov.au, sign in to myGov, and open the ATO service. Nothing here is sent to the ATO — you lodge it yourself.",
      },
      {
        heading: `2. Start your ${view.targetYear} return and work through it label by label`,
        body: "Use the return summary PDF. It lists every figure in the same order myTax asks for them. Labels marked [computed] are worked out by myTax / the ATO — check them against the estimate here.",
      },
      {
        heading: "3. Reconcile against myTax pre-fill, then check the estimate and submit",
        body: `Where myTax pre-fill differs from a figure here, the source index shows which document each figure came from — you decide which to keep. Check the myTax estimate against this one (${outcomeText}), then submit.`,
      },
    ],
    noTransmissionNotice:
      "This tool does not connect to the ATO. Your return is not sent to the ATO by this app — no figure and no document has been transmitted. Lodgement happens only when you submit in myTax yourself.",
  };
}

/** Plain-text "how to lodge" note for the export screen and the archive. */
export function buildLodgeInstructions(input: ExportPackageInput): string {
  const data = buildLodgeInstructionsData(input);
  const out: string[] = [data.headline, ""];
  for (const step of data.steps) {
    out.push(step.heading);
    out.push(`   ${step.body}`);
    out.push("");
  }
  out.push(data.noTransmissionNotice);
  return out.join("\n");
}
