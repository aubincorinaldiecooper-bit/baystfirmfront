"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { mergeTradeIntoCurrentCandle } from "@/lib/markets/candles";
import { INDICATOR_OPTIONS, chartLines } from "@/lib/markets/indicators";
import { formatClock, formatQuote } from "@/lib/markets/labels";
import type { Tick } from "@/lib/markets/state";
import { CANDLE_INTERVALS, type CandleInterval, type CandleResponse } from "@/lib/markets/types";
import TradingChart from "./TradingChart";

const EMPTY_INDICATORS: string[] = [];

export type CandleLoader = (
  interval: CandleInterval,
  signal: AbortSignal,
  indicators: readonly string[],
) => Promise<CandleResponse>;

export default function CandleChartPanel({
  title,
  venue,
  symbol,
  loadCandles,
  ticks = [],
  intervals,
  initialInterval = "1m",
  venueName,
  emptyMessage,
  loadingMessage,
  staleMessage,
  attribution,
  referenceLines,
  showIndicators = true,
  showTradeCount = false,
  showLastPrice = true,
  ariaLabel,
}: {
  title: ReactNode;
  venue: string | null;
  symbol: string | null;
  loadCandles?: CandleLoader;
  ticks?: Tick[];
  intervals?: readonly CandleInterval[];
  initialInterval?: CandleInterval;
  venueName?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  staleMessage?: (response: CandleResponse) => ReactNode;
  attribution?: (response: CandleResponse) => ReactNode;
  referenceLines?: readonly { price: number; title: string }[];
  showIndicators?: boolean;
  showTradeCount?: boolean;
  showLastPrice?: boolean;
  ariaLabel?: string;
}) {
  const dark = useDarkMode();
  const lastTick = ticks[ticks.length - 1];
  const availableIntervals = intervals ?? CANDLE_INTERVALS;
  const initial = availableIntervals.includes(initialInterval) ? initialInterval : availableIntervals[0] ?? "1m";
  const [interval, setCandleInterval] = useState<CandleInterval>(initial);
  const [indicators, setIndicators] = useState<string[]>([]);
  const requestIndicators = showIndicators ? indicators : EMPTY_INDICATORS;
  const [response, setResponse] = useState<CandleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showIndicators) setIndicators([]);
  }, [showIndicators]);

  useEffect(() => {
    if (!loadCandles) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setResponse(null);
    setError(null);
    setLoading(true);
    loadCandles(interval, controller.signal, requestIndicators)
      .then(setResponse)
      .catch((cause: unknown) => {
        if (!active || (cause instanceof Error && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : "Unknown candle request error.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [interval, loadCandles, requestIndicators]);

  const mergedCandles = useMemo(
    () => mergeTradeIntoCurrentCandle(response?.candles ?? [], ticks, interval),
    [interval, response, ticks],
  );
  const lines = useMemo(() => chartLines(response, requestIndicators), [requestIndicators, response]);
  const toggleIndicator = (spec: string) =>
    setIndicators((current) =>
      current.includes(spec) ? current.filter((item) => item !== spec) : [...current, spec],
    );
  const noCandles = error
    ? "Candlestick history is unavailable."
    : loadCandles
      ? emptyMessage ?? "The public API returned no candles for this interval."
      : "Select a traded instrument to load its candle history.";
  const displayVenue = venueName ?? venue ?? "venue";

  return (
    <div className="rounded-[10px] bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        {showLastPrice && (
          <span className="font-mono text-[13px] tabular-nums text-ink-2">{lastTick ? formatQuote(lastTick.value) : "—"}</span>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Candle interval">
        {availableIntervals.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={interval === value}
            onClick={() => setCandleInterval(value)}
            className={`rounded-md px-2 py-1 text-[11px] ${interval === value ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-hover-2"}`}
          >
            {value}
          </button>
        ))}
      </div>
      {showIndicators && (
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Indicators">
          {INDICATOR_OPTIONS.map((option) => (
            <button
              key={option.spec}
              type="button"
              aria-pressed={indicators.includes(option.spec)}
              onClick={() => toggleIndicator(option.spec)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                indicators.includes(option.spec) ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-hover-2"
              }`}
            >
              {option.pane === "price" && (
                <span className="inline-block size-2 rounded-full" style={{ background: `var(${option.color})` }} />
              )}
              {option.label}
            </button>
          ))}
        </div>
      )}
      <TradingChart
        candles={mergedCandles}
        lines={lines}
        referenceLines={referenceLines}
        dark={dark}
        emptyText={mergedCandles.length > 0 ? null : loading ? loadingMessage ?? "Loading candles…" : noCandles}
        ariaLabel={ariaLabel ?? `Candlestick history for ${symbol ?? "instrument"} on ${displayVenue}`}
      />
      {showTradeCount && (
        <p className="mt-2 text-[11.5px] text-ink-3">
          {ticks.length} recorded trade{ticks.length === 1 ? "" : "s"} since this page opened.
        </p>
      )}
      {response ? (
        attribution ? (
          attribution(response)
        ) : (
          <p className="mt-1 text-[11.5px] text-ink-3">
            Candles from {displayVenue} public API · fetched {formatClock(response.fetched_at)}
            {response.aggregated_from ? ` · aggregated from ${response.aggregated_from}` : ""}
          </p>
        )
      ) : (
        <p className="mt-1 text-[11.5px] text-ink-3">
          {error
            ? `Candles from ${displayVenue} public API are unavailable.`
            : loading && loadCandles
              ? loadingMessage ?? `Loading candles from ${displayVenue} public API…`
              : noCandles}
        </p>
      )}
      {response && requestIndicators.length > 0 && (
        <p className="mt-1 text-[11.5px] text-ink-3">
          Indicators computed by the Baystfirm backend from these candles when fetched; each starts blank until it has enough bars and does not move with the live candle.
        </p>
      )}
      {response?.stale && (
        <p className="mt-1 text-[11.5px] text-ink-3" role="status">
          {staleMessage ? staleMessage(response) : `Warning: showing cached candle history after an upstream error: ${response.error ?? "upstream unavailable"}`}
        </p>
      )}
      {response?.truncated && (
        <p className="mt-1 text-[11.5px] text-ink-3">
          The public API returned {response.candles.length} available candles; history is truncated.
        </p>
      )}
      {error && (
        <p className="mt-1 text-[11.5px] text-red" role="alert">
          Candle history could not be loaded: {error}
        </p>
      )}
    </div>
  );
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
