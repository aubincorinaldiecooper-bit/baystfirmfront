import { describe, expect, it } from "vitest";
import {
  parseWatchlist,
  serializeWatchlist,
  toggleWatchlist,
  WATCHLIST_STORAGE_KEY,
} from "@/lib/markets/watchlist";

describe("market watchlist helpers", () => {
  it("round-trips instrument keys", () => {
    const keys = ["coinbase|BTC-USD", "kraken|ETH-USD"];
    expect(parseWatchlist(serializeWatchlist(keys))).toEqual(keys);
    expect(WATCHLIST_STORAGE_KEY).toBe("baystfirm.markets.watchlist.v1");
  });

  it("returns an empty list for corrupt or invalid stored data", () => {
    expect(parseWatchlist("{not json")).toEqual([]);
    expect(parseWatchlist(JSON.stringify({ symbol: "BTC-USD" }))).toEqual([]);
    expect(parseWatchlist(JSON.stringify(["coinbase|BTC-USD", null, "|BTC-USD", "coinbase|", "bad|key|shape"]))).toEqual([
      "coinbase|BTC-USD",
    ]);
  });

  it("adds and removes an instrument key when toggled", () => {
    const added = toggleWatchlist([], "coinbase|BTC-USD");
    expect(added).toEqual(["coinbase|BTC-USD"]);
    expect(toggleWatchlist(added, "coinbase|BTC-USD")).toEqual([]);
  });
});
