import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship raw TypeScript; Next must transpile them.
  transpilePackages: [
    "@aus-tax-lodge/ai",
    "@aus-tax-lodge/config",
    "@aus-tax-lodge/engine",
    "@aus-tax-lodge/params",
    "@aus-tax-lodge/store",
  ],
};

export default nextConfig;
