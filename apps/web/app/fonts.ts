import { IBM_Plex_Mono, IBM_Plex_Sans, Spectral } from "next/font/google";

/**
 * The three faces from the design canvas, loaded and self-hosted by Next at
 * build time (no runtime request to Google). Each exposes a CSS variable that
 * `tailwind.config.ts` maps to a font family:
 *
 *   --font-spectral    Spectral        serif headings
 *   --font-plex-sans   IBM Plex Sans   body / UI
 *   --font-plex-mono   IBM Plex Mono   dollar amounts, TFN/BSB, tabular numbers
 */
export const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-spectral",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});
