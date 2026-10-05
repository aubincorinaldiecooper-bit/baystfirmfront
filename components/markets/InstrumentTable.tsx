"use client";

import { Star } from "lucide-react";
import { formatClock, formatCompact, formatMs, formatQuote, venueLabel } from "@/lib/markets/labels";
import { spreadBps } from "@/lib/markets/metrics";
import type { InstrumentRow } from "@/lib/markets/state";
import type { MarketEvent } from "@/lib/markets/types";

function depthCell(event: MarketEvent | undefined, bid: number | null | undefined, ask: number | null | undefined) {
  if (!event) return "—";
  return (
    <>
      <span>Bid {formatCompact(bid)} · Ask {formatCompact(ask)}</span>
      {event.depth_levels != null && event.depth_levels <= 5 && <span className="block text-[10px] text-ink-3">top 5 levels</span>}
    </>
  );
}

export default function InstrumentTable({
  rows,
  quotes,
  selected,
  watchlistEnabled,
  watchlistKeys,
  onToggleWatchlist,
  onSelect,
}: {
  rows: InstrumentRow[];
  quotes: Record<string, MarketEvent>;
  selected: string | null;
  watchlistEnabled: boolean;
  watchlistKeys: string[];
  onToggleWatchlist: (key: string) => void;
  onSelect: (key: string) => void;
}) {
  const watched = new Set(watchlistKeys);
  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
      <table className="w-full min-w-[1120px] text-left text-[12.5px]">
        <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
          <tr className="border-b border-line">
            {watchlistEnabled && <th className="px-2 py-2 font-medium"><span className="sr-only">Watchlist</span></th>}
            <th className="px-4 py-2 font-medium">Instrument</th>
            <th className="px-2 py-2 font-medium">Venue</th>
            <th className="px-2 py-2 font-medium">Kind</th>
            <th className="px-2 py-2 text-right font-medium">Last</th>
            <th className="px-2 py-2 text-right font-medium">Bid</th>
            <th className="px-2 py-2 text-right font-medium">Ask</th>
            <th className="px-2 py-2 text-right font-medium">Spread (bps)</th>
            <th className="px-2 py-2 font-medium">Depth ±10 bps (notional)</th>
            <th className="px-2 py-2 font-medium">Depth ±50 bps (notional)</th>
            <th className="px-2 py-2 font-medium">Side</th>
            <th className="px-2 py-2 text-right font-medium">Feed latency</th>
            <th className="px-2 py-2 text-right font-medium">Streamed</th>
            <th className="px-4 py-2 font-medium">Exchange time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const quote = quotes[row.key];
            const spread = quote ? spreadBps(quote.bid, quote.ask) : null;
            return (
              <tr
                key={row.key}
                onClick={() => onSelect(row.key)}
                aria-selected={row.key === selected}
                className={`cursor-pointer border-b border-line last:border-0 ${row.key === selected ? "bg-accent-tint" : "hover:bg-hover-2"}`}
              >
                {watchlistEnabled && (
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-pressed={watched.has(row.key)}
                      aria-label={
                        watched.has(row.key)
                          ? `Remove ${row.symbol} on ${venueLabel(row.venue)} from watchlist`
                          : `Add ${row.symbol} on ${venueLabel(row.venue)} to watchlist`
                      }
                      className="inline-flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover-2 hover:text-ink"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleWatchlist(row.key);
                      }}
                    >
                      <Star size={15} aria-hidden fill={watched.has(row.key) ? "currentColor" : "none"} />
                    </button>
                  </td>
                )}
                <td className="px-4 py-2 font-mono text-ink">{row.symbol}</td>
                <td className="px-2 py-2 text-ink-2">{venueLabel(row.venue)}</td>
                <td className="px-2 py-2 text-ink-2">{row.kind}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink">{formatQuote(row.last.price)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatQuote(quote?.bid)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatQuote(quote?.ask)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{spread === null ? "—" : spread.toFixed(2)}</td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-2">{depthCell(quote, quote?.bid_depth_10bps, quote?.ask_depth_10bps)}</td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-2">{depthCell(quote, quote?.bid_depth_50bps, quote?.ask_depth_50bps)}</td>
                <td className={`px-2 py-2 ${row.last.side === "buy" ? "text-green" : row.last.side === "sell" ? "text-red" : "text-ink-3"}`}>
                  {row.last.side}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatMs(row.latencyMs)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-3">{row.streamed}</td>
                <td className="px-4 py-2 font-mono text-ink-3">{formatClock(row.last.exchange_timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
