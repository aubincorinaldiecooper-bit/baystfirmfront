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
  ticks: Tick[],
  interval: CandleInterval,
): CandleBar[] {
  if (candles.length === 0 || ticks.length === 0) return candles;

  const fetchedLastOpenTime = candles[candles.length - 1].open_time;
  const liveTicks = ticks
    .filter(
      (tick) =>
        Number.isFinite(tick.time) &&
        Number.isFinite(tick.value) &&
        tick.time * 1000 >= fetchedLastOpenTime,
    )
    .sort((a, b) => a.time - b.time);
  if (liveTicks.length === 0) return candles;

  const merged = [...candles];
  for (const tick of liveTicks) {
    const openTime = candleBucketOpenTime(tick.time * 1000, interval);
    const lastIndex = merged.length - 1;
    const last = merged[lastIndex];
    if (openTime < last.open_time) continue;
    if (openTime === last.open_time) {
      merged[lastIndex] = {
        ...last,
        high: Math.max(last.high, tick.value),
        low: Math.min(last.low, tick.value),
        close: tick.value,
      };
    } else {
      merged.push({
        open_time: openTime,
        open: tick.value,
        high: tick.value,
        low: tick.value,
        close: tick.value,
        volume: 0,
      });
    }
  }
  return merged;
}
