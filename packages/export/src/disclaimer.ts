/**
 * The canonical FR-19 disclaimer language. Every place the disclaimer appears —
 * the persistent in-app banner, the first-run acknowledgement screen, the PDF
 * cover page, and the JSON export `meta` — draws its wording from here so the
 * copies can never drift apart.
 *
 * This module is plain strings with zero imports, so it is safe to pull into a
 * React Server Component, a Client Component, or a pure Node builder alike.
 */

/**
 * The four FR-19 sentences, in full. Used verbatim on the PDF cover page and,
 * joined, in the JSON export `meta.disclaimer`.
 */
export const DISCLAIMER_SENTENCES: readonly string[] = [
  "This is a self-preparation aid, not tax advice — it is not prepared or checked by a registered tax agent.",
  "Every figure here was prepared by you from your own documents; the assistant only extracts, proposes and explains figures.",
  "The refund or amount owing shown is an estimate, not the ATO's assessment — you are responsible for what you lodge.",
  "This tool does not connect to the ATO. Nothing here is transmitted to the ATO; you lodge it yourself in myTax.",
];

/** One-paragraph form — PDF cover page intro line and JSON `meta.disclaimer`. */
export const DISCLAIMER_PARAGRAPH = DISCLAIMER_SENTENCES.join(" ");

/** The short points shown in the persistent in-app banner (FR-19). */
export const DISCLAIMER_BANNER_POINTS: readonly string[] = [
  "Not a registered tax agent",
  "Estimates only, not the ATO's assessment",
  "You're responsible for what you lodge",
];

/** The exact statement the one-time first-run acknowledgement records agreement to (FR-19). */
export const ACKNOWLEDGEMENT_STATEMENT =
  "I understand this is not tax advice and I am responsible for what I lodge.";

/** "What this assistant does" — three bullets for the acknowledge screen (FR-19). */
export const ASSISTANT_DOES: readonly string[] = [
  "Reads your uploaded documents and proposes a figure for each return label, with its source",
  "Flags anything it can't verify against your documents, and never confirms a figure for you",
  "Estimates your refund or amount owing with a plain-English, line-by-line breakdown",
];

/** "What this assistant does not do" — three bullets for the acknowledge screen (FR-19). */
export const ASSISTANT_DOES_NOT: readonly string[] = [
  "Give tax advice, recommend how to arrange your affairs, or tell you what to claim",
  "Invent deductions, or add any figure that isn't in one of your documents",
  "Lodge anything, or connect to the ATO or myGov in any way",
];
