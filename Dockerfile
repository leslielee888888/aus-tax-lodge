# Australian Individual Tax Return Assistant — production image.
#
# One self-contained Next.js server (PRD FR-16). No database; the only writable
# state is the encrypted per-return data on the mounted volume at $DATA_DIR.
#
# Built and pushed to GHCR by CI (`.github/workflows/release.yml`); the NAS runs
# `docker compose pull && up -d` against that image. Kept BuildKit-free so
# Synology Container Manager's classic builder can also build it if needed — no
# `# syntax=`, no `COPY --chmod`, no `RUN --mount`.

# ---- deps: install every workspace's dependencies from the lockfile ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Copy just the manifests first so this layer caches across source-only changes.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/export/package.json packages/export/package.json
COPY packages/extraction/package.json packages/extraction/package.json
COPY packages/model/package.json packages/model/package.json
COPY packages/params/package.json packages/params/package.json
COPY packages/scope/package.json packages/scope/package.json
COPY packages/store/package.json packages/store/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN npm ci

# ---- build: compile the standalone server -----------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
# npm nests `@anthropic-ai/claude-agent-sdk` (T16) under packages/ai/node_modules
# rather than hoisting it to the root — its peer dependency on `@anthropic-ai/sdk`
# needs a newer version than apps/web's own `@anthropic-ai/sdk` pin, so npm keeps
# a second, package-local copy. `.dockerignore` excludes all `node_modules` from
# the build context, so `COPY . .` below does not bring this nested copy along —
# without this line, `next build` fails outright with "Module not found:
# Can't resolve '@anthropic-ai/claude-agent-sdk'" (confirmed with a real
# `docker build` while verifying this task).
COPY --from=deps /app/packages/ai/node_modules ./packages/ai/node_modules
COPY . .
RUN npm run build -w @aus-tax-lodge/web

# ---- runner: only the standalone output + static assets ---------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Where the encrypted returns/documents live — the compose volume mounts here.
ENV DATA_DIR=/data

# Run as an unprivileged user; it must own the data dir it writes to.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /data \
  && chown -R nextjs:nodejs /data

# `output: "standalone"` emits a pruned server + node_modules under
# apps/web/.next/standalone (monorepo layout preserved via outputFileTracingRoot).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# `@anthropic-ai/claude-agent-sdk` (T16) is NOT in the standalone copy above —
# confirmed by inspecting a real build. Next's file tracer only follows static
# imports; this package resolves its own on-disk location at *runtime* via
# `createRequire(import.meta.url)` (it needs to find its sibling manifest.json
# and load the right platform-specific CLI binary), which the tracer cannot
# see. Worse, letting webpack bundle it inline (rather than keeping it a real
# external `require`) bakes the *build container's* absolute path into the
# compiled server chunk — verified in the `build` stage of this very image:
# every reference resolves to the literal string
# `file:///app/packages/ai/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`.
# Because both this stage and the `build` stage use `WORKDIR /app` with the
# same repo-relative layout, recreating that exact path here is sufficient —
# no code change needed, just make the file genuinely exist where the compiled
# code expects it.
#
# Two pieces, both required:
#  - the wrapper package itself (small; nested under packages/ai/node_modules
#    because its `@anthropic-ai/sdk` peer dependency needs a newer version than
#    apps/web's own pin — see the `build` stage comment above);
#  - the actual Claude Code CLI binary, shipped as a separate ~200MB
#    optionalDependency package selected by platform/arch at install time.
#    `node:20-bookworm-slim` is glibc/linux-x64, so only that one variant is
#    needed here (the build stage's `npm ci` also installs the musl variant,
#    which this image does not use and does not copy). This is single-arch —
#    `.github/workflows/release.yml` builds on `ubuntu-latest` with no
#    `platforms:` override, i.e. linux/amd64 only; an arm64 or musl build of
#    this image would need `claude-agent-sdk-linux-arm64` /
#    `-linux-x64-musl` copied here instead.
COPY --from=build /app/packages/ai/node_modules/@anthropic-ai/claude-agent-sdk ./packages/ai/node_modules/@anthropic-ai/claude-agent-sdk
COPY --from=build /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64 ./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
