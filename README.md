# Australian Individual Tax Return Assistant

Self-hosted tool that helps an individual Australian resident prepare **their own**
income tax return for the current income year (2025–26), from their own documents,
and produces a lodgement-ready package to key into ATO myTax. It does **not**
connect to the ATO. It is not tax advice.

- **PRD:** [`docs/prd/aus-tax-lodge.md`](https://github.com/leslielee888888/ai-docs/blob/main/docs/prd/aus-tax-lodge.md) in the `ai-docs` repo
- **Explainer:** https://claude.ai/code/artifact/bfdeadc3-956b-41d3-b509-c1c3854b8ca9
- **Mockups:** https://claude.ai/code/artifact/f81573c9-2d16-4d4e-a9ee-de85824ff27e
- **Tasks:** [milestone](https://github.com/leslielee888888/aus-tax-lodge/milestone/1) ·
  [project](https://github.com/users/leslielee888888/projects/3)

## Scope (this iteration)

Salary & wages, bank interest, dividends, taxable working-age allowances, standard
work-related deductions, Medicare levy and surcharge, HELP repayment, the
private-health rebate, and **one solely-owned long-term residential rental**.
Anything outside that — co-owned or short-stay rental, capital gains, business,
foreign income, prior years — hard-stops and points the user to a registered tax
agent or myTax.

## Repository layout

npm workspaces, Node 20 LTS (`.nvmrc`).

| Path              | What                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` | Deterministic tax-calculation engine — pure TypeScript, zero framework deps, with a `node` CLI harness (`bin/harness.ts`). Real logic lands in T3–T5.                                                                                                                                                |
| `packages/params` | Versioned ATO tax parameters (rates, thresholds, offsets, rounding) + the individual-return label taxonomy, as data with a typed accessor. Each figure carries its ato.gov.au source URL and a verification date (FR-15). Rolling to a new income year is a config addition here — no engine change. |
| `packages/config` | Startup config/env loader and secret-redaction helpers.                                                                                                                                                                                                                                              |
| `apps/web`        | Next.js (App Router) + TypeScript + Tailwind CSS front end. Screens land in T14+.                                                                                                                                                                                                                    |

## Local development

```sh
nvm use            # Node 20
npm install
npm run typecheck  # tsc --noEmit across every workspace
npm run lint       # eslint (packages) + next lint (web)
npm test           # vitest across every workspace
npm run build      # next build (+ workspace builds)
npm run harness    # run the engine CLI harness
```

## Configuration

Copy `.env.example` to `.env` (git-ignored — never commit it) and set:

- `RETURN_ENCRYPTION_KEY` — AES-256 key (32 bytes, hex or base64) that encrypts
  `return.json` and uploaded documents at rest. Generate with `openssl rand -hex 32`.
  Losing it makes existing returns unrecoverable.
- **Exactly one** Claude credential — `CLAUDE_CODE_OAUTH_TOKEN` (a Claude
  subscription, via `claude setup-token`; the intended path) **or**
  `ANTHROPIC_API_KEY` (pay-as-you-go). Setting both fails startup; a blank
  `ANTHROPIC_API_KEY` is cleared so it can't shadow the OAuth token.

The loader (`@aus-tax-lodge/config`) validates these at startup and, on anything
missing or malformed, exits with a one-line message naming the problem. It never
logs a secret value; use its `redact()` / `describeConfig()` helpers for anything
that prints configuration.

## Status

Scaffold in place (T1). 2025-26 tax-parameter config + ATO label taxonomy in
place (T2) — **figures AI-researched and pending human verification**, see
[`packages/params/VERIFY-2025-26.md`](packages/params/VERIFY-2025-26.md). See the
milestone and project board.
