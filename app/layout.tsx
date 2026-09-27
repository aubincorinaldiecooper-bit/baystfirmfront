/* Font setup and theme boot adapted from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root. */
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeSync } from "@/components/site/ThemeSync";

/* Font setup and theme boot are carried over from Beautiful UI (MIT, see
 * LICENSE-THIRD-PARTY): Inter for UI text, JetBrains Mono for numbers and
 * technical detail, and a pre-paint script that applies the stored theme so
 * the page never flashes the wrong mode. */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
});

export const metadata: Metadata = {
  title: "BayAnalytics",
  description: "Sourced, multi-horizon assessments of public companies, built from public information.",
};

const themeScript = `(function(){try{var t=localStorage.getItem("bui-theme");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){document.documentElement.classList.add("dark")}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} font-sans`}>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
