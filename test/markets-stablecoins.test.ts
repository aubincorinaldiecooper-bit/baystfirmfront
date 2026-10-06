import { describe, expect, it } from "vitest";
import type { InstrumentRow, MarketsState } from "@/lib/markets/state";
import type { MarketEvent } from "@/lib/markets/types";
import { summarizeStablecoins } from "@/lib/markets/stablecoins";

type EventValues = Pick<Partial<MarketEvent>, "price" | "bid" | "ask" | "bid_depth_10bps" | "ask_depth_10bps">;

function event(
  venue: string,
  symbol: string,
  eventType: MarketEvent["event_type"],
  exchangeTimestamp: string,
  kind = "spot",
  values: EventValues = {},
): MarketEvent {
  const [baseAsset, quoteAsset] = symbol.split("-");
  return {
    event_id: `${venue}-${symbol}-${eventType}-${exchangeTimestamp}`,
    venue,
    symbol,
    native_symbol: symbol,
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    instrument_kind: kind,
    event_type: eventType,
    exchange_timestamp: exchangeTimestamp,
    received_timestamp: exchangeTimestamp,
    sequence: 1,
    price: null,
    size: 1,
    side: "buy",
    payload_hash: "fixture",
    metadata: {},
    ...values,
  };
}

function trade(venue: string, symbol: string, price: number, at: string, kind = "spot"): MarketEvent {
  return event(venue, symbol, "trade", at, kind, { price });
}

function book(
  venue: string,
  symbol: string,
  bid: number,
  ask: number,
  at: string,
  depths: Pick<EventValues, "bid_depth_10bps" | "ask_depth_10bps"> = {},
): MarketEvent {
  return event(venue, symbol, "book", at, "spot", { bid, ask, ...depths });
}

function marketState(
  trades: readonly MarketEvent[] = [],
  books: readonly MarketEvent[] = [],
): Pick<MarketsState, "instruments" | "quotes"> {
  const instruments: Record<string, InstrumentRow> = {};
  for (const last of trades) {
    const key = `${last.venue}|${last.symbol}`;
    instruments[key] = {
      key,
      venue: last.venue,
      symbol: last.symbol,
      kind: last.instrument_kind,
      last,
      latencyMs: null,
      streamed: 0,
    };
  }
  return {
    instruments,
    quotes: Object.fromEntries(books.map((quote) => [`${quote.venue}|${quote.symbol}`, quote])),
  };
}

describe("summarizeStablecoins", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const fresh = new Date(now - 60_000).toISOString();

  it("uses only fresh USD spot readings for the cross-market median", () => {
    const stale = new Date(now - 11 * 60_000).toISOString();
    const summaries = summarizeStablecoins(
      marketState([
        trade("coinbase", "USDT-USD", 1.01, fresh),
        trade("kraken", "USDT-USD", 0.999, fresh),
        trade("binanceus", "USDT-USD", 0.8, stale),
        trade("coinbase", "USDT-USDC", 0.999, fresh),
        trade("bybit", "USDT-USD", 0.7, fresh, "perpetual"),
      ]),
      now,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0].crossMarketPrice).toBeCloseTo(1.0045);
    expect(summaries[0].freshUsdVenueCount).toBe(2);
    expect(summaries[0].coverage).toBe("cross_checked");
    expect(summaries[0].usdReadings).toHaveLength(3);
    expect(summaries[0].usdReadings.find((reading) => reading.venue === "binanceus")?.fresh).toBe(false);
    expect(summaries[0].otherQuoteReadings).toHaveLength(1);
    expect(summaries[0].venuesOffPeg.map((reading) => reading.venue)).toEqual(["coinbase"]);
  });

  it("shows a book-only coin using its order-book mid", () => {
    const [summary] = summarizeStablecoins(marketState([], [book("kraken", "PYUSD-USD", 0.9998, 1.0002, fresh)]), now);
    expect(summary.base).toBe("PYUSD");
    expect(summary.coverage).toBe("single_venue");
    expect(summary.usdReadings[0]).toMatchObject({ price: 1, source: "mid", fresh: true });
  });

  it("uses whichever is newer between the last trade and the latest quote", () => {
    const [summary] = summarizeStablecoins(
      marketState(
        [
          trade("coinbase", "USDT-USD", 1.02, new Date(now - 2 * 60_000).toISOString()),
          trade("kraken", "USDT-USD", 1.004, fresh),
        ],
        [
          book("coinbase", "USDT-USD", 1.001, 1.003, fresh),
          book("kraken", "USDT-USD", 1.002, 1.003, new Date(now - 2 * 60_000).toISOString()),
        ],
      ),
      now,
    );
    const byVenue = Object.fromEntries(summary.usdReadings.map((reading) => [reading.venue, reading]));
    expect(byVenue.coinbase.price).toBeCloseTo(1.002);
    expect(byVenue.coinbase.source).toBe("mid");
    expect(byVenue.kraken).toMatchObject({ price: 1.004, source: "trade" });
  });

  it("sums fresh USD book depth and excludes stale books", () => {
    const stale = new Date(now - 11 * 60_000).toISOString();
    const [summary] = summarizeStablecoins(
      marketState(
        [trade("bybit", "USDT-USD", 1.0001, fresh)],
        [
          book("coinbase", "USDT-USD", 0.999, 1.001, fresh, { bid_depth_10bps: 5_000_000, ask_depth_10bps: 1_000_000 }),
          book("kraken", "USDT-USD", 0.999, 1.001, fresh, { bid_depth_10bps: 2_000_000, ask_depth_10bps: 800_000 }),
          book("bybit", "USDT-USD", 0.999, 1.001, stale, { bid_depth_10bps: 100_000_000, ask_depth_10bps: 100_000_000 }),
        ],
      ),
      now,
    );
    expect(summary.depthUsd10bps).toBe(8_800_000);
  });

  it("marks a USD pair stale when none of its readings are fresh", () => {
    const stale = new Date(now - 11 * 60_000).toISOString();
    const [summary] = summarizeStablecoins(marketState([trade("coinbase", "USDC-USD", 0.9999, stale)]), now);
    expect(summary.coverage).toBe("stale");
    expect(summary.freshUsdVenueCount).toBe(0);
    expect(summary.crossMarketPrice).toBeNull();
  });

  it("marks one fresh USD venue as unable to cross-check", () => {
    const [summary] = summarizeStablecoins(marketState([trade("coinbase", "USDC-USD", 0.9999, fresh)]), now);
    expect(summary.coverage).toBe("single_venue");
    expect(summary.freshUsdVenueCount).toBe(1);
    expect(summary.crossMarketPrice).toBe(0.9999);
  });

  it("keeps stablecoin-quoted pairs separate when no USD pair is available", () => {
    const [summary] = summarizeStablecoins(marketState([trade("coinbase", "USDE-USDT", 0.9997, fresh)]), now);
    expect(summary.coverage).toBe("no_usd_pair");
    expect(summary.crossMarketPrice).toBeNull();
    expect(summary.crossMarketDeviationPct).toBeNull();
    expect(summary.otherQuoteReadings[0].quote).toBe("USDT");
  });

  it("counts a reading exactly 0.5% away from $1 as off peg", () => {
    const [summary] = summarizeStablecoins(marketState([trade("coinbase", "USDT-USD", 1.005, fresh)]), now);
    expect(summary.venuesOffPeg).toHaveLength(1);
  });

  it("omits stablecoins with no readings", () => {
    expect(summarizeStablecoins(marketState(), now)).toEqual([]);
  });
});
