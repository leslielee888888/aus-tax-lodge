import type { Config } from "tailwindcss";

/*
 * Design tokens are CSS variables defined in app/globals.css (light + dark).
 * This config only wires them to utilities so screens use `bg-surface`,
 * `text-muted`, `shadow-card`, `font-mono` etc. rather than raw hex.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        text: "var(--text)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        ok: "var(--ok)",
        "ok-soft": "var(--ok-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        unverified: "var(--unverified)",
        "unverified-soft": "var(--unverified-soft)",
      },
      fontFamily: {
        serif: ["var(--font-spectral)", "Georgia", "Times New Roman", "serif"],
        sans: ["var(--font-plex-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        card: "var(--radius)",
      },
      boxShadow: {
        card: "var(--shadow)",
      },
    },
  },
  plugins: [],
};

export default config;
