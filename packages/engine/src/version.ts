/**
 * Version of the calculation engine's public surface. Bumped when the engine
 * changes shape — separate from the versioned tax-parameter config (PRD FR-15),
 * which is rolled forward each income year without an engine change.
 *
 * 0.1.0 — T3: core calc (assessable income → deductions → taxable income →
 * resident income tax).
 * 0.2.0 — T4: full assessment (`assess`) — Medicare levy + surcharge, LITO,
 * beneficiary offset, PHI rebate reconciliation, study-loan repayment, franking
 * + PAYG credits, the FR-23 income tests, and the final refund / amount owing.
 */
export const ENGINE_VERSION = "0.2.0";
