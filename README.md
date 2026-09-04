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

| Path              | What                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/engine` | Deterministic tax-calculation engine — pure TypeScript, zero framework deps, with a `node` CLI harness (`bin/harness.ts`). Real logic lands in T3–T5.                                                                                                                                                                    |
| `packages/params` | Versioned ATO tax parameters (rates, thresholds, offsets, rounding) + the individual-return label taxonomy, as data with a typed accessor. Each figure carries its ato.gov.au source URL and a verification date (FR-15). Rolling to a new income year is a config addition here — no engine change.                     |
| `packages/config` | Startup config/env loader and secret-redaction helpers.                                                                                                                                                                                                                                                                  |
| `packages/store`  | Per-return encrypted persistence — AES-256-GCM document blobs + encrypted metadata, and the per-return `return.json` state envelope (resume, multi-return, last-write-wins revision stamp, read-only past returns) on the `DATA_DIR` volume (PRD FR-2, FR-15, FR-16, FR-17). Pure TypeScript.                            |
| `packages/ai`     | Shared Claude client (`ask` / `askVision`, model `claude-sonnet-5`) and document-type classification (PRD FR-2). Figure extraction builds on it (T11).                                                                                                                                                                   |
| `apps/web`        | Next.js (App Router) + TypeScript + Tailwind CSS front end. App shell (warm-cream theme, fonts, component kit), passphrase gate (`middleware.ts`), first-run acknowledgement and the returns list land in T14; the six wizard steps in T15–T20. Document upload route handler at `app/api/returns/[returnId]/documents`. |

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
- `APP_PASSPHRASE` — the shared passphrase that unlocks the app (PRD FR-17). One
  field, no user accounts. It is an **access gate only** and is independent of
  `RETURN_ENCRYPTION_KEY`. **Forgotten passphrase:** change `APP_PASSPHRASE` in
  `.env` (on the NAS, the compose `env_file`) and restart the container — the
  encrypted returns and documents are untouched, and existing browser sessions
  are invalidated. The unlock screen is at `/unlock`; every other route redirects
  there until the session cookie is set.
- `DATA_DIR` — directory holding the encrypted per-return data (`<DATA_DIR>/returns/<returnId>/…`).
  Optional; resolved to an absolute path; defaults to `./data`. In the container it is the volume mount.
  The one-time acknowledgement (PRD FR-19) is stored here as `acknowledgement.json`.
- **Exactly one** Claude credential — `CLAUDE_CODE_OAUTH_TOKEN` (a Claude
  subscription, via `claude setup-token`; the intended path) **or**
  `ANTHROPIC_API_KEY` (pay-as-you-go). Setting both fails startup; a blank
  `ANTHROPIC_API_KEY` is cleared so it can't shadow the OAuth token.

The loader (`@aus-tax-lodge/config`) validates these at startup and, on anything
missing or malformed, exits with a one-line message naming the problem. It never
logs a secret value; use its `redact()` / `describeConfig()` helpers for anything
that prints configuration.

## Status

App shell + unlock gate + returns list in place (T14). See the milestone and project board.
