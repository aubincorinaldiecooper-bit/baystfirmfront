import { describe, expect, it } from "vitest";
import { classificationsFor, initialMarketsState, instrumentRows, marketsReducer, MAX_TICKS } from "@/lib/markets/state";
import type { Classification, MarketEvent } from "@/lib/markets/types";

function trade(venue: string, symbol: string, price: number, second: number): MarketEvent {
  const at = new Date(Date.UTC(2026, 9, 2, 16, 0, second)).toISOString();
  const received = new Date(Date.UTC(2026, 9, 2, 16, 0, second, 45)).toISOString();
  return {
    event_id: `${venue}-${symbol}-${second}`,
    venue,
    symbol,
    native_symbol: symbol,
    base_asset: symbol.split("-")[0],
    quote_asset: symbol.split("-")[1],
    instrument_kind: "spot",
    event_type: "trade",
    exchange_timestamp: at,
    received_timestamp: received,
    sequence: second,
    price,
    size: 1,
    side: "buy",
    bid: null,
    ask: null,
    payload_hash: "h",
    metadata: {},
  };
}

function peg(label: string, second: number): Classification {
  return {
    classification_id: `peg-${second}`,
    classifier: "stablecoin_peg",
    classifier_version: "rules-0.2.0",
    symbol: "USDC",
    label,
    probability: 0.9,
    abstained: false,
    horizon_seconds: 30,
    observed_at: new Date(Date.UTC(2026, 9, 2, 16, 0, second)).toISOString(),
    generated_at: new Date(Date.UTC(2026, 9, 2, 16, 0, second)).toISOString(),
    evidence: [],
    shadow: true,
    calibration_status: "uncalibrated",
    freshness_ms: 40,
  };
}

describe("marketsReducer", () => {
  it("keeps the latest trade per venue and instrument, with its feed latency", () => {
    let state = marketsReducer(initialMarketsState(), {
      type: "stream",
      events: [trade("coinbase", "BTC-USD", 100, 1), trade("kraken", "BTC-USD", 101, 1), trade("coinbase", "BTC-USD", 102, 2)],
      classifications: [],
    });
    state = marketsReducer(state, { type: "stream", events: [trade("coinbase", "BTC-USD", 99, 0)], classifications: [] });
    const rows = instrumentRows(state);
    expect(rows.map((row) => [row.venue, row.last.price])).toEqual([
      ["coinbase", 102],
      ["kraken", 101],
    ]);
    expect(rows[0].latencyMs).toBe(45);
    expect(state.ticks["coinbase|BTC-USD"].map((tick) => tick.value)).toEqual([100, 102]);
    expect(state.events).toBe(4);
  });

  it("seeds from the snapshot without counting it as streamed", () => {
    const state = marketsReducer(initialMarketsState(), {
      type: "snapshot",
      snapshot: {
        generated_at: "",
        shadow_mode: true,
        enabled_venues: ["coinbase"],
        symbols: ["BTC-USD"],
        latest_events: [trade("coinbase", "BTC-USD", 100, 1)],
        latest_classifications: [peg("pegged", 1)],
      },
    });
    expect(instrumentRows(state)[0].streamed).toBe(0);
    expect(classificationsFor(state, "stablecoin_peg").map((item) => item.label)).toEqual(["pegged"]);
  });

  it("never replaces a classification with an older one and bounds the tick history", () => {
    let state = marketsReducer(initialMarketsState(), { type: "stream", events: [], classifications: [peg("peg_watch", 5), peg("pegged", 3)] });
    expect(classificationsFor(state, "stablecoin_peg")[0].label).toBe("peg_watch");
    const events = Array.from({ length: MAX_TICKS + 10 }, (_, i) => trade("okx", "ETH-USDT", 1000 + i, i % 60));
    state = marketsReducer(initialMarketsState(), { type: "stream", events: events.map((e, i) => ({ ...e, exchange_timestamp: new Date(Date.UTC(2026, 9, 2) + i * 1000).toISOString() })), classifications: [] });
    expect(state.ticks["okx|ETH-USDT"]).toHaveLength(MAX_TICKS);
  });
});
