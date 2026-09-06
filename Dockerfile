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

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
