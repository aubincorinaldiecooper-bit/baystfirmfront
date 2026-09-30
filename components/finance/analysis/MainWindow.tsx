"use client";

/* The main window: the Company performance | Trading view switch, the range,
 * Table and Watch controls, the symbol row, and the chart area, with the live
 * research dock at the bottom. The chart area shows only what the backend
 * sent: price charts need a price series and the financials need quarterly
 * figures; without them it says so plainly (the current backend searches the
 * web only and sends neither). */

import { useMemo, useState, type ReactNode } from "react";
import { CandlestickChart, LineChart, Star, Table2 } from "lucide-react";
import { filingMarkers, type LiveSource } from "@/lib/analysis/activity";
import { isTerminalUiStatus, type AnalysisViewState } from "@/lib/analysis/reducer";
import { formatDay, formatPct, formatPrice, formatSigned, monogram } from "@/lib/market/format";
import { NO_PRICE_HISTORY, NO_QUARTERLY_FIGURES, type MarketData, type SymbolIdentity } from "@/lib/market/model";
import {
  aggregateCandles,
  compareSeries,
  INTERVAL_LABEL,
  lastClose,
  lastRows,
  performanceTiles,
  RANGE_INTERVAL,
  RANGE_KEYS,
  RANGE_ROWS,
  type RangeKey,
  type Tile,
} from "@/lib/market/series";
import { cn } from "@/lib/utils";
import CandleChart, { CandleTable, candlePeriod } from "./CandleChart";
import CompareChart, { CompareTable } from "./CompareChart";
import { Monogram, Segmented, signClass } from "./controls";
import Financials from "./Financials";

export type MainMode = "performance" | "trading";

export function ChartMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[180px] min-w-0 flex-1 items-center justify-center rounded-[8px] bg-inset px-6 py-8 text-center text-[13px] leading-relaxed text-ink-2">
      <p className="max-w-[420px]">{children}</p>
    </div>
  );
}

