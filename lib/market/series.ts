/**
 * Price-series math for the market views, computed in the browser from the
 * daily rows the backend sent in `market.series` (or the result's `market`).
 * Pure functions, no I/O: every number they return is derived from those rows
 * and nothing else, so an empty or short series yields `null`, never a guess.
 */

import type { MarketRole, MarketSeries, PricePoint } from "@/lib/api/types";

/* ── rows ────────────────────────────────────────────────── */

export interface Bar {
  /** YYYY-MM-DD */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Valid rows only (a date and a positive close), oldest → newest, one per date. */
export function toBars(points: readonly PricePoint[] | null | undefined): Bar[] {
  const bars: Bar[] = [];
  for (const point of points ?? []) {
    if (!Array.isArray(point)) continue;
    const [date, open, high, low, close, volume] = point;
    const c = finiteOrNull(close);
    if (typeof date !== "string" || !DAY.test(date) || c === null || c <= 0) continue;
    bars.push({ date, open: finiteOrNull(open), high: finiteOrNull(high), low: finiteOrNull(low), close: c, volume: finiteOrNull(volume) });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  /* a repeated date keeps its last row */
  return bars.filter((bar, i) => i === bars.length - 1 || bars[i + 1].date !== bar.date);
}

export function seriesFor(series: readonly MarketSeries[], role: MarketRole): MarketSeries | null {
  return series.find((s) => s.role === role) ?? null;
}

/* ── ranges ──────────────────────────────────────────────── */

export type RangeKey = "1M" | "6M" | "1Y" | "5Y";
export const RANGE_KEYS: readonly RangeKey[] = ["1M", "6M", "1Y", "5Y"];
/** Trading rows per range. */
export const RANGE_ROWS: Record<RangeKey, number> = { "1M": 21, "6M": 126, "1Y": 252, "5Y": 1260 };
export const RANGE_PHRASE: Record<RangeKey, string> = {
  "1M": "the past month",
  "6M": "the past 6 months",
  "1Y": "the past year",
  "5Y": "the past 5 years",
};

export function lastRows<T>(rows: readonly T[], count: number): T[] {
  return rows.slice(Math.max(0, rows.length - count));
}

export function percentChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return (to / from - 1) * 100;
}

/** Percent change of each value from the first one. */
export function indexedChange(closes: readonly number[]): number[] {
  if (closes.length === 0) return [];
  const base = closes[0];
  return closes.map((close) => percentChange(base, close) ?? 0);
}

/* ── candles ─────────────────────────────────────────────── */

export type CandleInterval = "daily" | "weekly" | "monthly";
export const RANGE_INTERVAL: Record<RangeKey, CandleInterval> = { "1M": "daily", "6M": "daily", "1Y": "weekly", "5Y": "monthly" };
export const INTERVAL_LABEL: Record<CandleInterval, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export interface Candle {
  /** First and last trading day in the candle. */
  start: string;
  end: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  rows: number;
}

/** Monday of the ISO week containing `date` (YYYY-MM-DD, UTC). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function bucketKey(date: string, interval: CandleInterval): string {
  if (interval === "daily") return date;
  if (interval === "weekly") return weekStart(date);
  return date.slice(0, 7);
}

/**
 * OHLC candles from daily rows: one per trading day, calendar week (Monday
 * start) or calendar month. Open is the first row's open, close the last
 * row's close, high/low the extremes, volume the sum. A row without
 * open/high/low (close-only data) contributes its close.
 */
export function aggregateCandles(bars: readonly Bar[], interval: CandleInterval): Candle[] {
  const candles: Candle[] = [];
  let key: string | null = null;
  for (const bar of bars) {
    const open = bar.open ?? bar.close;
    const high = Math.max(bar.high ?? -Infinity, open, bar.close);
    const low = Math.min(bar.low ?? Infinity, open, bar.close);
    const k = bucketKey(bar.date, interval);
    const current = candles[candles.length - 1];
    if (current && k === key) {
      current.end = bar.date;
      current.high = Math.max(current.high, high);
      current.low = Math.min(current.low, low);
      current.close = bar.close;
      if (bar.volume !== null) current.volume = (current.volume ?? 0) + bar.volume;
      current.rows += 1;
    } else {
      key = k;
      candles.push({ start: bar.date, end: bar.date, open, high, low, close: bar.close, volume: bar.volume, rows: 1 });
    }
  }
  return candles;
}

/* ── comparison ──────────────────────────────────────────── */

export interface CompareLine {
  role: MarketRole;
  symbol: string;
  name: string;
  /** Close on each axis date (carried forward from the last earlier row), or null before the series starts. */
  closes: (number | null)[];
  /** Percent change from the first available close in the range, per axis date. */
  changes: (number | null)[];
  /** Change at the last axis date. */
  end: number | null;
}

export interface Comparison {
  /** The axis: the base series' trading dates in the range. */
  dates: string[];
  lines: CompareLine[];
}

/**
 * Indexed percent change of every series over one range, on the trading
 * dates of the company series (or the first series when there is no company
 * row), so the lines share one axis without weekend gaps.
 */
export function compareSeries(series: readonly MarketSeries[], range: RangeKey): Comparison {
  const base = seriesFor(series, "company") ?? series[0];
  if (!base) return { dates: [], lines: [] };
  const dates = lastRows(toBars(base.points), RANGE_ROWS[range]).map((b) => b.date);
  const lines = series.map((s): CompareLine => {
    const bars = toBars(s.points);
    const closes: (number | null)[] = [];
    let j = 0;
    for (const date of dates) {
      while (j < bars.length && bars[j].date <= date) j += 1;
      closes.push(j > 0 ? bars[j - 1].close : null);
    }
    const first = closes.find((c): c is number => c !== null) ?? null;
    const changes = closes.map((c) => (c === null ? null : percentChange(first, c)));
    return { role: s.role, symbol: s.symbol, name: s.name, closes, changes, end: changes.length ? changes[changes.length - 1] : null };
  });
  return { dates, lines };
}

/* ── derived figures ─────────────────────────────────────── */

export interface Tile {
  label: "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y";
  pct: number | null;
}

/** Trading rows back from the last close for each fixed-length tile. */
export const TILE_ROWS = { "1W": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252 } as const;

/**
 * Performance tiles from the last close: 1W/1M/3M/6M/1Y compare with the
 * close that many trading rows earlier; YTD with the last close of the prior
 * calendar year. `null` when the series does not reach back that far.
 */
export function performanceTiles(bars: readonly Bar[]): Tile[] {
  const lastIndex = bars.length - 1;
  const last = bars[lastIndex];
  const back = (rows: number) => (last && lastIndex - rows >= 0 ? percentChange(bars[lastIndex - rows].close, last.close) : null);
  let ytd: number | null = null;
  if (last) {
    const yearStart = `${last.date.slice(0, 4)}-01-01`;
    for (let i = lastIndex; i >= 0; i -= 1) {
      if (bars[i].date < yearStart) {
        ytd = percentChange(bars[i].close, last.close);
        break;
      }
    }
  }
  return [
    { label: "1W", pct: back(TILE_ROWS["1W"]) },
    { label: "1M", pct: back(TILE_ROWS["1M"]) },
    { label: "3M", pct: back(TILE_ROWS["3M"]) },
    { label: "6M", pct: back(TILE_ROWS["6M"]) },
    { label: "YTD", pct: ytd },
    { label: "1Y", pct: back(TILE_ROWS["1Y"]) },
  ];
}

export interface DayChange {
  date: string;
  close: number;
  previous: number | null;
  change: number | null;
  pct: number | null;
}

/** The last close and its change from the previous row. */
export function lastClose(bars: readonly Bar[]): DayChange | null {
  const last = bars[bars.length - 1];
  if (!last) return null;
  const previous = bars.length > 1 ? bars[bars.length - 2].close : null;
  return {
    date: last.date,
    close: last.close,
    previous,
    change: previous === null ? null : last.close - previous,
    pct: percentChange(previous, last.close),
  };
}

/** Lowest low and highest high over the last 252 rows (close where low/high are missing). */
export function fiftyTwoWeekRange(bars: readonly Bar[]): { low: number; high: number } | null {
  const rows = lastRows(bars, 252);
  if (rows.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const bar of rows) {
    low = Math.min(low, bar.low ?? bar.close);
    high = Math.max(high, bar.high ?? bar.close);
  }
  return { low, high };
}

/** Mean volume over the last `days` rows, counting only rows that report one. */
export function averageVolume(bars: readonly Bar[], days = 30): number | null {
  const volumes = lastRows(bars, days)
    .map((b) => b.volume)
    .filter((v): v is number => v !== null);
  if (volumes.length === 0) return null;
  return volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
}

/* ── axes ────────────────────────────────────────────────── */

/** Round, evenly spaced tick values covering [lo, hi], at most `maxTicks` of them. */
export function niceTicks(lo: number, hi: number, maxTicks = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi <= lo) return [lo];
  const span = hi - lo;
  const magnitude = 10 ** Math.floor(Math.log10(span / maxTicks));
  const step = [1, 2, 2.5, 5, 10, 20].map((m) => m * magnitude).find((s) => span / s <= maxTicks) ?? 20 * magnitude;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9 && ticks.length <= maxTicks; v += step) {
    ticks.push(Number(v.toFixed(decimals)));
  }
  return ticks;
}

/** [min, max] of the values, padded by a fraction of the span (1 unit when flat). */
export function paddedExtent(values: Iterable<number>, pad = 0.08): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (lo === Infinity) return null;
  const span = hi - lo || Math.abs(hi) * 0.02 || 1;
  return [lo - span * pad, hi + span * pad];
}
