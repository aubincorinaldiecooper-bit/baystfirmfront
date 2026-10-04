import { describe, expect, it } from "vitest";
import {
  CANDLE_INTERVAL_SECONDS,
  candleBucketOpenTime,
  candleIntervalSeconds,
  mergeTradeIntoCurrentCandle,
} from "@/lib/markets/candles";
import type { CandleBar, CandleInterval } from "@/lib/markets/types";

const bar: CandleBar = {
  open_time: Date.UTC(2026, 9, 2, 16, 0),
  open: 100,
  high: 104,
  low: 98,
  close: 101,
  volume: 12,
};

describe("candle intervals", () => {
  it("maps all supported intervals to their duration", () => {
    expect(CANDLE_INTERVAL_SECONDS).toEqual({
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
    });
    expect(candleIntervalSeconds("1w")).toBe(604800);
  });

  it("aligns weekly buckets to Monday at 00:00 UTC", () => {
    const friday = Date.UTC(2026, 9, 2, 16, 0);
    expect(candleBucketOpenTime(friday, "1w")).toBe(Date.UTC(2026, 8, 28));
  });
});

describe("mergeTradeIntoCurrentCandle", () => {
  it("updates the latest bar only when the trade is inside its interval", () => {
    const interval: CandleInterval = "1h";
    const candles = [bar];
    const inside = mergeTradeIntoCurrentCandle(
      candles,
      { time: bar.open_time / 1000 + 60, value: 106 },
      interval,
    );
    expect(inside).toEqual([{ ...bar, high: 106, close: 106 }]);
    expect(
      mergeTradeIntoCurrentCandle(
        candles,
        { time: bar.open_time / 1000 + 3600, value: 106 },
        interval,
      ),
    ).toBe(candles);
  });
});
