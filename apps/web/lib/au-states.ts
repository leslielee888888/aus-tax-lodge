/**
 * Australian states and territories — the closed set the rental-property
 * address dropdown (T15 / FR-24) offers and its validator checks against.
 * Kept dependency-free so it is shared verbatim between the client form and
 * the server action.
 */
export const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"] as const;

export type AuState = (typeof AU_STATES)[number];

export function isAuState(value: string): value is AuState {
  return (AU_STATES as readonly string[]).includes(value);
}
