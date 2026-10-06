"use client";

import { useCallback, useEffect, useState } from "react";

export type ViewMode = "simple" | "details";

const STORAGE_KEY = "bayanalytics.viewMode";

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("simple");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "simple" || stored === "details") setMode(stored);
    } catch {
      setMode("simple");
    }
  }, []);

  const updateMode = useCallback((next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      setMode(next);
    }
  }, []);

  return [mode, updateMode];
}
