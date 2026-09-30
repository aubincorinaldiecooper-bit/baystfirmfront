"use client";

/* The Symbol tab: the watchlist (saved in this browser only, as the snapshot
 * taken when Watch was clicked) and the symbol's detail: its identity, the
 * last close when a price series exists, the latest kept headline, the
 * performance tiles, key stats from the backend's calculations, and the data
 * sources behind the figures. Prices are never presented as live. */

import { useMemo } from "react";
import { ChevronRight, Star, X, Zap } from "lucide-react";
import { latestHeadline, type LiveSource } from "@/lib/analysis/activity";
import type { AnalysisViewState } from "@/lib/analysis/reducer";
import type { CalculationLike } from "@/lib/market/keyStats";
import { keyStats } from "@/lib/market/keyStats";
import { formatDay, formatPct, formatPrice, formatSigned, monogram } from "@/lib/market/format";
import type { MarketData, SymbolIdentity } from "@/lib/market/model";
import { lastClose, performanceTiles, toBars } from "@/lib/market/series";
import type { WatchEntry } from "@/lib/market/watchlist";
import { cn } from "@/lib/utils";
import { Monogram, signClass, sourceTone } from "./controls";
import { PerformanceTiles } from "./MainWindow";

interface Row {
  symbol: string;
  name: string;
  last: number | null;
  change: number | null;
  pct: number | null;
  asOf: string | null;
  highlight: boolean;
  saved: WatchEntry | null;
}

const GRID = "grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-center gap-2";

