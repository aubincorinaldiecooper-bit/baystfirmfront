"use client";

import { Liveline } from "liveline";
import { useEffect, useMemo, useState } from "react";
import { fetchCandles } from "@/lib/markets/client";
import { candleIntervalSeconds, mergeTradeIntoCurrentCandle } from "@/lib/markets/candles";
import { formatClock, formatQuote, venueLabel } from "@/lib/markets/labels";
import type { Tick } from "@/lib/markets/state";
import { CANDLE_INTERVALS, type CandleInterval, type CandleResponse } from "@/lib/markets/types";

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

export default function LiveChart({
  title,
  venue,
  symbol,
  ticks,
}: {
  title: string;
  venue: string | null;
  symbol: string | null;
  ticks: Tick[];
}) {
  const dark = useDarkMode();
  const last = ticks[ticks.length - 1];
  const [interval, setCandleInterval] = useState<CandleInterval>("1m");
  const [response, setResponse] = useState<CandleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!venue || !symbol) {
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
    fetchCandles(venue, symbol, interval, fetch, controller.signal)
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
  }, [interval, symbol, venue]);

  const mergedCandles = useMemo(
    () => mergeTradeIntoCurrentCandle(response?.candles ?? [], last, interval),
    [interval, last, response],
  );
  const chartCandles = useMemo(
    () =>
      mergedCandles.map(({ open_time, open, high, low, close }) => ({
        time: open_time / 1000,
        open,
        high,
        low,
        close,
      })),
    [mergedCandles],
  );
  const windowSeconds = candleIntervalSeconds(interval) * 300;
  const emptyText = error
    ? "Candlestick history is unavailable."
    : venue && symbol
      ? "The public API returned no candles for this interval."
      : "Select a traded instrument to load its candle history.";

  return (
    <div className="rounded-[10px] bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <span className="font-mono text-[13px] tabular-nums text-ink-2">{last ? formatQuote(last.value) : "—"}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Candle interval">
        {CANDLE_INTERVALS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={interval === value}
            onClick={() => setCandleInterval(value)}
            className={`rounded-md px-2 py-1 text-[11px] ${
              interval === value ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-hover-2"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="h-[260px]" aria-label={`Candlestick history for ${symbol ?? "instrument"} on ${venue ? venueLabel(venue) : "venue"}`}>
        <Liveline
          data={ticks}
          value={last?.value ?? chartCandles[chartCandles.length - 1]?.close ?? 0}
          theme={dark ? "dark" : "light"}
          window={windowSeconds}
          mode="candle"
          candles={chartCandles}
          candleWidth={candleIntervalSeconds(interval)}
          loading={loading}
          emptyText={emptyText}
          formatValue={formatQuote}
          formatTime={(time) => formatClock(new Date(time * 1000).toISOString())}
          grid
          badge
          momentum
        />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">
        {ticks.length} recorded trade{ticks.length === 1 ? "" : "s"} since this page opened.
      </p>
      {response ? (
        <p className="mt-1 text-[11.5px] text-ink-3">
          Candles from {venueLabel(response.venue)} public API · fetched {formatClock(response.fetched_at)}
          {response.aggregated_from ? ` · aggregated from ${response.aggregated_from}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-[11.5px] text-ink-3">
          {error
            ? `Candles from ${venue ? venueLabel(venue) : "the selected venue"} public API are unavailable.`
            : loading && venue && symbol
              ? `Loading candles from ${venueLabel(venue)} public API…`
              : emptyText}
        </p>
      )}
      {response?.stale && (
        <p className="mt-1 text-[11.5px] text-ink-3" role="status">
          Warning: showing cached candle history after an upstream error: {response.error ?? "upstream unavailable"}
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
