"use client";

/**
 * The watchlist: symbols the person chose to keep, stored in this browser
 * only (localStorage). Each entry is the snapshot shown when Watch was
 * clicked: the last daily close and its change as of that date. Nothing is
 * refreshed in the background and nothing is presented as a live quote.
 *
 * Every storage access is wrapped: a private window, blocked site data or a
 * full quota makes the list empty (or the save a no-op), never an error.
 */

import { useCallback, useEffect, useState } from "react";

export const WATCHLIST_KEY = "bay-watchlist-v1";
const MAX_ENTRIES = 50;

export interface WatchEntry {
  symbol: string;
  name: string;
  /** The last daily close when the entry was saved, or null when no price was shown. */
  last_close: number | null;
  change_pct: number | null;
  /** The date of that close (YYYY-MM-DD), or null. */
  as_of: string | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toEntry(value: unknown): WatchEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.symbol !== "string" || !v.symbol.trim()) return null;
  return {
    symbol: v.symbol,
    name: typeof v.name === "string" ? v.name : v.symbol,
    last_close: numberOrNull(v.last_close),
    change_pct: numberOrNull(v.change_pct),
    as_of: typeof v.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.as_of) ? v.as_of : null,
  };
}

/** The saved entries; [] when nothing is stored, the data is malformed or storage is unavailable. */
export function readWatchlist(storage: StorageLike | null = defaultStorage()): WatchEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const entries: WatchEntry[] = [];
    for (const item of parsed) {
      const entry = toEntry(item);
      if (!entry || seen.has(entry.symbol)) continue;
      seen.add(entry.symbol);
      entries.push(entry);
    }
    return entries.slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Save the entries; false when storage is unavailable or refuses the write. */
export function writeWatchlist(entries: readonly WatchEntry[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WATCHLIST_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

/** Add the entry, or remove it when its symbol is already saved. */
export function toggleEntry(entries: readonly WatchEntry[], entry: WatchEntry): WatchEntry[] {
  return entries.some((e) => e.symbol === entry.symbol)
    ? entries.filter((e) => e.symbol !== entry.symbol)
    : [entry, ...entries].slice(0, MAX_ENTRIES);
}

export interface UseWatchlist {
  entries: WatchEntry[];
  isWatched: (symbol: string) => boolean;
  toggle: (entry: WatchEntry) => void;
}

/** The watchlist, read after mount (so server and first client render agree). */
export function useWatchlist(): UseWatchlist {
  const [entries, setEntries] = useState<WatchEntry[]>([]);

  useEffect(() => {
    setEntries(readWatchlist());
  }, []);

  const toggle = useCallback((entry: WatchEntry) => {
    setEntries((current) => {
      const next = toggleEntry(current, entry);
      writeWatchlist(next);
      return next;
    });
  }, []);

  const isWatched = useCallback((symbol: string) => entries.some((e) => e.symbol === symbol), [entries]);

  return { entries, isWatched, toggle };
}
