/**
 * The Claude content-level scope check (PRD FR-20, Q12).
 *
 * The recognised document types are trusted, but a `dividend-statement` can turn
 * out to be a managed-fund / trust distribution and an `unrecognised` file can
 * be anything. This runs one tight Claude vision call over such a document and
 * reports which out-of-scope categories it likely contains. It is deliberately
 * conservative — a false stop is safer than a silently wrong return (Q12).
 *
 * This module makes the only network call in `@aus-tax-lodge/scope`. It takes an
 * injected client ({@link ScopeVisionClient}) — structurally the `ClaudeClient`
 * from `@aus-tax-lodge/ai` — so the package keeps a single dependency and the
 * suite never touches the network. The pure detector
 * ({@link import("./detect").detectOutOfScope}) consumes the results.
 */
import type { DocumentContentClassification } from "./detect";
import {
  isScopeContentCategory,
  SCOPE_CONTENT_CATEGORIES,
  type ScopeContentCategory,
} from "./findings";

/** A document part for a multimodal call — matches `@aus-tax-lodge/ai`'s `VisionPart`. */
export interface ScopeVisionPart {
  readonly kind: "image" | "pdf";
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/** The slice of `@aus-tax-lodge/ai`'s `ClaudeClient` this check needs. */
export interface ScopeVisionClient {
  askVision(
    parts: readonly ScopeVisionPart[],
    prompt: string,
    options?: { readonly system?: string; readonly maxTokens?: number },
  ): Promise<string>;
}

export const SCOPE_CONTENT_CHECK_SYSTEM_PROMPT =
  "You are a scope-gate check inside an Australian individual tax-return assistant. " +
  "The assistant only handles a simple resident return: salary and wages, bank interest, " +
  "Australian franked/unfranked dividends, taxable government allowances, standard " +
  "work-related deductions, and ONE solely-owned long-term residential rental property. " +
  "You are shown exactly one uploaded document. Decide only whether it evidences something " +
  "OUTSIDE that scope. Reply with a JSON array and nothing else.";

export const SCOPE_CONTENT_CHECK_PROMPT = `Does this document contain, report or evidence ANY of the following? Each one is OUT OF SCOPE and must stop the return:

- capital-gains — a capital gains tax event: a contract of sale or settlement statement for property or shares, a share SALE or disposal (not merely a dividend or a holding balance), a crypto disposal, a managed-fund or broker CGT summary.
- business-income — sole-trader, business or personal-services income: an ABN income summary, a business or PSI schedule, business activity statements, an invoice/sales book.
- foreign-income — foreign employment, pension, interest, dividend or rental income; foreign tax paid or a foreign income tax offset; an overseas payslip or bank statement.
- trust-partnership-managed-fund-distribution — an annual tax statement or distribution advice from a trust, partnership, managed fund, managed investment trust, ETF or stapled security: net distribution, franked/unfranked distribution, foreign income, capital gains components, or AMIT / attribution amounts.
- employee-share-scheme — an employee share scheme (ESS) statement: a discount on shares or rights, an ESS deferred taxing point, an ESS statement summary.
- etp-or-redundancy — an employment termination payment (ETP) summary or schedule, or a genuine redundancy payment summary.
- super-income-stream — a superannuation income stream or pension payment summary, an annuity statement, or a superannuation lump-sum payment summary.

Be conservative: if the document LIKELY falls into one of these categories, flag it — a false stop is safer than a wrong return. Documents that ARE in scope and must NOT be flagged: a plain company dividend statement, a bank interest notice, an employer income statement / PAYG payment summary, a private health insurance tax statement, a donation receipt, a rental managing-agent annual statement, a loan interest summary, and a quantity surveyor's depreciation schedule.

Reply with ONLY a JSON array of the matching category ids above, lowercase and exactly as written (e.g. ["trust-partnership-managed-fund-distribution"]). Reply with [] if none apply. No other text.`;

/**
 * Read the flagged categories out of the model's reply. Tolerates a leading
 * label, stray prose around the array, single quotes, and underscores or spaces
 * instead of hyphens. Unknown tokens are dropped; the result is de-duplicated.
 */
export function parseScopeContentReply(reply: string): ScopeContentCategory[] {
  const found = new Set<ScopeContentCategory>();
  const arrayText = reply.match(/\[[\s\S]*?\]/)?.[0];

  if (arrayText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(arrayText);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === "string") {
            const id = entry
              .trim()
              .toLowerCase()
              .replace(/[_\s]+/g, "-");
            if (isScopeContentCategory(id)) found.add(id);
          }
        }
      }
    } catch {
      // Fall through to the token scan below.
    }
  }

  const haystack = (arrayText ?? reply).toLowerCase();
  for (const category of SCOPE_CONTENT_CATEGORIES) {
    const pattern = new RegExp(`\\b${category.replace(/-/g, "[-_ ]?")}\\b`, "i");
    if (pattern.test(haystack)) found.add(category);
  }

  return [...found];
}

export interface ScopeContentCheckInput {
  readonly docId: string;
  readonly filename: string;
  readonly parts: readonly ScopeVisionPart[];
}

/**
 * Run the content check over one document (PRD FR-20). Throws if the Claude call
 * fails — T11 must surface that and not let the return proceed as if the
 * document were clean.
 */
export async function checkDocumentForOutOfScopeContent(
  input: ScopeContentCheckInput,
  client: ScopeVisionClient,
): Promise<DocumentContentClassification> {
  const reply = await client.askVision(input.parts, SCOPE_CONTENT_CHECK_PROMPT, {
    system: SCOPE_CONTENT_CHECK_SYSTEM_PROMPT,
    maxTokens: 200,
  });
  return {
    docId: input.docId,
    filename: input.filename,
    categories: parseScopeContentReply(reply),
  };
}
