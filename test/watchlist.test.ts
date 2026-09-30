/**
 * The watchlist's browser storage: round trip, toggling, malformed data, and
 * a storage that throws (private windows, blocked site data, full quota).
 */
import { describe, expect, it } from "vitest";
import { WATCHLIST_KEY, readWatchlist, toggleEntry, writeWatchlist, type WatchEntry } from "@/lib/market/watchlist";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const entry = (symbol: string, extra: Partial<WatchEntry> = {}): WatchEntry => ({
  symbol,
  name: `${symbol} Inc.`,
  last_close: null,
  change_pct: null,
  as_of: null,
  ...extra,
});

describe("watchlist storage", () => {
  it("round-trips the saved snapshot", () => {
    const storage = memoryStorage();
    const saved = [entry("EXHL", { last_close: 12.5, change_pct: -1.2, as_of: "2026-09-25" }), entry("EXMP")];
    expect(writeWatchlist(saved, storage)).toBe(true);
    expect(readWatchlist(storage)).toEqual(saved);
    expect(JSON.parse(storage.data.get(WATCHLIST_KEY)!)).toEqual(saved);
  });

  it("toggles an entry by symbol, newest first", () => {
    const one = toggleEntry([], entry("EXHL"));
    const two = toggleEntry(one, entry("EXMP"));
    expect(two.map((e) => e.symbol)).toEqual(["EXMP", "EXHL"]);
    expect(toggleEntry(two, entry("EXHL")).map((e) => e.symbol)).toEqual(["EXMP"]);
  });

  it("returns [] for missing or malformed data, and drops invalid entries", () => {
    expect(readWatchlist(memoryStorage())).toEqual([]);
    expect(readWatchlist(memoryStorage({ [WATCHLIST_KEY]: "{not json" }))).toEqual([]);
    expect(readWatchlist(memoryStorage({ [WATCHLIST_KEY]: JSON.stringify({ symbol: "X" }) }))).toEqual([]);
    const mixed = [{ symbol: "EXHL", name: "Example", last_close: "12", change_pct: 1, as_of: "yesterday" }, { name: "no symbol" }, { symbol: "EXHL" }, 7];
    expect(readWatchlist(memoryStorage({ [WATCHLIST_KEY]: JSON.stringify(mixed) }))).toEqual([
      { symbol: "EXHL", name: "Example", last_close: null, change_pct: 1, as_of: null },
    ]);
  });

  it("never throws when the storage throws or is unavailable", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readWatchlist(throwing)).toEqual([]);
    expect(writeWatchlist([entry("EXHL")], throwing)).toBe(false);
    expect(readWatchlist(null)).toEqual([]);
    expect(writeWatchlist([entry("EXHL")], null)).toBe(false);
  });

  it("uses window.localStorage by default and survives an accessor that throws", () => {
    /* the node test environment has no window: the default storage is unavailable */
    expect(readWatchlist()).toEqual([]);
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.defineProperty({}, "localStorage", {
        get() {
          throw new Error("SecurityError");
        },
      }),
    });
    try {
      expect(readWatchlist()).toEqual([]);
      expect(writeWatchlist([entry("EXHL")])).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else delete (globalThis as { window?: unknown }).window;
    }
  });
});
