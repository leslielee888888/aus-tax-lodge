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

| Path                  | What                                                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine`     | Deterministic tax-calculation engine — pure TypeScript, zero framework deps, with a `node` CLI harness (`bin/harness.ts`) and a hand-worked golden-set release gate.                                                                                                                                      |
| `packages/params`     | Versioned ATO tax parameters (rates, thresholds, offsets, rounding) + the individual-return label taxonomy, as data with a typed accessor. Each figure carries its ato.gov.au source URL and a verification date (FR-15). Rolling to a new income year is a config addition here — no engine change.      |
| `packages/model`      | The return data model + field-level provenance (`Provenanced<T>`: value, status, origin, proposed value, edit trail — FR-22), completeness checks, and rental-schedule assembly (FR-24).                                                                                                                  |
| `packages/config`     | Startup config/env loader and secret-redaction helpers.                                                                                                                                                                                                                                                   |
| `packages/store`      | Per-return encrypted persistence — AES-256-GCM document blobs + encrypted metadata, and the per-return `return.json` state envelope (resume, multi-return, last-write-wins revision stamp, read-only past returns) on the `DATA_DIR` volume (PRD FR-2, FR-15, FR-16, FR-17). Pure TypeScript.             |
| `packages/ai`         | Shared Claude client (`ask` / `askVision`, model `claude-sonnet-5`) and document-type classification (PRD FR-2).                                                                                                                                                                                          |
| `packages/extraction` | Claude-vision figure extraction per document type, deterministic (app-assigned) confidence, and multi-document reconciliation (FR-3, FR-21).                                                                                                                                                              |
| `packages/scope`      | Out-of-scope detection and the no-override hard stop (FR-20).                                                                                                                                                                                                                                             |
| `packages/validation` | The pre-export validation gate — TFN/BSB checksums, arithmetic consistency, plausibility checks (FR-13).                                                                                                                                                                                                  |
| `packages/export`     | The lodgement package builders — label-mapped PDF (`pdf-lib`), JSON keyed by label, validation report, source index, and the shared disclaimer text (FR-14, FR-19).                                                                                                                                       |
| `apps/web`            | Next.js (App Router) + TypeScript + Tailwind CSS front end. Warm-cream theme, component kit, passphrase gate (`middleware.ts`), first-run acknowledgement, returns list, the six wizard steps (details → documents → review → questions → estimate → export), `/settings`, and the records-archive route. |

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

To run the production image locally the way the NAS does:

```sh
cp .env.example .env    # then fill it in — see Configuration
docker compose up -d --build
# http://localhost:3000 ; docker compose logs -f ; docker compose down
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

## Deployment (Synology NAS, Docker Compose)

One container, no database. The only persistent state is the encrypted
per-return data in the `aus-tax-lodge-data` named volume. CI builds the image
on every merge to `main` and pushes it to GHCR as
`ghcr.io/leslielee888888/aus-tax-lodge` (tags: `latest` and the commit SHA);
the NAS only ever _pulls_.

**First run**

1. Put the repo tree on the NAS share (`\\Leslie_NAS\docker\aus-tax-lodge`) —
   `docker-compose.yml`, `Dockerfile`, `.env.example`. A `git archive | tar -x`
   export is enough; it is not a git clone.
2. On the NAS, `cp .env.example .env` and fill it in (see **Configuration**).
   `.env` is git-ignored and lives only on the NAS — never in the image, never
   committed.
3. `docker compose pull && docker compose up -d`. The container reports healthy
   (via `/api/health`) once Next is serving. The app is on port `3000`.

**Updating (history-preserving)**

```sh
docker compose pull        # fetch the new :latest from GHCR
docker compose up -d        # recreate the container on the new image
docker image prune -f       # optional: drop the old layers
```

In-progress returns, uploaded documents, the acknowledgement and instance
settings all live in the `aus-tax-lodge-data` volume and are untouched by an
image swap or a host reboot. No migration step — there is no database.

**Rollback**

Set `image:` in `docker-compose.yml` to a specific previous SHA tag
(`ghcr.io/leslielee888888/aus-tax-lodge:<sha>`) and `docker compose up -d`. The
data volume is forward/backward compatible within an income year (`return.json`
carries the params version it was built against; a return built against a
retired version opens read-only).

**Backup & recovery**

The `aus-tax-lodge-data` Docker volume (on the NAS, under
`/volume1/@docker/volumes/aus-tax-lodge-data/`) is the entire state — add it to
the NAS backup set (Hyper Backup / snapshots). Recovery is: restore the volume,
put back the **same `RETURN_ENCRYPTION_KEY`** in `.env` (without it the
encrypted returns and documents are unrecoverable), `docker compose up -d`. The
records-archive zips users download are their own separate retention copy.

**Secret hygiene**

- Only `.env.example` is committed. Real values live in `.env` on the NAS.
- `RETURN_ENCRYPTION_KEY` and the Claude token never appear in logs — the
  config loader redacts them; treat a leaked key as needing a re-key (which
  re-encrypts nothing automatically — see the loader docs).
- The image runs as an unprivileged user and writes only to `/data`.
- Document images sent to Claude for extraction contain PII printed on them
  (FR-17); the account used must have model training disabled.

**Backing out entirely**

`docker compose down` stops and removes the container. `docker compose down -v`
_also deletes the data volume_ — only do that to wipe everything. To keep the
data for later, `down` without `-v` and archive the volume.

## Status

Feature branch `feature/aus-tax-lodge` complete through T22 — engine + golden
set, params, the full six-step wizard, lodgement export + records archive,
disclaimers/retention/accessibility, and this Docker/CI/deploy wiring.
Remaining: the integration-test pass (T23) and the first NAS deploy (T24). See
the milestone and project board.
