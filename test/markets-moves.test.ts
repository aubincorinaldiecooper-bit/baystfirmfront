import { describe, expect, it } from "vitest";
import type { InstrumentRow } from "@/lib/markets/state";
import { cryptoMove, rankMarketMoves, solanaMove } from "@/lib/markets/moves";
import type { CandleBar, TokenMarket } from "@/lib/markets/types";
import type { BaseInstrumentGroup } from "@/lib/markets/instruments";

const preferred = {
  venue: "coinbase",
  symbol: "BTC-USD",
} as InstrumentRow;

const group: BaseInstrumentGroup = {
  base: "BTC",
  preferred,
  instruments: [preferred],
  venueCount: 1,
  hasPerpetual: false,
};

function candles(count: number): CandleBar[] {
  return Array.from({ length: count }, (_, index) => ({
    open_time: index * 3_600_000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1,
  }));
}

function tokenMarket(priceChange: number | null, poolCreatedAt: string | number | null = null): TokenMarket {
  return {
    price_usd: null,
    liquidity_usd: null,
    volume_24h_usd: null,
    price_change_24h_pct: priceChange,
    pool_created_at: poolCreatedAt,
    pool_count: 0,
    total_liquidity_usd: 0,
    total_volume_24h_usd: 0,
    pools_checked_at: null,
    main_pool: null,
    geckoterminal_liquidity_usd: null,
  };
}

describe("Biggest moves", () => {
  it("computes 24-hour and one-hour candle changes and omits short history", () => {
    const move = cryptoMove(group, candles(25));
    expect(move?.change24hPct).toBe(24);
    expect(move?.change1hPct).toBeCloseTo((124 / 123 - 1) * 100);
    expect(cryptoMove(group, candles(24))).toBeNull();
  });

  it("labels young Solana pools as since launch and omits missing changes", () => {
    const now = Date.UTC(2026, 9, 4);
    const move = solanaMove(
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "BONK",
      tokenMarket(-32.5, now - 5 * 60_000),
      "DEX Screener via Baystfirm",
      now,
    );
    expect(move).toMatchObject({ label: "BONK", change24hPct: -32.5, windowLabel: "since launch" });
    expect(solanaMove("mint", "TOKEN", tokenMarket(null), "DEX Screener", now)).toBeNull();
  });

  it("ranks by absolute 24-hour change and caps the list at eight", () => {
    const moves = Array.from({ length: 10 }, (_, index) => ({
      id: `crypto:${index}`,
      kind: "Crypto" as const,
      label: `Coin ${index}`,
      href: `/crypto/${index}`,
      change24hPct: index === 9 ? -75 : index * 5,
      change1hPct: null,
      windowLabel: "24h",
      source: "Baystfirm exchange candles",
    }));
    expect(rankMarketMoves(moves)).toHaveLength(8);
    expect(rankMarketMoves(moves)[0].change24hPct).toBe(-75);
    expect(rankMarketMoves([{ ...moves[0], change24hPct: Number.NaN }])).toEqual([]);
  });
});
