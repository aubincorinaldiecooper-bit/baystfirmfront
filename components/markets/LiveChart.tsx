"use client";

import { useCallback } from "react";
import { fetchCandles } from "@/lib/markets/client";
import { venueLabel } from "@/lib/markets/labels";
import type { Tick } from "@/lib/markets/state";
import type { CandleInterval } from "@/lib/markets/types";
import CandleChartPanel from "./CandleChartPanel";

export default function LiveChart({
  title,
  venue,
  symbol,
  ticks,
  referenceLines,
}: {
  title: string;
  venue: string | null;
  symbol: string | null;
  ticks: Tick[];
  referenceLines?: readonly { price: number; title: string }[];
}) {
  const loadCandles = useCallback(
    (interval: CandleInterval, signal: AbortSignal, indicators: readonly string[]) => {
      if (!venue || !symbol) return Promise.reject(new Error("Select an instrument."));
      return fetchCandles(venue, symbol, interval, fetch, signal, indicators);
    },
    [symbol, venue],
  );

  return (
    <CandleChartPanel
      title={title}
      venue={venue}
      symbol={symbol}
      referenceLines={referenceLines}
      loadCandles={venue && symbol ? loadCandles : undefined}
      ticks={ticks}
      venueName={venue ? venueLabel(venue) : undefined}
      showTradeCount
    />
  );
}
