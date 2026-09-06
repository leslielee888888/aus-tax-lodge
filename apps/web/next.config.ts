import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
