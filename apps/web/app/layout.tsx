import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DisclaimerBanner } from "../components/DisclaimerBanner";
import { plexMono, plexSans, spectral } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Australian Individual Tax Return Assistant",
  description:
    "Self-hosted assistant for preparing your own Australian individual tax return. Not tax advice.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1713" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spectral.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <DisclaimerBanner />
        {children}
      </body>
    </html>
  );
}
