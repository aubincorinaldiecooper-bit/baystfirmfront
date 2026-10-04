import type { CandleBar, CandleInterval } from "./types";
import type { Tick } from "./state";

export const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "12h": 43200,
  "1d": 86400,
  "1w": 604800,
};

const WEEK_MS = CANDLE_INTERVAL_SECONDS["1w"] * 1000;
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);

export function candleIntervalSeconds(interval: CandleInterval): number {
  return CANDLE_INTERVAL_SECONDS[interval];
}

export function candleBucketOpenTime(timeMs: number, interval: CandleInterval): number {
  if (interval === "1w") {
    return MONDAY_EPOCH_MS + Math.floor((timeMs - MONDAY_EPOCH_MS) / WEEK_MS) * WEEK_MS;
  }
  const intervalMs = candleIntervalSeconds(interval) * 1000;
  return Math.floor(timeMs / intervalMs) * intervalMs;
}

export function mergeTradeIntoCurrentCandle(
  candles: CandleBar[],
  tick: Tick | null | undefined,
  interval: CandleInterval,
): CandleBar[] {
  if (!tick || candles.length === 0 || !Number.isFinite(tick.time) || !Number.isFinite(tick.value)) {
    return candles;
  }
  const last = candles[candles.length - 1];
  const bucketOpenTime = candleBucketOpenTime(tick.time * 1000, interval);
  if (bucketOpenTime !== last.open_time) return candles;

  return [
    ...candles.slice(0, -1),
    {
      ...last,
      high: Math.max(last.high, tick.value),
      low: Math.min(last.low, tick.value),
      close: tick.value,
    },
  ];
}
