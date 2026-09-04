import type { Config } from "tailwindcss";

// Minimal scaffold config. The design-system tokens (light + dark, matching the
// mockup canvas) land with the UI tasks (T14+).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
