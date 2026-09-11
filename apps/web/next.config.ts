import { join } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (T22): `next build`
  // emits `.next/standalone` with only the files the server actually needs.
  // The monorepo root is two levels up — Next must trace workspace-package
  // deps (`@aus-tax-lodge/*`, symlinked into `node_modules`) from there, not
  // just from `apps/web`. `__dirname` is provided by the config loader.
  output: "standalone",
  outputFileTracingRoot: join(__dirname, "../../"),
  // `archiver` (records-archive zip, T20) does dynamic `require`s and pulls in
  // Node built-ins — keep it external to the server bundle rather than letting
  // the bundler trace it.
  //
  // `@anthropic-ai/claude-agent-sdk` (T16) is listed here too, but — confirmed
  // during this task's Docker verification — this alone does NOT keep it out
  // of the bundle: it's reached only via `@aus-tax-lodge/ai`, which is itself
  // in `transpilePackages` below, and webpack still inlines a
  // `serverExternalPackages` entry's own dependency graph when the requesting
  // module is one it's transpiling. Left in as the documented, correct-intent
  // declaration (and in case a future Next version honours it here), but the
  // actual fix has two other parts: `packages/ai/src/client.ts` loads the SDK
  // with a dynamic `await import(...)` (still gets inlined, but at least this
  // is the pattern most likely to stop being inlined as Next's bundler
  // evolves), and the repo-root `Dockerfile`'s `runner` stage explicitly
  // copies the SDK's files (including the platform-specific CLI binary) to
  // the exact path the compiled bundle hardcodes at build time. See the
  // comments in both those files for the full story.
  serverExternalPackages: ["archiver", "archiver-zip-encrypted", "@anthropic-ai/claude-agent-sdk"],
  // The workspace packages ship raw TypeScript; Next must transpile them.
  transpilePackages: [
    "@aus-tax-lodge/ai",
    "@aus-tax-lodge/config",
    "@aus-tax-lodge/engine",
    "@aus-tax-lodge/export",
    "@aus-tax-lodge/extraction",
    "@aus-tax-lodge/model",
    "@aus-tax-lodge/params",
    "@aus-tax-lodge/store",
    "@aus-tax-lodge/validation",
  ],
};

export default nextConfig;
