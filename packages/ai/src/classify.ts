import { DOCUMENT_TYPES, isDocumentType, type DocumentType } from "@aus-tax-lodge/store";

import type { ClaudeClient, VisionPart } from "./client";

export interface ClassifyDocumentInput {
  readonly bytes: Buffer;
  /** `application/pdf`, `image/png`, or `image/jpeg`. */
  readonly mimeType: string;
  readonly filename: string;
}

const SYSTEM_PROMPT =
  "You are a precise document-classification step in an Australian individual " +
  "tax-return assistant. You are shown one uploaded document. Reply with exactly " +
  "one identifier from the list and nothing else — no punctuation, no explanation, " +
  "no code fences. If you are not confident, reply `unrecognised`. This step does " +
  "not give tax advice — it only names the kind of document.";

const CLASSIFICATION_GUIDE = `Classify this uploaded tax document. The filename is "%FILENAME%".

Reply with exactly one of these identifiers:

- ato-prefill-report — the ATO pre-fill report / pre-filling report downloaded from myGov or ATO online, listing pre-filled income (salary, interest, dividends, government payments) for one taxpayer and year
- income-statement — an employer income statement or PAYG payment summary: gross salary/wages and tax withheld for one employee
- bank-interest-notice — a bank, credit union or building society notice of interest earned/paid on an account for the year
- dividend-statement — a dividend or distribution statement from a company or share registry (unfranked/franked amounts, franking credits)
- private-health-statement — a private health insurer tax statement (premiums eligible for rebate, rebate received, days of cover)
- donation-receipt — a receipt for a gift or donation to a deductible-gift-recipient charity
- wfh-or-expense-record — a working-from-home hours log/diary, or a work-related expense record, invoice or receipt
- rental-agent-statement — a managing/real-estate agent's annual statement for a rental property: rent collected, management and letting fees, repairs, water, rates paid on the owner's behalf
- loan-interest-summary — a lender's annual interest summary or statement for a loan or mortgage (interest charged for the year)
- qs-depreciation-schedule — a quantity surveyor's tax depreciation schedule: Division 43 capital works and Division 40 plant & equipment / decline-in-value amounts by year
- unrecognised — none of the above, or you cannot tell with confidence

Answer with the identifier only.`;

function partFor(input: ClassifyDocumentInput): VisionPart {
  return {
    kind: input.mimeType === "application/pdf" ? "pdf" : "image",
    mimeType: input.mimeType,
    bytes: input.bytes,
  };
}

/**
 * Reads the identifier out of the model's reply, tolerating stray quoting,
 * backticks, trailing punctuation or a leading label. Anything not an exact
 * match for a known type falls back to `unrecognised` (PRD FR-2 — kept, not
 * extracted).
 */
export function parseDocumentType(reply: string): DocumentType {
  const words = reply
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  const hyphenated = words.replace(/\s+/g, "-");
  const collapsed = words.replace(/\s+/g, "");
  if (isDocumentType(hyphenated)) return hyphenated;

  // Longest identifier that appears in the reply wins, so "loan-interest-summary"
  // is not shadowed by a shorter partial match.
  const candidates = [...DOCUMENT_TYPES].sort((a, b) => b.length - a.length);
  for (const type of candidates) {
    if (hyphenated.includes(type) || collapsed.includes(type.replace(/-/g, ""))) {
      return type;
    }
  }
  return "unrecognised";
}

/**
 * Classifies one uploaded document into a {@link DocumentType} with a single
 * Claude vision call (PRD FR-2). Falls back to `unrecognised` on any doubt or
 * on a call failure — an unclassifiable file is still kept, just not extracted.
 */
export async function classifyDocument(
  input: ClassifyDocumentInput,
  client: ClaudeClient,
): Promise<DocumentType> {
  try {
    const reply = await client.askVision(
      [partFor(input)],
      CLASSIFICATION_GUIDE.replace("%FILENAME%", input.filename),
      { system: SYSTEM_PROMPT, maxTokens: 24 },
    );
    return parseDocumentType(reply);
  } catch {
    return "unrecognised";
  }
}
