"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root. */

import { useEffect } from "react";

/* React 19 reconciles <html>'s className during hydration, wiping the class
 * the pre-paint head script set. This re-applies the stored theme the moment
 * hydration finishes, on every page. */
export function ThemeSync() {
  useEffect(() => {
    try {
      const theme = localStorage.getItem("bui-theme");
      document.documentElement.classList.toggle("dark", theme !== "light");
    } catch {
      document.documentElement.classList.add("dark");
    }
  }, []);

  return null;
}
