"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { candlePriceFormat, candlePricePrecision, formatCandlePrice } from "@/lib/markets/chartPrices";
import type { ChartLine, IndicatorPane } from "@/lib/markets/indicators";
import type { CandleBar } from "@/lib/markets/types";

/* Candlestick chart with indicator overlays and RSI/MACD panes, drawn with
 * TradingView Lightweight Charts and themed from the app's colour tokens. */

const PRICE_PANE_HEIGHT = 300;
const SUB_PANE_HEIGHT = 110;

/* The canvas needs sRGB colours and the theme tokens are oklch, so each token
 * is painted onto a 1px canvas and read back. */
function resolveColor(variable: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (!raw) return "rgb(136, 136, 136)";
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return raw;
  context.fillStyle = raw;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

const RSI_FORMAT = { type: "price", precision: 1, minMove: 0.1 } as const;
/* MACD is in quote units and spans from ~1e-5 (low-priced coins) to hundreds (BTC). */
const MACD_FORMAT = {
  type: "custom",
  formatter: (value: number) => Number(value.toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 8 }),
  minMove: 0.00000001,
} as const;

function paneFormat(pane: IndicatorPane, precision: number) {
  return pane === "rsi" ? RSI_FORMAT : pane === "macd" ? MACD_FORMAT : candlePriceFormat(precision);
}

