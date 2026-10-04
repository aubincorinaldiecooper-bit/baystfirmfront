import { describe, expect, it } from "vitest";
import { groupInstrumentsByBase, preferredInstrument } from "@/lib/markets/instruments";
import type { InstrumentRow } from "@/lib/markets/state";
import type { MarketEvent } from "@/lib/markets/types";

function row(venue: string, symbol: string, kind: string): InstrumentRow {
  const event: MarketEvent = {
    event_id: `${venue}-${symbol}`,
    venue,
    symbol,
    native_symbol: symbol,
    base_asset: symbol.split("-")[0],
    quote_asset: symbol.split("-")[1] ?? "",
    instrument_kind: kind,
    event_type: "trade",
    exchange_timestamp: "2026-10-04T12:00:00Z",
    received_timestamp: "2026-10-04T12:00:00Z",
    sequence: null,
    price: 1,
    size: 1,
    side: "buy",
    payload_hash: "fixture",
    metadata: {},
  };
  return { key: `${venue}|${symbol}`, venue, symbol, kind, last: event, latencyMs: 0, streamed: 0 };
}

describe("base instrument groups", () => {
  it("prefers Coinbase USD spot and reports venue and perpetual coverage", () => {
    const rows = [
      row("kraken", "BTC-USD", "spot"),
      row("coinbase", "BTC-USD-PERP", "perpetual"),
      row("coinbase", "BTC-USD", "spot"),
    ];
    const [group] = groupInstrumentsByBase(rows);
    expect(group.preferred).toBe(rows[2]);
    expect(group.venueCount).toBe(2);
    expect(group.hasPerpetual).toBe(true);
  });

  it("falls back to the first spot and then the first available perpetual", () => {
    const spotRows = [row("bybit", "ETH-USDT-PERP", "perpetual"), row("kraken", "ETH-USD", "spot")];
    expect(preferredInstrument(spotRows)).toBe(spotRows[1]);
    const perpetualRows = [row("okx", "SOL-USDT-PERP", "perpetual"), row("bybit", "SOL-USDT-PERP", "perpetual")];
    expect(preferredInstrument(perpetualRows)).toBe(perpetualRows[1]);
  });

  it("groups bases in stable alphabetical order", () => {
    expect(groupInstrumentsByBase([row("coinbase", "ETH-USD", "spot"), row("coinbase", "BTC-USD", "spot")]).map((item) => item.base)).toEqual([
      "BTC",
      "ETH",
    ]);
  });
});
