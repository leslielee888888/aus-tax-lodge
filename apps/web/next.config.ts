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
  serverExternalPackages: ["archiver", "archiver-zip-encrypted"],
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
