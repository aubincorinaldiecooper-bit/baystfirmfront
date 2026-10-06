import type { CandleBar } from "./types";
import { formatQuote } from "./labels";

export function candlePricePrecision(candles: readonly Pick<CandleBar, "low">[]): number {
  let lowestPositiveLow = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    if (Number.isFinite(candle.low) && candle.low > 0 && candle.low < lowestPositiveLow) {
      lowestPositiveLow = candle.low;
    }
  }

  if (!Number.isFinite(lowestPositiveLow)) return 5;
  if (lowestPositiveLow < 0.01) {
    return Math.min(12, Math.ceil(-Math.log10(lowestPositiveLow)) + 3);
  }
  if (lowestPositiveLow >= 1000) return 2;
  if (lowestPositiveLow >= 10) return 3;
  return 5;
}

export function candleChangePercent(candles: readonly Pick<CandleBar, "close">[]): number | null {
  if (candles.length < 2) return null;
  const firstClose = candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  if (!Number.isFinite(firstClose) || firstClose <= 0 || !Number.isFinite(lastClose)) return null;
  return (lastClose / firstClose - 1) * 100;
}

export function formatCandlePrice(value: number | null | undefined, precision: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 0.01 || value <= 0) return formatQuote(value);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function candlePriceFormat(precision: number) {
  return {
    type: "custom",
    formatter: (value: number) => formatCandlePrice(value, precision),
    minMove: 10 ** -precision,
  } as const;
}
