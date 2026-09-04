/**
 * Enforcement points for out-of-scope detection (PRD FR-20, Q12).
 *
 * {@link detectOutOfScope} decides; these turn that decision into a hard stop.
 * T13's `saveReturn` and T20's export call {@link assertInScope} so an
 * out-of-scope return can be neither persisted as progressable nor exported.
 * There is **no override** — no bypass parameter exists by design.
 */
import type { OutOfScopeFinding } from "./findings";

/** `true` when the return has at least one out-of-scope finding and must be blocked. */
export function isBlocked(findings: readonly OutOfScopeFinding[]): boolean {
  return findings.length > 0;
}

/**
 * Thrown by {@link assertInScope}. Carries every finding so the caller (and the
 * T17 hard-stop screen) can name each unsupported item.
 */
export class OutOfScopeError extends Error {
  readonly findings: readonly OutOfScopeFinding[];

  constructor(findings: readonly OutOfScopeFinding[]) {
    super(
      `This return is out of scope and cannot be saved or exported (${findings.length} item(s)): ` +
        findings.map((f) => f.item).join("; "),
    );
    this.name = "OutOfScopeError";
    this.findings = findings;
  }
}

/**
 * Throw an {@link OutOfScopeError} if `findings` is non-empty (PRD FR-20 — block
 * export, stop mid-flow). A no-op when the return is in scope.
 */
export function assertInScope(findings: readonly OutOfScopeFinding[]): void {
  if (isBlocked(findings)) {
    throw new OutOfScopeError(findings);
  }
}
