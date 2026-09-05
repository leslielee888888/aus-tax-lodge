/**
 * A generic structural walk over every {@link Provenanced} field nested
 * anywhere inside a {@link ReturnModel} (PRD FR-13 — "no unverified figures
 * left").
 *
 * A node is recognised as a `Provenanced<T>` structurally (it carries
 * `status`, `origin`, `proposedValue` and an `edits` array) rather than by
 * type, so this walker needs no per-field enumeration and stays correct as
 * the model grows. It does not recurse into a `Provenanced` field's `value`
 * (e.g. a `PostalAddress` or `BankAccount`) — those are plain data, not
 * further provenance to walk.
 *
 * This is deliberately unscoped — it visits every field regardless of whether
 * the field is relevant to this particular return (e.g. spouse details when
 * there is no spouse). That is fine for the unverified-figure check: an
 * irrelevant field is never proposed from a document, so it can never carry
 * an `unverified` document confidence. The "no unconfirmed fields" check
 * (PRD FR-13) needs to know which fields are actually *in scope* for this
 * return, so it uses the explicit enumeration in {@link import("./fields")}
 * instead of this generic walk.
 */
import type { Provenanced } from "@aus-tax-lodge/model";

function isProvenancedField(value: unknown): value is Provenanced<unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "status" in obj && "origin" in obj && "proposedValue" in obj && Array.isArray(obj.edits);
}

/**
 * Depth-first walk of `node`, calling `visit(path, field)` for every
 * {@link Provenanced} field found. `path` is a dot/bracket path matching the
 * style used elsewhere in the model (e.g. `income.salaryWages[0].grossSalaryWages`).
 */
export function walkProvenancedFields(
  node: unknown,
  path: string,
  visit: (path: string, field: Provenanced<unknown>) => void,
): void {
  if (node === null || typeof node !== "object") return;

  if (isProvenancedField(node)) {
    visit(path, node);
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, i) => walkProvenancedFields(item, `${path}[${i}]`, visit));
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    walkProvenancedFields(value, path ? `${path}.${key}` : key, visit);
  }
}
