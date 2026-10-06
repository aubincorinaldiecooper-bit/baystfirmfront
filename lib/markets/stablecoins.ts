import type { InstrumentRow, MarketsState } from "./state";
import type { MarketEvent } from "./types";

export const STABLECOINS = ["USDT", "USDC", "PYUSD", "DAI", "USDE", "FDUSD"] as const;
export const OFF_PEG_PCT = 0.5;
export const STALE_AFTER_MS = 10 * 60_000;
const USD_PEG_REFERENCE_LINES = [{ price: 1, title: "$1" }] as const;

export interface StablecoinReading {
  venue: string;
  symbol: string;
  quote: string;
  price: number;
  at: string;
  fresh: boolean;
  deviationPct: number | null;
  source: "trade" | "mid";
}

export type StablecoinCoverage = "cross_checked" | "single_venue" | "stale" | "no_usd_pair" | "no_data";

export interface StablecoinSummary {
  base: (typeof STABLECOINS)[number];
  usdReadings: StablecoinReading[];
  otherQuoteReadings: StablecoinReading[];
  crossMarketPrice: number | null;
  crossMarketDeviationPct: number | null;
  venuesOffPeg: StablecoinReading[];
  freshUsdVenueCount: number;
  depthUsd10bps: number | null;
  coverage: StablecoinCoverage;
}

interface StablecoinEntry {
  base: string;
  reading: StablecoinReading;
  depthUsd10bps: number | null;
  depthAtMs: number | null;
}

interface PriceCandidate {
  event: MarketEvent;
  price: number;
  source: StablecoinReading["source"];
  timestampMs: number;
}

export function stablecoinReferenceLines(base: string, quote: string | null | undefined) {
  return quote?.toUpperCase() === "USD" &&
    STABLECOINS.includes(base.toUpperCase() as (typeof STABLECOINS)[number])
    ? USD_PEG_REFERENCE_LINES
    : undefined;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function isOffPeg(reading: StablecoinReading): boolean {
  return reading.deviationPct !== null && Math.abs(reading.deviationPct) >= OFF_PEG_PCT - 1e-10;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFreshAt(timestampMs: number, nowMs: number): boolean {
  const ageMs = nowMs - timestampMs;
  return Number.isFinite(timestampMs) && ageMs >= 0 && ageMs <= STALE_AFTER_MS;
}

function quoteDepth(book: MarketEvent | undefined, nowMs: number): { value: number; timestampMs: number } | null {
  if (!book || book.instrument_kind !== "spot" || book.quote_asset.toUpperCase() !== "USD") return null;
  const timestampMs = Date.parse(book.exchange_timestamp);
  if (!isFreshAt(timestampMs, nowMs) || !finite(book.bid_depth_10bps) || !finite(book.ask_depth_10bps)) return null;
  return { value: book.bid_depth_10bps + book.ask_depth_10bps, timestampMs };
}

function candidate(event: MarketEvent | undefined, source: StablecoinReading["source"]): PriceCandidate | null {
  if (!event) return null;
  if (source === "trade" && finite(event.price)) {
    return { event, price: event.price, source, timestampMs: Date.parse(event.exchange_timestamp) };
  }
  if (source === "mid" && finite(event.bid) && finite(event.ask)) {
    return { event, price: (event.bid + event.ask) / 2, source, timestampMs: Date.parse(event.exchange_timestamp) };
  }
  return null;
}

function makeEntry(
  row: InstrumentRow | undefined,
  book: MarketEvent | undefined,
  nowMs: number,
): StablecoinEntry | null {
  const candidates = [candidate(row?.last, "trade"), candidate(book, "mid")].filter(
    (value): value is PriceCandidate => value !== null,
  );
  candidates.sort(
    (a, b) =>
      (Number.isFinite(b.timestampMs) ? b.timestampMs : -Infinity) -
      (Number.isFinite(a.timestampMs) ? a.timestampMs : -Infinity),
  );
  const selected = candidates[0];
  if (!selected || selected.event.instrument_kind !== "spot") return null;

  const event = selected.event;
  const quote = event.quote_asset.toUpperCase();
  const depth = quote === "USD" ? quoteDepth(book, nowMs) : null;
  return {
    base: event.base_asset.toUpperCase(),
    reading: {
      venue: event.venue,
      symbol: event.symbol,
      quote,
      price: selected.price,
      at: event.exchange_timestamp,
      fresh: isFreshAt(selected.timestampMs, nowMs),
      deviationPct: quote === "USD" ? (selected.price - 1) * 100 : null,
      source: selected.source,
    },
    depthUsd10bps: depth?.value ?? null,
    depthAtMs: depth?.timestampMs ?? null,
  };
}

function depthForFreshVenues(entries: readonly StablecoinEntry[]): number | null {
  const venueDepth = new Map<string, { value: number; timestampMs: number }>();
  for (const entry of entries) {
    if (
      entry.reading.quote !== "USD" ||
      !entry.reading.fresh ||
      entry.depthUsd10bps === null ||
      entry.depthAtMs === null
    ) {
      continue;
    }
    const previous = venueDepth.get(entry.reading.venue);
    if (!previous || entry.depthAtMs > previous.timestampMs) {
      venueDepth.set(entry.reading.venue, { value: entry.depthUsd10bps, timestampMs: entry.depthAtMs });
    }
  }
  if (venueDepth.size === 0) return null;
  return [...venueDepth.values()].reduce((sum, depth) => sum + depth.value, 0);
}

export function summarizeStablecoins(
  state: Pick<MarketsState, "instruments" | "quotes">,
  nowMs: number,
): StablecoinSummary[] {
  const byBase = new Map<string, StablecoinEntry[]>();
  const keys = new Set([...Object.keys(state.instruments), ...Object.keys(state.quotes)]);
  for (const key of keys) {
    const entry = makeEntry(state.instruments[key], state.quotes[key], nowMs);
    if (!entry) continue;
    if (!STABLECOINS.includes(entry.base as (typeof STABLECOINS)[number])) continue;
    const group = byBase.get(entry.base) ?? [];
    group.push(entry);
    byBase.set(entry.base, group);
  }

  return STABLECOINS.flatMap((base) => {
    const entries = byBase.get(base) ?? [];
    if (entries.length === 0) return [];
    const readings = entries.map((entry) => entry.reading);
    const usdReadings = readings.filter((reading) => reading.quote === "USD");
    const otherQuoteReadings = readings.filter((reading) => reading.quote !== "USD");
    const freshUsdReadings = usdReadings.filter((reading) => reading.fresh);
    const freshUsdVenueCount = new Set(freshUsdReadings.map((reading) => reading.venue)).size;
    const crossMarketPrice = median(freshUsdReadings.map((reading) => reading.price));
    const coverage: StablecoinCoverage =
      freshUsdVenueCount >= 2
        ? "cross_checked"
        : freshUsdVenueCount === 1
          ? "single_venue"
          : usdReadings.length > 0
            ? "stale"
            : otherQuoteReadings.length > 0
              ? "no_usd_pair"
              : "no_data";

    return [{
      base,
      usdReadings,
      otherQuoteReadings,
      crossMarketPrice,
      crossMarketDeviationPct: crossMarketPrice === null ? null : (crossMarketPrice - 1) * 100,
      venuesOffPeg: freshUsdReadings.filter(isOffPeg),
      freshUsdVenueCount,
      depthUsd10bps: depthForFreshVenues(entries),
      coverage,
    }];
  });
}
