import type { CandleResponse } from "./types";

/* Indicators the chart can request from the backend (`/v1/candles?indicator=`).
 * Every plotted value is the backend's own output; nothing is computed here. */

export type IndicatorPane = "price" | "rsi" | "macd";

export interface IndicatorOption {
  spec: string;
  label: string;
  pane: IndicatorPane;
  /** CSS custom property used as the line colour. */
  color: string;
}

export const INDICATOR_OPTIONS: readonly IndicatorOption[] = [
  { spec: "sma:20", label: "SMA 20", pane: "price", color: "--accent" },
  { spec: "sma:50", label: "SMA 50", pane: "price", color: "--orange" },
  { spec: "sma:200", label: "SMA 200", pane: "price", color: "--series-sector" },
  { spec: "ema:21", label: "EMA 21", pane: "price", color: "--series-market" },
  { spec: "rsi:14", label: "RSI 14", pane: "rsi", color: "--accent" },
  { spec: "macd:12,26,9", label: "MACD 12·26·9", pane: "macd", color: "--accent" },
];

export interface ChartPoint {
  /** Seconds since the epoch: the candle's open time. */
  time: number;
  value: number;
}

export interface ChartLine {
  id: string;
  label: string;
  pane: IndicatorPane;
  color: string;
  style: "line" | "histogram";
  points: ChartPoint[];
}

/** Pairs one backend output with the candles it was computed on, dropping warm-up `null`s.
 * A length mismatch means the arrays are not aligned, so nothing is plotted. */
export function indicatorPoints(response: CandleResponse, spec: string, output: string): ChartPoint[] {
  const values = response.indicators?.[spec]?.[output];
  if (!values || values.length !== response.candles.length) return [];
  const points: ChartPoint[] = [];
  values.forEach((value, index) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      points.push({ time: response.candles[index].open_time / 1000, value });
    }
  });
  return points;
}

export function chartLines(response: CandleResponse | null, specs: readonly string[]): ChartLine[] {
  if (!response) return [];
  const lines: ChartLine[] = [];
  for (const option of INDICATOR_OPTIONS) {
    if (!specs.includes(option.spec)) continue;
    if (option.pane === "macd") {
      lines.push(
        { id: `${option.spec}/histogram`, label: "Histogram", pane: "macd", color: "--ink-3", style: "histogram", points: indicatorPoints(response, option.spec, "histogram") },
        { id: `${option.spec}/macd`, label: "MACD", pane: "macd", color: "--accent", style: "line", points: indicatorPoints(response, option.spec, "macd") },
        { id: `${option.spec}/signal`, label: "Signal", pane: "macd", color: "--orange", style: "line", points: indicatorPoints(response, option.spec, "signal") },
      );
    } else {
      lines.push({ id: option.spec, label: option.label, pane: option.pane, color: option.color, style: "line", points: indicatorPoints(response, option.spec, "value") });
    }
  }
  return lines;
}
