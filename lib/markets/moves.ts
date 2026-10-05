import type { CandleBar, TokenMarket } from "./types";
import type { BaseInstrumentGroup } from "./instruments";
import { venueLabel } from "./labels";

export interface MarketMove {
  id: string;
  kind: "Crypto" | "Solana";
  label: string;
  href: string;
  change24hPct: number;
  change1hPct: number | null;
  windowLabel: string;
  source: string;
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return Number.isFinite(change) ? change : null;
}

export function cryptoMove(group: BaseInstrumentGroup, candles: readonly CandleBar[]): MarketMove | null {
  if (candles.length < 25) return null;
  const last = candles[candles.length - 1];
  const oneHourAgo = candles[candles.length - 2];
  const oneDayAgo = candles[candles.length - 25];
  const change24hPct = percentChange(last.close, oneDayAgo.close);
  const change1hPct = percentChange(last.close, oneHourAgo.close);
  if (change24hPct === null) return null;
  return {
    id: `crypto:${group.base}`,
    kind: "Crypto",
    label: group.base,
    href: `/crypto/${encodeURIComponent(group.base)}`,
    change24hPct,
    change1hPct,
    windowLabel: "24h",
    source: `Baystfirm exchange candles · ${venueLabel(group.preferred.venue)}`,
  };
}

function poolCreatedAtMs(value: TokenMarket["pool_created_at"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function solanaMove(
  mint: string,
  symbol: string | null,
  market: TokenMarket,
  source: string,
  now: number,
): MarketMove | null {
  if (typeof market.price_change_24h_pct !== "number" || !Number.isFinite(market.price_change_24h_pct)) return null;
  const poolCreatedAt = poolCreatedAtMs(market.pool_created_at);
  const sinceLaunch = poolCreatedAt !== null && now >= poolCreatedAt && now - poolCreatedAt < 24 * 60 * 60 * 1000;
  const name = symbol?.trim() || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return {
    id: `token:${mint}`,
    kind: "Solana",
    label: name,
    href: `/tokens/${encodeURIComponent(mint)}`,
    change24hPct: market.price_change_24h_pct,
    change1hPct: null,
    windowLabel: sinceLaunch ? "since launch" : "24h",
    source,
  };
}

export function rankMarketMoves(moves: readonly MarketMove[], limit = 8): MarketMove[] {
  return [...moves]
    .filter((move) => Number.isFinite(move.change24hPct))
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct) || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit));
}