function formatBarTime(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function toBar(candle: CandleBar) {
  return { time: (candle.open_time / 1000) as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
}

/** True when `next` is `previous` with only the last bar changed or one bar appended (a live update). */
export function continuesHistory(previous: CandleBar[], next: CandleBar[]): boolean {
  if (previous.length === 0 || next.length < previous.length || next.length > previous.length + 1) return false;
  const lastShared = previous.length - 1;
  return next[0].open_time === previous[0].open_time && next[lastShared].open_time === previous[lastShared].open_time;
}

export function chartPanes(lines: ChartLine[]): IndicatorPane[] {
  const panes: IndicatorPane[] = ["price"];
  if (lines.some((line) => line.pane === "rsi")) panes.push("rsi");
  if (lines.some((line) => line.pane === "macd")) panes.push("macd");
  return panes;
}

interface Readout {
  bar: { open: number; high: number; low: number; close: number } | null;
  values: Record<string, number>;
}

export default function TradingChart({
  candles,
  lines,
  referenceLines,
  dark,
  simple = false,
  emptyText,
  ariaLabel,
}: {
  candles: CandleBar[];
  lines: ChartLine[];
  referenceLines?: readonly { price: number; title: string }[];
  dark: boolean;
  simple?: boolean;
  emptyText: string | null;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const referencePriceLinesRef = useRef<IPriceLine[]>([]);
  const lineSeriesRef = useRef(new Map<string, ISeriesApi<SeriesType>>());
  const shownCandlesRef = useRef<CandleBar[]>([]);
  const [hover, setHover] = useState<Readout | null>(null);
  const pricePrecision = candlePricePrecision(candles);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontSize: 11,
        attributionLogo: true,
        panes: { enableResize: false },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderVisible: false,
        entireTextOnly: true,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: {
        timeFormatter: (time: Time) => formatBarTime(Number(time)),
      },
    });
    const priceSeries = simple
      ? chart.addSeries(LineSeries, {
          color: resolveColor("--accent"),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          priceFormat: candlePriceFormat(5),
        })
      : chart.addSeries(CandlestickSeries, {
          borderVisible: false,
          priceFormat: candlePriceFormat(5),
        });
    const onCrosshairMove = (param: MouseEventParams) => {
      if (param.time === undefined || !param.point) {
        setHover(null);
        return;
      }
      const values: Record<string, number> = {};
      for (const [id, series] of lineSeriesRef.current) {
        const item = param.seriesData.get(series);
        if (item && "value" in item) values[id] = item.value;
      }
      const item = param.seriesData.get(priceSeries);
      const bar = !simple && item && "open" in item ? { open: item.open, high: item.high, low: item.low, close: item.close } : null;
      setHover({ bar, values });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    setHover(null);
    const lineSeries = lineSeriesRef.current;
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      referencePriceLinesRef.current = [];
      lineSeries.clear();
      shownCandlesRef.current = [];
    };
  }, [simple]);

  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = priceSeriesRef.current;
    if (!chart || !priceSeries) return;
    const muted = resolveColor("--ink-3");
    const line = resolveColor("--line");
    const up = resolveColor("--green");
    const down = resolveColor("--red");
    chart.applyOptions({
      layout: {
        textColor: resolveColor("--ink-2"),
        fontFamily: getComputedStyle(document.body).fontFamily,
        panes: { separatorColor: line },
      },
      grid: { vertLines: { color: resolveColor("--line-soft") }, horzLines: { color: resolveColor("--line-soft") } },
      crosshair: {
        vertLine: { color: muted, labelBackgroundColor: resolveColor("--tooltip-bg") },
        horzLine: { color: muted, labelBackgroundColor: resolveColor("--tooltip-bg") },
      },
    });
    if (simple) {
      (priceSeries as ISeriesApi<"Line">).applyOptions({ color: resolveColor("--accent") });
    } else {
      (priceSeries as ISeriesApi<"Candlestick">).applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
    }
  }, [dark, simple]);

  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = priceSeriesRef.current;
    if (!chart || !priceSeries) return;
    const previous = shownCandlesRef.current;
    if (simple) {
      const lineSeries = priceSeries as ISeriesApi<"Line">;
      lineSeries.applyOptions({ priceFormat: candlePriceFormat(pricePrecision) });
      if (continuesHistory(previous, candles)) {
        for (const candle of candles.slice(previous.length - 1)) {
          lineSeries.update({ time: (candle.open_time / 1000) as UTCTimestamp, value: candle.close });
        }
      } else {
        lineSeries.setData(
          candles.map((candle) => ({ time: (candle.open_time / 1000) as UTCTimestamp, value: candle.close })),
        );
        chart.timeScale().fitContent();
      }
    } else {
      const candleSeries = priceSeries as ISeriesApi<"Candlestick">;
      candleSeries.applyOptions({ priceFormat: candlePriceFormat(pricePrecision) });
      if (continuesHistory(previous, candles)) {
        for (const candle of candles.slice(previous.length - 1)) candleSeries.update(toBar(candle));
      } else {
        candleSeries.setData(candles.map(toBar));
        chart.timeScale().scrollToRealTime();
      }
    }
    shownCandlesRef.current = candles;
  }, [candles, pricePrecision, simple]);

  useEffect(() => {
    const chart = chartRef.current;
    const priceSeries = priceSeriesRef.current;
    if (!chart || !priceSeries) return;
    const registry = lineSeriesRef.current;
    for (const series of registry.values()) chart.removeSeries(series);
    registry.clear();
    for (const priceLine of referencePriceLinesRef.current) priceSeries.removePriceLine(priceLine);
    referencePriceLinesRef.current = [];
    const guide = resolveColor("--ink-3");
    for (const referenceLine of referenceLines ?? []) {
      referencePriceLinesRef.current.push(
        priceSeries.createPriceLine({
          price: referenceLine.price,
          color: guide,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: referenceLine.title,
        }),
      );
    }
    const referencePrices = (referenceLines ?? []).map(({ price }) => price).filter(Number.isFinite);
    priceSeries.applyOptions({
      autoscaleInfoProvider:
        referencePrices.length === 0
          ? undefined
          : (baseImplementation: () => AutoscaleInfo | null): AutoscaleInfo | null => {
              const autoscaleInfo = baseImplementation();
              const referenceMin = Math.min(...referencePrices);
              const referenceMax = Math.max(...referencePrices);
              if (!autoscaleInfo?.priceRange) {
                return { priceRange: { minValue: referenceMin, maxValue: referenceMax } };
              }
              return {
                ...autoscaleInfo,
                priceRange: {
                  minValue: Math.min(autoscaleInfo.priceRange.minValue, referenceMin),
                  maxValue: Math.max(autoscaleInfo.priceRange.maxValue, referenceMax),
                },
              };
            },
    });
    const panes = chartPanes(lines);
    const up = resolveColor("--green");
    const down = resolveColor("--red");
    for (const line of lines) {
      const paneIndex = panes.indexOf(line.pane);
      const data = line.points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));
      if (line.style === "histogram") {
        const series = chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false, priceFormat: MACD_FORMAT },
          paneIndex,
        );
        series.setData(data.map((point) => ({ ...point, color: point.value >= 0 ? up : down })));
        registry.set(line.id, series);
        continue;
      }
      const color = resolveColor(line.color);
      const series = chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          priceFormat: paneFormat(line.pane, pricePrecision),
          title: line.pane === "price" ? "" : line.label,
        },
        paneIndex,
      );
      series.setData(data);
      if (line.pane === "rsi") {
        const guide = resolveColor("--ink-3");
        for (const price of [70, 30]) {
          series.createPriceLine({ price, color: guide, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        }
      }
      registry.set(line.id, series);
    }
    chart.panes().forEach((pane, index) => pane.setStretchFactor(index === 0 ? PRICE_PANE_HEIGHT : SUB_PANE_HEIGHT));
  }, [lines, dark, pricePrecision, referenceLines, simple]);

  const last = candles[candles.length - 1];
  const bar = simple ? null : hover?.bar ?? (last ? { open: last.open, high: last.high, low: last.low, close: last.close } : null);
  const readoutValue = (line: ChartLine) => (hover ? hover.values[line.id] : line.points[line.points.length - 1]?.value);
  const height = PRICE_PANE_HEIGHT + SUB_PANE_HEIGHT * (chartPanes(lines).length - 1);

  return (
    <div aria-label={ariaLabel} role="img">
      {!simple && (
        <div className="mb-1 flex min-h-[16px] flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums text-ink-2">
          {bar && (
            <>
              <span>O {formatCandlePrice(bar.open, pricePrecision)}</span>
              <span>H {formatCandlePrice(bar.high, pricePrecision)}</span>
              <span>L {formatCandlePrice(bar.low, pricePrecision)}</span>
              <span className={bar.close >= bar.open ? "text-green" : "text-red"}>
                C {formatCandlePrice(bar.close, pricePrecision)}
              </span>
              {lines
                .filter((line) => line.pane === "price")
                .map((line) => (
                  <span key={line.id} className="inline-flex items-center gap-1">
                    <span className="inline-block size-2 rounded-full" style={{ background: `var(${line.color})` }} />
                    {line.label} {formatCandlePrice(readoutValue(line), pricePrecision)}
                  </span>
                ))}
            </>
          )}
        </div>
      )}
      <div className="relative" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0" />
        {emptyText && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-[12.5px] text-ink-3">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
