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
  it("retains a spike high after a later lower trade", () => {
    const interval: CandleInterval = "1h";
    const merged = mergeTradeIntoCurrentCandle(
      [bar],
      [
        { time: bar.open_time / 1000 + 60, value: 110 },
        { time: bar.open_time / 1000 + 120, value: 104 },
      ],
      interval,
    );
    expect(merged).toEqual([{ ...bar, high: 110, close: 104 }]);
  });

  it("retains a dip low and closes at the latest trade by time", () => {
    const merged = mergeTradeIntoCurrentCandle(
      [bar],
      [
        { time: bar.open_time / 1000 + 120, value: 100 },
        { time: bar.open_time / 1000 + 60, value: 95 },
      ],
      "1h",
    );
    expect(merged).toEqual([{ ...bar, low: 95, close: 100 }]);
  });

  it("opens and updates bars when trades cross an interval boundary", () => {
    const nextOpen = bar.open_time / 1000 + 3600;
    const merged = mergeTradeIntoCurrentCandle(
      [bar],
      [
        { time: nextOpen + 60, value: 99 },
        { time: nextOpen, value: 102 },
      ],
      "1h",
    );
    expect(merged).toEqual([
      bar,
      {
        open_time: bar.open_time + 3600_000,
        open: 102,
        high: 102,
        low: 99,
        close: 99,
        volume: 0,
      },
    ]);
  });

  it("ignores trades older than the last fetched bar", () => {
    const candles = [bar];
    expect(
      mergeTradeIntoCurrentCandle(candles, [{ time: bar.open_time / 1000 - 1, value: 110 }], "1h"),
    ).toBe(candles);
  });
});
