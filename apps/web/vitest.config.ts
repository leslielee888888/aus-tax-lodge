import { defineConfig } from "vitest/config";

export default defineConfig({
  // esbuild needs to be told to transform JSX (tsconfig has jsx: "preserve" for Next).
  esbuild: { jsx: "automatic" },
  test: {
    // Node by default; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
