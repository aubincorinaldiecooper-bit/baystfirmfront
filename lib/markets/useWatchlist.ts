"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseWatchlist, serializeWatchlist, toggleWatchlist, WATCHLIST_STORAGE_KEY } from "./watchlist";

export const WATCHLIST_CHANGE_EVENT = "baystfirm:watchlist";

function readStoredWatchlist(): string[] {
  try {
    return parseWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStoredWatchlist(keys: string[]): void {
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, serializeWatchlist(keys));
  } catch {}
}

export function useWatchlist() {
  const [keys, setKeys] = useState<string[]>([]);
  const keysRef = useRef<string[]>([]);

  useEffect(() => {
    const loaded = readStoredWatchlist();
    keysRef.current = loaded;
    setKeys(loaded);

    const onWatchlistChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const next = Array.isArray(detail) ? parseWatchlist(JSON.stringify(detail)) : readStoredWatchlist();
      keysRef.current = next;
      setKeys(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WATCHLIST_STORAGE_KEY && event.key !== null) return;
      const next = event.key === null ? readStoredWatchlist() : parseWatchlist(event.newValue);
      keysRef.current = next;
      setKeys(next);
    };
    window.addEventListener(WATCHLIST_CHANGE_EVENT, onWatchlistChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(WATCHLIST_CHANGE_EVENT, onWatchlistChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggle = useCallback((key: string) => {
    const next = toggleWatchlist(keysRef.current, key);
    keysRef.current = next;
    setKeys(next);
    writeStoredWatchlist(next);
    window.dispatchEvent(new CustomEvent(WATCHLIST_CHANGE_EVENT, { detail: next }));
  }, []);

  return { keys, toggle };
}
