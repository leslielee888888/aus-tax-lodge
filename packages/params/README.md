# @aus-tax-lodge/params

Versioned Australian individual-tax parameters (PRD FR-15) and the ATO
individual-return label taxonomy (PRD §8), as **plain data with a typed
accessor**. Zero framework dependencies. `@aus-tax-lodge/engine` depends on this
package; this package depends on nothing in the repo.

> The maths lives in `@aus-tax-lodge/engine` (T3–T5). This package never
> calculates — it only holds the year's rates, thresholds, offsets, rounding
> rules and label names, each with its ato.gov.au source URL and a verification
> date.

## Layout

| Path                | What                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`      | The typed schema for a parameter set + the label taxonomy.                                                                                                                                                 |
| `src/validate.ts`   | Hand-written runtime validator (`validateDataset`, `assertValidDataset`) — catches missing figures, mis-ordered brackets, non-contiguous bands, a non-ato source, rebate periods that don't span the year. |
| `src/registry.ts`   | `TARGET_YEAR`, `PARAMS_VERSION`, `DATASETS`, and the accessors `getParams()` / `getTaxonomy()` / `getDataset()`.                                                                                           |
| `src/2025-26/`      | The curated 2025-26 dataset: `params.ts` (numbers) + `taxonomy.ts` (labels).                                                                                                                               |
| `VERIFY-2025-26.md` | Human-verification checklist — **the figures are AI-researched and not trusted until Leslie ticks every row** against ato.gov.au and the ATO income tax estimator.                                         |

## Usage

```ts
import { getParams, getTaxonomy, TARGET_YEAR, PARAMS_VERSION } from "@aus-tax-lodge/params";

const params = getParams(); // defaults to TARGET_YEAR ("2025-26")
params.residentRates.value; // TaxBracket[]
params.residentRates.source; // the ato.gov.au URL it came from
params.residentRates.verifiedOn; // "2026-09-04"

getTaxonomy().rentalSchedule; // item 21 income + deduction sub-labels
getTaxonomy().myTaxSectionOrder; // drives the T20 export layout

// Shown in the UI and printed on the export package (FR-15):
`${TARGET_YEAR} · config ${PARAMS_VERSION}`;
```

Every figure group is a `Sourced<T>` — `{ value, source, verifiedOn, unverified?, note? }`.
A group whose value could not be confirmed from a year-stamped ato.gov.au page
carries `unverified: true` and is listed by `validateDataset(...).unverified`.

## Adding a future income year — no engine change

Rolling the tool forward each July (PRD FR-15) is a **config-only** change:

1. `cp -r src/2025-26 src/2026-27` and update every figure + `meta` in
   `params.ts` and `taxonomy.ts` from ato.gov.au. Record the `source` URL and
   today's date as `verifiedOn` for each group.
2. Register it in `src/registry.ts`:
   ```ts
   import { dataset202627 } from "./2026-27";
   export const TARGET_YEAR = "2026-27";
   export const DATASETS = { "2025-26": dataset202526, "2026-27": dataset202627 };
   ```
   (Keep prior years in `DATASETS` so past returns stay viewable — FR-16.)
3. Write `VERIFY-2026-27.md` from the previous year's template and have a human
   tick it against ato.gov.au + the ATO estimator.
4. `npm -w @aus-tax-lodge/params test` — the validator and the taxonomy tests
   run against the new dataset. Then the engine's golden set (T5) is re-run as
   the release gate.

The engine reads `getParams(year)` / `getTaxonomy(year)` — it has no rate,
threshold or label baked in, so a new year needs no engine code change.

## Scripts

```sh
npm -w @aus-tax-lodge/params run typecheck
npm -w @aus-tax-lodge/params test
npm -w @aus-tax-lodge/params run lint
```