export function PerformanceTiles({ tiles, columns = 6 }: { tiles: readonly Tile[]; columns?: 3 | 6 }) {
  return (
    <ul aria-label="Performance" className={cn("grid gap-2", columns === 6 ? "grid-cols-3 @min-[560px]:grid-cols-6" : "grid-cols-3")}>
      {tiles.map((tile) => (
        <li
          key={tile.label}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-[8px] px-1 py-2",
            tile.pct === null ? "bg-hover" : tile.pct >= 0 ? "bg-green-tint" : "bg-red-tint",
          )}
        >
          <span className={cn("text-[14px] font-semibold tabular-nums", tile.pct === null ? "text-ink-2" : signClass(tile.pct))}>
            {tile.pct === null ? "—" : formatPct(tile.pct, 2)}
          </span>
          <span className="text-[11px] text-ink-2">{tile.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function MainWindow({
  state,
  identity,
  market,
  sources,
  mode,
  onMode,
  range,
  onRange,
  table,
  onTable,
  watched,
  onWatch,
  onPickSource,
  dock,
}: {
  state: AnalysisViewState;
  identity: SymbolIdentity | null;
  market: MarketData;
  sources: Map<string, LiveSource>;
  mode: MainMode;
  onMode: (mode: MainMode) => void;
  range: RangeKey;
  onRange: (range: RangeKey) => void;
  table: boolean;
  onTable: () => void;
  watched: boolean;
  onWatch: (() => void) | null;
  onPickSource: (sourceId: string) => void;
  dock: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { bars, series, company, fundamentals } = market;
  const hasPrices = bars.length > 0;
  const interval = RANGE_INTERVAL[range];
  const comparison = useMemo(() => compareSeries(series, range), [series, range]);
  const candles = useMemo(() => aggregateCandles(lastRows(bars, RANGE_ROWS[range]), interval), [bars, range, interval]);
  const tiles = useMemo(() => performanceTiles(bars), [bars]);
  const markers = useMemo(() => filingMarkers(sources.values()), [sources]);
  const close = lastClose(bars);
  const currency = company?.currency ?? "";
  const dataSource = company ? sources.get(company.source_id)?.publisher ?? null : null;
  const trading = mode === "trading";
  const tableAvailable = trading ? hasPrices : hasPrices || fundamentals !== null;

  const focusIndex = hover !== null && hover < candles.length ? hover : candles.length - 1;
  const focus = candles[focusIndex];
  const focusPrevious = focusIndex > 0 ? candles[focusIndex - 1].close : focus?.open;
  const focusChange = focus && focusPrevious !== undefined ? focus.close - focusPrevious : null;

  const symbolLine = identity
    ? (trading
        ? [identity.name !== identity.symbol ? identity.name : null, identity.exchange, hasPrices ? INTERVAL_LABEL[interval] : null, dataSource]
        : [identity.name !== identity.symbol ? identity.name : null, identity.exchange, identity.sector]
      )
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <section aria-label="Main window" className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="Main window view"
            value={mode}
            onChange={(next) => {
              setHover(null);
              onMode(next);
            }}
            options={[
              { value: "performance", label: (<><LineChart size={15} aria-hidden />Company performance</>) },
              { value: "trading", label: (<><CandlestickChart size={15} aria-hidden />Trading view</>) },
            ]}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmented
              label="Time range"
              size="sm"
              value={range}
              disabled={!hasPrices}
              onChange={(next) => {
                setHover(null);
                onRange(next);
              }}
              options={RANGE_KEYS.map((key) => ({ value: key, label: key }))}
            />
            <button
              type="button"
              aria-pressed={table}
              disabled={!tableAvailable}
              onClick={onTable}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-strong px-2.5 text-[12.5px] text-ink transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                table ? "bg-hover-2" : "bg-surface enabled:hover:bg-hover",
              )}
            >
              <Table2 size={14} aria-hidden />
              Table
            </button>
            <button
              type="button"
              aria-pressed={watched}
              aria-label={identity ? `Watch ${identity.symbol}` : "Watch"}
              disabled={!onWatch}
              onClick={onWatch ?? undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-strong px-2.5 text-[12.5px] text-ink transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                watched ? "bg-hover-2" : "bg-surface enabled:hover:bg-hover",
              )}
            >
              <Star size={14} aria-hidden fill={watched ? "currentColor" : "none"} />
              {watched ? "Watching" : "Watch"}
            </button>
          </div>
        </div>

        <div className="flex min-h-8 flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <div className="flex min-w-0 items-center gap-2 self-center">
            {identity ? (
              <>
                <Monogram letter={monogram(identity.symbol)} tone="filing" size="sm" round />
                <span className="text-[15px] font-semibold text-ink">{identity.symbol}</span>
                {symbolLine && <span className="truncate text-[12.5px] text-ink-2">{symbolLine}</span>}
              </>
            ) : (
              <span className="text-[13px] text-ink-2">{isTerminalUiStatus(state.status) ? "No company was identified" : "Identifying the company…"}</span>
            )}
          </div>
          {hasPrices && close && !trading && (
            <>
              <span className="text-[24px] font-semibold tracking-tight text-ink tabular-nums">{formatPrice(close.close)}</span>
              {currency && <span className="text-[12px] text-ink-2">{currency}</span>}
              {close.change !== null && close.pct !== null && (
                <span className={cn("text-[14px] font-semibold tabular-nums", signClass(close.change))}>
                  {formatSigned(close.change)} ({formatPct(close.pct, 2)})
                </span>
              )}
              <span className="text-[12px] text-ink-2">Last close {formatDay(close.date)} · daily data, not live</span>
            </>
          )}
          {hasPrices && trading && focus && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px] text-ink-2" aria-live="off">
              <span className="font-sans text-ink">
                {INTERVAL_LABEL[interval]} · {candlePeriod(focus, interval)}
              </span>
              {(
                [
                  ["O", focus.open],
                  ["H", focus.high],
                  ["L", focus.low],
                  ["C", focus.close],
                ] as const
              ).map(([label, value]) => (
                <span key={label}>
                  {label} <span className={signClass(focusChange)}>{formatPrice(value)}</span>
                </span>
              ))}
              {focusChange !== null && focusPrevious !== undefined && (
                <span className={signClass(focusChange)}>
                  {formatSigned(focusChange)} ({formatPct(((focus.close / focusPrevious) - 1) * 100, 2)})
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!trading && hasPrices && (
        <div className="shrink-0 px-4 pb-2">
          <PerformanceTiles tiles={tiles} />
        </div>
      )}

      <div className="flex min-h-[260px] flex-1 flex-col px-4 pb-3">
        {trading ? (
          hasPrices ? (
            table ? (
              <CandleTable candles={candles} interval={interval} symbol={identity?.symbol ?? company?.symbol ?? ""} />
            ) : (
              <CandleChart candles={candles} interval={interval} range={range} symbol={identity?.symbol ?? company?.symbol ?? ""} hover={hover} onHover={setHover} />
            )
          ) : (
            <ChartMessage>{NO_PRICE_HISTORY}</ChartMessage>
          )
        ) : hasPrices || fundamentals ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 @min-[640px]:flex-row">
            {hasPrices &&
              (table ? (
                <CompareTable comparison={comparison} range={range} />
              ) : (
                <CompareChart comparison={comparison} range={range} markers={markers} onPickSource={onPickSource} />
              ))}
            {fundamentals && (
              <div className={cn("flex min-w-0 flex-col", hasPrices ? "shrink-0 @max-[639px]:h-[200px] @min-[640px]:w-[280px]" : "flex-1")}>
                <Financials fundamentals={fundamentals} table={table} />
              </div>
            )}
          </div>
        ) : (
          <ChartMessage>{NO_QUARTERLY_FIGURES}</ChartMessage>
        )}
      </div>

      {dock}
    </section>
  );
}
