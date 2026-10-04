import { describe, expect, it } from "vitest";
import { classificationsFor, initialMarketsState, instrumentKey, instrumentRows, marketsReducer, MAX_TICKS } from "@/lib/markets/state";
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

function marketEvent(
  venue: string,
  symbol: string,
  eventType: MarketEvent["event_type"],
  second: number,
  fields: Partial<MarketEvent> = {},
): MarketEvent {
  return {
    ...trade(venue, symbol, 100, second),
    event_id: `${venue}-${symbol}-${eventType}-${second}`,
    event_type: eventType,
    price: null,
    size: null,
    ...fields,
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
    expect(rows[0].streamed).toBe(3);
    expect(rows[1].streamed).toBe(1);
    expect(state.ticks["coinbase|BTC-USD"].map((tick) => tick.value)).toEqual([100, 102]);
    expect(state.events).toBe(4);
  });

  it("counts an out-of-order trade without replacing last trade or latency", () => {
    const latest = trade("bybit", "BTC-USDT-PERP", 102, 2);
    const stale = {
      ...trade("bybit", "BTC-USDT-PERP", 99, 1),
      received_timestamp: new Date(Date.UTC(2026, 9, 2, 16, 0, 1, 900)).toISOString(),
    };
    let state = marketsReducer(initialMarketsState(), {
      type: "stream",
      events: [latest],
      classifications: [],
    });
    state = marketsReducer(state, { type: "stream", events: [stale], classifications: [] });

    const row = instrumentRows(state)[0];
    expect(row.last.event_id).toBe(latest.event_id);
    expect(row.latencyMs).toBe(45);
    expect(row.streamed).toBe(2);
    expect(state.ticks["bybit|BTC-USDT-PERP"].map((tick) => tick.value)).toEqual([102]);
  });

  it("routes quotes and derivatives without replacing trade state", () => {
    const key = instrumentKey("bybit", "BTC-USDT-PERP");
    const state = marketsReducer(initialMarketsState(), {
      type: "stream",
      events: [
        trade("bybit", "BTC-USDT-PERP", 100, 1),
        marketEvent("bybit", "BTC-USDT-PERP", "quote", 2, { bid: 99.9, ask: 100.1 }),
        marketEvent("bybit", "BTC-USDT-PERP", "book", 3, {
          bid: 99.95,
          ask: 100.05,
          bid_depth_10bps: 1000,
          ask_depth_10bps: 1200,
          depth_levels: 50,
        }),
        marketEvent("bybit", "BTC-USDT-PERP", "funding", 4, {
          funding_rate: 0.0001,
          next_funding_at: "2026-10-02T20:00:00Z",
          mark_price: 100.2,
          index_price: 100,
        }),
        marketEvent("bybit", "BTC-USDT-PERP", "open_interest", 5, {
          open_interest: 50,
          open_interest_value: 5000,
          metadata: { contract_multiplier: 0.01 },
        }),
        marketEvent("bybit", "BTC-USDT-PERP", "liquidation", 6, {
          price: 100,
          size: 0.5,
          side: "sell",
        }),
      ],
      classifications: [],
    });

    const row = instrumentRows(state)[0];
    expect(row.last.event_type).toBe("trade");
    expect(row.last.price).toBe(100);
    expect(row.streamed).toBe(1);
    expect(state.ticks[key].map((tick) => tick.value)).toEqual([100]);
    expect(state.quotes[key].event_type).toBe("book");
    expect(state.derivatives[key]).toMatchObject({
      funding_rate: 0.0001,
      open_interest: 50,
      open_interest_value: 5000,
      mark_price: 100.2,
      index_price: 100,
      contract_multiplier: 0.01,
    });
    expect(state.derivatives[key].field_event_ids).toMatchObject({
      funding_rate: "bybit-BTC-USDT-PERP-funding-4",
      contract_multiplier: "bybit-BTC-USDT-PERP-open_interest-5",
    });
    expect(state.liquidations).toHaveLength(1);
  });

  it("seeds quotes, derivatives, and liquidations from the snapshot", () => {
    const quote = marketEvent("okx", "BTC-USDT-PERP", "book", 1, { bid: 99, ask: 101 });
    const funding = marketEvent("okx", "BTC-USDT-PERP", "funding", 2, { funding_rate: 0.0002 });
    const oi = marketEvent("okx", "BTC-USDT-PERP", "open_interest", 3, { open_interest: 10 });
    const liquidation = marketEvent("okx", "BTC-USDT-PERP", "liquidation", 4, { price: 100, size: 2 });
    const state = marketsReducer(initialMarketsState(), {
      type: "snapshot",
      snapshot: {
        generated_at: "",
        shadow_mode: true,
        enabled_venues: ["okx"],
        symbols: ["BTC-USDT-PERP"],
        latest_events: [quote, funding, oi, liquidation],
        latest_classifications: [],
      },
    });
    const key = instrumentKey("okx", "BTC-USDT-PERP");
    expect(state.quotes[key]).toBe(quote);
    expect(state.derivatives[key]).toMatchObject({ funding_rate: 0.0002, open_interest: 10 });
    expect(state.liquidations).toEqual([liquidation]);
    expect(instrumentRows(state)).toHaveLength(0);
  });

  it("keeps only the newest 50 liquidations", () => {
    const events = Array.from({ length: 60 }, (_, second) =>
      marketEvent("okx", "BTC-USDT-PERP", "liquidation", second, { price: 100, size: 1 }),
    );
    const state = marketsReducer(initialMarketsState(), { type: "stream", events, classifications: [] });
    expect(state.liquidations).toHaveLength(50);
    expect(state.liquidations[0].exchange_timestamp).toBe(events[59].exchange_timestamp);
    expect(state.liquidations[49].exchange_timestamp).toBe(events[10].exchange_timestamp);
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
    expect(state.snapshotLoaded).toBe(true);
  });

  it("never replaces a classification with an older one and bounds the tick history", () => {
    let state = marketsReducer(initialMarketsState(), { type: "stream", events: [], classifications: [peg("peg_watch", 5), peg("pegged", 3)] });
    expect(classificationsFor(state, "stablecoin_peg")[0].label).toBe("peg_watch");
    const events = Array.from({ length: MAX_TICKS + 10 }, (_, i) => trade("okx", "ETH-USDT", 1000 + i, i % 60));
    state = marketsReducer(initialMarketsState(), { type: "stream", events: events.map((e, i) => ({ ...e, exchange_timestamp: new Date(Date.UTC(2026, 9, 2) + i * 1000).toISOString() })), classifications: [] });
    expect(state.ticks["okx|ETH-USDT"]).toHaveLength(MAX_TICKS);
  });
});
