"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const RECENT_SEARCHES_KEY = "baystfirm.recent-searches.v1";
export const MAX_RECENT_SEARCHES = 30;
const RECENT_SEARCHES_CHANGE_EVENT = "baystfirm:recent-searches";

export interface RecentSearch {
  kind: "crypto" | "token" | "stock";
  id: string;
  label: string;
  detail?: string;
  at: string;
}

function asRecent(value: unknown): RecentSearch | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    (item.kind !== "crypto" && item.kind !== "token" && item.kind !== "stock") ||
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.label !== "string" ||
    !item.label ||
    typeof item.at !== "string" ||
    !Number.isFinite(Date.parse(item.at))
  ) {
    return null;
  }
  return {
    kind: item.kind,
    id: item.id,
    label: item.label,
    ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
    at: item.at,
  };
}

export function parseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(asRecent).filter((item): item is RecentSearch => item !== null).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function recordRecentSearch(items: readonly RecentSearch[], item: RecentSearch): RecentSearch[] {
  return [item, ...items.filter((current) => !(current.kind === item.kind && current.id === item.id))].slice(0, MAX_RECENT_SEARCHES);
}

export function sortedRecents(items: readonly RecentSearch[]): RecentSearch[] {
  return [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function recentStockTickers(items: readonly RecentSearch[]): string[] {
  const tickers = new Set<string>();
  for (const item of sortedRecents(items)) {
    if (item.kind !== "stock") continue;
    const ticker = item.label.trim().toUpperCase();
    if (/^[A-Z0-9.-]{1,10}$/.test(ticker)) tickers.add(ticker);
    if (tickers.size === 5) break;
  }
  return [...tickers];
}

function readStoredRecents(): RecentSearch[] {
  try {
    return parseRecentSearches(window.localStorage.getItem(RECENT_SEARCHES_KEY));
  } catch {
    return [];
  }
}

function writeStoredRecents(items: readonly RecentSearch[]): void {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, MAX_RECENT_SEARCHES)));
  } catch {
    return;
  }
}

export function useRecentSearches(enabled = true) {
  const [items, setItems] = useState<RecentSearch[]>([]);
  const itemsRef = useRef(items);

  useEffect(() => {
    if (!enabled) {
      itemsRef.current = [];
      setItems([]);
      return;
    }
    const loaded = readStoredRecents();
    itemsRef.current = loaded;
    setItems(loaded);
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const next = Array.isArray(detail) ? parseRecentSearches(JSON.stringify(detail)) : readStoredRecents();
      itemsRef.current = next;
      setItems(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === RECENT_SEARCHES_KEY || event.key === null) {
        const next = readStoredRecents();
        itemsRef.current = next;
        setItems(next);
      }
    };
    window.addEventListener(RECENT_SEARCHES_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RECENT_SEARCHES_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled]);

  const record = useCallback(
    (item: Omit<RecentSearch, "at"> & { at?: string }) => {
      if (!enabled) return;
      const next = recordRecentSearch(sortedRecents(itemsRef.current), { ...item, at: item.at ?? new Date().toISOString() });
      itemsRef.current = next;
      setItems(next);
      writeStoredRecents(next);
      window.dispatchEvent(new CustomEvent(RECENT_SEARCHES_CHANGE_EVENT, { detail: next }));
    },
    [enabled],
  );

  return { items: enabled ? sortedRecents(items) : [], record };
}
