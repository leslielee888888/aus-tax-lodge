/**
 * Version of the calculation engine's public surface. Bumped when the engine
 * changes shape — separate from the versioned tax-parameter config (PRD FR-15),
 * which is rolled forward each income year without an engine change.
 *
 * 0.1.0 — T3: core calc (assessable income → deductions → taxable income →
 * resident income tax). T4 extends the result with levies, offsets and credits.
 */
export const ENGINE_VERSION = "0.1.0";