function WatchRow({ row, onRemove }: { row: Row; onRemove?: (entry: WatchEntry) => void }) {
  return (
    <li className={cn(GRID, "mx-2 rounded-[8px] p-2", row.highlight && "bg-hover")}>
      <div className="flex min-w-0 items-center gap-2">
        <Monogram letter={monogram(row.symbol)} tone="filing" size="sm" round />
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold text-ink">{row.symbol}</span>
          <span className="truncate text-[11.5px] text-ink-2">{row.asOf ? `${row.name !== row.symbol ? `${row.name} · ` : ""}as of ${formatDay(row.asOf)}` : row.name !== row.symbol ? row.name : ""}</span>
        </div>
      </div>
      <span className="text-right font-mono text-[12.5px] text-ink">
        <span className="sr-only">Last </span>
        {row.last === null ? "—" : formatPrice(row.last)}
      </span>
      <span className={cn("text-right font-mono text-[12.5px]", signClass(row.change))}>
        <span className="sr-only">Change </span>
        {row.change === null ? "—" : formatSigned(row.change)}
      </span>
      <span className="flex items-center justify-end gap-1">
        <span className={cn("font-mono text-[12.5px]", signClass(row.pct))}>
          <span className="sr-only">Change percent </span>
          {row.pct === null ? "—" : formatPct(row.pct, 2)}
        </span>
        {onRemove && row.saved && (
          <button
            type="button"
            aria-label={`Remove ${row.symbol} from watchlist`}
            onClick={() => onRemove(row.saved as WatchEntry)}
            className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-2 transition-colors duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}

export default function SymbolPanel({
  state,
  identity,
  market,
  sources,
  watchlist,
  watched,
  onWatch,
  onRemove,
  onPickSource,
}: {
  state: AnalysisViewState;
  identity: SymbolIdentity | null;
  market: MarketData;
  sources: Map<string, LiveSource>;
  watchlist: readonly WatchEntry[];
  watched: boolean;
  onWatch: (() => void) | null;
  onRemove: (entry: WatchEntry) => void;
  onPickSource: (sourceId: string) => void;
}) {
  const { bars, series, fundamentals } = market;
  const close = lastClose(bars);
  const tiles = useMemo(() => performanceTiles(bars), [bars]);
  const headline = useMemo(() => latestHeadline(sources.values()), [sources]);

  /* the backend's calculations, streamed then settled by the result */
  const calculations: CalculationLike[] = [...state.calculations.items, ...(state.result?.calculations ?? [])];
  const stats = keyStats(calculations, bars.length > 0 ? bars : null);

  /* this analysis's own series, with their last close */
  const inAnalysis: Row[] = series.map((s) => {
    const c = lastClose(toBars(s.points));
    return {
      symbol: s.symbol,
      name: s.name?.trim() || s.symbol,
      last: c?.close ?? null,
      change: c?.change ?? null,
      pct: c?.pct ?? null,
      asOf: null,
      highlight: s.role === "company",
      saved: null,
    };
  });
  if (identity && !inAnalysis.some((r) => r.symbol === identity.symbol)) {
    inAnalysis.unshift({ symbol: identity.symbol, name: identity.name, last: null, change: null, pct: null, asOf: null, highlight: true, saved: null });
  }
  const saved: Row[] = watchlist.map((entry) => {
    const current = inAnalysis.find((r) => r.symbol === entry.symbol && r.last !== null);
    return current
      ? { ...current, highlight: false, saved: entry }
      : { symbol: entry.symbol, name: entry.name || entry.symbol, last: entry.last_close, change: null, pct: entry.change_pct, asOf: entry.last_close !== null ? entry.as_of : null, highlight: false, saved: entry };
  });
  const anyPrice = [...inAnalysis, ...saved].some((r) => r.last !== null);

  const dataSourceIds = [...new Set([...series.map((s) => s.source_id), ...(fundamentals?.source_ids ?? [])])];
  const dataSources = dataSourceIds.map((id) => sources.get(id)).filter((s): s is LiveSource => Boolean(s));

  return (
    <div className="flex flex-col">
      <h2 className="px-4 pb-0.5 pt-3 text-[13px] font-semibold text-ink">Watchlist</h2>
      <div className={cn(GRID, "px-4 pb-1.5 pt-2.5 text-[11.5px] text-ink-2")} aria-hidden>
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span className="text-right">Chg%</span>
      </div>
      <h3 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2">Your watchlist</h3>
      {saved.length === 0 ? (
        <p className="px-4 pb-2.5 pt-1.5 text-[12.5px] text-ink-2">Nothing saved yet. Use Watch to add the symbol here.</p>
      ) : (
        <ul aria-label="Your watchlist" className="flex flex-col">
          {saved.map((row) => (
            <WatchRow key={row.symbol} row={row} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <h3 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2">In this analysis</h3>
      {inAnalysis.length === 0 ? (
        <p className="px-4 pb-2.5 pt-1.5 text-[12.5px] text-ink-2">The company appears here once it is identified.</p>
      ) : (
        <ul aria-label="In this analysis" className="flex flex-col">
          {inAnalysis.map((row) => (
            <WatchRow key={row.symbol} row={row} />
          ))}
        </ul>
      )}

      {identity && (
        <div className="mt-3 flex flex-col gap-3 border-t border-line px-4 pb-4 pt-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Monogram letter={monogram(identity.symbol)} tone="filing" size="lg" round />
              <div className="flex min-w-0 flex-col gap-px">
                <span className="text-[15px] font-semibold text-ink">{identity.symbol}</span>
                <span className="truncate text-[12px] text-ink-2">{[identity.name !== identity.symbol ? identity.name : null, identity.exchange].filter(Boolean).join(" · ") || "Company name not reported"}</span>
              </div>
            </div>
            <button
              type="button"
              aria-pressed={watched}
              aria-label={`Watch ${identity.symbol}`}
              disabled={!onWatch}
              onClick={onWatch ?? undefined}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-line-strong text-ink transition-colors duration-150 disabled:opacity-50",
                watched ? "bg-hover-2" : "bg-surface hover:bg-hover",
              )}
            >
              <Star size={14} aria-hidden fill={watched ? "currentColor" : "none"} />
            </button>
          </div>
          {identity.sector && <div className="text-[12px] text-ink-2">{identity.sector}</div>}

          {close ? (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[28px] font-semibold tracking-tight text-ink tabular-nums">{formatPrice(close.close)}</span>
                {market.company?.currency && <span className="text-[12px] text-ink-2">{market.company.currency}</span>}
                {close.change !== null && close.pct !== null && (
                  <span className={cn("text-[14px] font-semibold", signClass(close.change))}>
                    {formatSigned(close.change)} ({formatPct(close.pct, 2)})
                  </span>
                )}
              </div>
              <div className="text-[12px] text-ink-2">Last close {formatDay(close.date)} · daily data, not live</div>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-2">{"No price is shown: this analysis's research comes from web search, which doesn't include a daily price series."}</p>
          )}

          {headline && (
            <button
              type="button"
              onClick={() => onPickSource(headline.source_id)}
              className="flex items-center gap-2 rounded-[10px] bg-accent-tint px-3 py-2.5 text-left text-ink transition-colors duration-150 hover:bg-hover-2"
            >
              <Zap size={14} aria-hidden className="shrink-0 text-accent-text" />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                <span className="text-ink-2">{formatDay(headline.published_at)} · </span>
                {headline.title}
                {headline.publisher ? ` (${headline.publisher})` : ""}
              </span>
              <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-2" />
            </button>
          )}

          {close && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[12.5px] font-semibold text-ink">Performance</h3>
              <PerformanceTiles tiles={tiles} columns={3} />
            </div>
          )}

          <div className="flex flex-col">
            <h3 className="pb-1 text-[12.5px] font-semibold text-ink">Key stats</h3>
            {stats.length === 0 ? (
              <p className="py-1 text-[12.5px] text-ink-2">None of the key figures was calculated for this analysis.</p>
            ) : (
              <dl>
                {stats.map((stat) => (
                  <div key={stat.key} className="flex justify-between gap-2 border-b border-line py-[7px]">
                    <dt className="text-[12.5px] text-ink-2">{stat.label}</dt>
                    <dd className="text-right text-[12.5px] font-medium text-ink">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {dataSources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
              <span>Data</span>
              {dataSources.map((source) => (
                <button
                  key={source.source_id}
                  type="button"
                  onClick={() => onPickSource(source.source_id)}
                  aria-label={`Show source: ${source.title}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] border border-line bg-inset py-px pl-[3px] pr-1.5 font-mono text-[11.5px] text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink"
                >
                  <Monogram letter={monogram(source.publisher ?? source.domain)} tone={sourceTone(source.source_type)} size="xs" />
                  <span className="truncate">{[source.domain, source.title].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-auto border-t border-line px-4 py-2.5 text-[11.5px] leading-normal text-ink-2">
        {anyPrice ? "Prices are the last daily close, not live quotes." : "No prices are shown: research uses web search results only, which don't include price series."}
      </p>
    </div>
  );
}
