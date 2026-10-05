import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  parseRecentSearches,
  recentStockTickers,
  recordRecentSearch,
  sortedRecents,
  type RecentSearch,
} from "@/lib/search/recents";

describe("browser recent searches", () => {
  it("uses the namespaced storage key and caps the newest entries at thirty", () => {
    const items: RecentSearch[] = Array.from({ length: 35 }, (_, index) => ({
      kind: "crypto",
      id: `crypto:${index}`,
      label: `Asset ${index}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    expect(RECENT_SEARCHES_KEY).toBe("baystfirm.recent-searches.v1");
    expect(parseRecentSearches(JSON.stringify(items))).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it("validates saved entries and sorts them newest first", () => {
    const entries = parseRecentSearches(
      JSON.stringify([
        { kind: "token", id: "token:mint", label: "Token", at: "2026-01-01T00:00:00Z" },
        { kind: "stock", id: "stock:AAPL", label: "AAPL", at: "2026-01-01T12:00:00Z" },
        { kind: "other", id: "x", label: "Invalid", at: "2026-01-02T00:00:00Z" },
        { kind: "crypto", id: "crypto:BTC", label: "Bitcoin", detail: "coinbase|BTC-USD", at: "2026-01-02T00:00:00Z" },
      ]),
    );
    expect(sortedRecents(entries).map((item) => item.id)).toEqual(["crypto:BTC", "stock:AAPL", "token:mint"]);
    expect(entries[0]).not.toHaveProperty("detail");
    expect(entries[2].detail).toBe("coinbase|BTC-USD");
  });

  it("returns only the five newest distinct stock tickers", () => {
    const entries: RecentSearch[] = [
      { kind: "crypto", id: "crypto:BTC", label: "BTC", at: "2026-01-09T00:00:00Z" },
      ...["AAPL", "GOOG", "MSFT", "AMZN", "NVDA", "META"].map((symbol, index) => ({
        kind: "stock" as const,
        id: `stock:${symbol}`,
        label: symbol,
        at: `2026-01-${String(8 - index).padStart(2, "0")}T00:00:00Z`,
      })),
      { kind: "stock", id: "stock:AAPL-old", label: "AAPL", at: "2026-01-01T00:00:00Z" },
      { kind: "stock", id: "stock:bad", label: "AAPL!", at: "2026-01-10T00:00:00Z" },
    ];
    expect(recentStockTickers(entries)).toEqual(["AAPL", "GOOG", "MSFT", "AMZN", "NVDA"]);
  });

  it("moves an existing item to the front when it is recorded again", () => {
    const old: RecentSearch = { kind: "crypto", id: "crypto:BTC", label: "BTC", at: "2026-01-01T00:00:00Z" };
    const other: RecentSearch = { kind: "token", id: "token:mint", label: "Token", at: "2026-01-02T00:00:00Z" };
    expect(recordRecentSearch([old, other], { ...old, at: "2026-01-03T00:00:00Z" })).toEqual([
      { ...old, at: "2026-01-03T00:00:00Z" },
      other,
    ]);
  });
});
