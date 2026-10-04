"use client";

/* Markets page: backend-normalized public data, shadow classifiers and gate state. */

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import PageHeader from "@/components/finance/PageHeader";
import { Notice, Section } from "@/components/finance/ui";
import type { StreamStatus } from "@/lib/markets/client";
import { formatClock, formatCompact, formatMs, formatQuote, venueLabel } from "@/lib/markets/labels";
import { spreadBps } from "@/lib/markets/metrics";
import { classificationsFor, instrumentKey, instrumentRows, type InstrumentRow } from "@/lib/markets/state";
import { watchlistAlertsEnabled } from "@/lib/markets/features";
import type { MarketEvent } from "@/lib/markets/types";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useWatchlist } from "@/lib/markets/useWatchlist";
import AlertsPanel from "./AlertsPanel";
import GatePanel from "./GatePanel";
import LiveChart from "./LiveChart";
import { DerivativesPanel, LiquidationsPanel, type DerivativeRow } from "./MarketDataPanels";
import SignalBoard from "./SignalBoard";

const STREAM_LABEL: Record<StreamStatus, { label: string; tone: "green" | "orange" | "red" }> = {
  connecting: { label: "Connecting", tone: "orange" },
  live: { label: "Live", tone: "green" },
  reconnecting: { label: "Reconnecting", tone: "orange" },
  closed: { label: "Stream closed", tone: "red" },
};

const PREFERRED = ["coinbase|BTC-USD", "kraken|BTC-USD"];

function depthCell(event: MarketEvent | undefined, bid: number | null | undefined, ask: number | null | undefined) {
  if (!event) return "—";
  return (
    <>
      <span>Bid {formatCompact(bid)} · Ask {formatCompact(ask)}</span>
      {event.depth_levels != null && event.depth_levels <= 5 && (
        <span className="block text-[10px] text-ink-3">top 5 levels</span>
      )}
    </>
  );
}

function InstrumentTable({
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
            {watchlistEnabled && (
              <th className="px-2 py-2 font-medium"><span className="sr-only">Watchlist</span></th>
            )}
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
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">
                  {spread === null ? "—" : spread.toFixed(2)}
                </td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-2">
                  {depthCell(quote, quote?.bid_depth_10bps, quote?.ask_depth_10bps)}
                </td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-2">
                  {depthCell(quote, quote?.bid_depth_50bps, quote?.ask_depth_50bps)}
                </td>
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

export default function MarketsView() {
  const featuresEnabled = watchlistAlertsEnabled();
  const { state, snapshot, snapshotError, gate, gateError, stream, reload } = useMarkets();
  const searchParams = useSearchParams();
  const queryInstrument = searchParams.get("instrument");
  const [picked, setPicked] = useState<string | null>(null);
  const previousQueryInstrument = useRef(queryInstrument);
  const [instrumentFilter, setInstrumentFilter] = useState<"all" | "watchlist">("all");
  const watchlist = useWatchlist();
  useEffect(() => {
    if (previousQueryInstrument.current === queryInstrument) return;
    previousQueryInstrument.current = queryInstrument;
    setPicked(null);
  }, [queryInstrument]);
  const rows = useMemo(() => instrumentRows(state), [state]);
  const visibleRows = useMemo(
    () =>
      featuresEnabled && instrumentFilter === "watchlist"
        ? rows.filter((row) => watchlist.keys.includes(row.key))
        : rows,
    [featuresEnabled, instrumentFilter, rows, watchlist.keys],
  );
  const derivativeRows = useMemo<DerivativeRow[]>(() => {
    const pairs = new Map<string, { venue: string; symbol: string }>();
    for (const row of rows) if (row.kind === "perpetual") pairs.set(row.key, { venue: row.venue, symbol: row.symbol });
    for (const [key, item] of Object.entries(state.derivatives)) {
      if (item.kind === "perpetual") pairs.set(key, { venue: item.venue, symbol: item.symbol });
    }
    const perpetualSymbols = (snapshot?.symbols ?? []).filter((symbol) => symbol.endsWith("-PERP"));
    const derivativeVenues = (snapshot?.enabled_venues ?? []).filter((venue) => venue === "bybit" || venue === "okx");
    for (const venue of derivativeVenues) {
      for (const symbol of perpetualSymbols) {
        pairs.set(instrumentKey(venue, symbol), { venue, symbol });
      }
    }
    return Array.from(pairs.entries())
      .map(([key, pair]) => ({ key, ...pair, data: state.derivatives[key] ?? null }))
      .sort((a, b) => a.venue.localeCompare(b.venue) || a.symbol.localeCompare(b.symbol));
  }, [rows, snapshot, state.derivatives]);
  const querySelected = queryInstrument && state.instruments[queryInstrument] ? queryInstrument : null;
  const selected = picked ?? querySelected ?? PREFERRED.find((key) => state.instruments[key]) ?? rows[0]?.key ?? null;
  const selectedRow = selected ? state.instruments[selected] : undefined;
  const pegs = useMemo(() => classificationsFor(state, "stablecoin_peg"), [state]);
  const momentum = useMemo(() => classificationsFor(state, "short_horizon_momentum"), [state]);
  const status = STREAM_LABEL[stream];
  const venues = snapshot?.enabled_venues ?? [];

  return (
    <>
      <PageHeader
        title="Markets"
        actions={
          <StatusPill tone={status.tone} className="h-6 text-[12px]">
            {status.label}
          </StatusPill>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Crypto markets</h1>
          <p className="mt-2 max-w-[720px] text-[14px] leading-[1.6] text-ink-2">
            Market states and probabilities only, not investment advice. No trading, wallets or custody.
          </p>
          <p className="mt-2 max-w-[720px] text-[14px] leading-[1.6] text-ink-2">
            Live public market data {venues.length > 0 ? `from ${venues.map(venueLabel).join(", ")} ` : ""}normalized by the crypto backend.
          </p>

          {snapshotError && (
            <div className="mt-6">
              <Notice
                kind="error"
                role="alert"
                title="The crypto backend could not be read."
                actions={
                  <Button variant="secondary" size="xs" onClick={reload}>
                    <RefreshCw size={12} aria-hidden />
                    Try again
                  </Button>
                }
              >
                {snapshotError.message} <span className="font-mono text-ink-3">{snapshotError.code}</span>
              </Notice>
            </div>
          )}

          <Section id="tape" title={selectedRow ? `${selectedRow.symbol} · ${venueLabel(selectedRow.venue)}` : "Live tape"}>
            <LiveChart
              title={
                selectedRow
                  ? `${selectedRow.symbol} on ${venueLabel(selectedRow.venue)}`
                  : "No instrument yet"
              }
              venue={selectedRow?.venue ?? null}
              symbol={selectedRow?.symbol ?? null}
              ticks={selected ? state.ticks[selected] ?? [] : []}
            />
          </Section>

          <Section id="instruments" title="Instruments" count={rows.length}>
            {featuresEnabled && (
              <div role="group" aria-label="Instrument filter" className="mb-2 flex gap-1">
                <button
                  type="button"
                  aria-pressed={instrumentFilter === "all"}
                  className="rounded-md px-2.5 py-1 text-[12px] text-ink-2 hover:bg-hover-2 aria-pressed:bg-inset aria-pressed:text-ink"
                  onClick={() => setInstrumentFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  aria-pressed={instrumentFilter === "watchlist"}
                  className="rounded-md px-2.5 py-1 text-[12px] text-ink-2 hover:bg-hover-2 aria-pressed:bg-inset aria-pressed:text-ink"
                  onClick={() => setInstrumentFilter("watchlist")}
                >
                  Watchlist ({watchlist.keys.length})
                </button>
              </div>
            )}
            {visibleRows.length > 0 ? (
              <InstrumentTable
                rows={visibleRows}
                quotes={state.quotes}
                selected={selected}
                watchlistEnabled={featuresEnabled}
                watchlistKeys={watchlist.keys}
                onToggleWatchlist={watchlist.toggle}
                onSelect={setPicked}
              />
            ) : featuresEnabled && instrumentFilter === "watchlist" && watchlist.keys.length === 0 ? (
              <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
                No instruments starred yet. Star a row to keep it here (saved in this browser only).
              </p>
            ) : featuresEnabled && instrumentFilter === "watchlist" ? (
              <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
                No watched instruments have reached the backend yet.
              </p>
            ) : (
              <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
                No trades have reached the backend yet.
              </p>
            )}
          </Section>

          {featuresEnabled && <AlertsPanel state={state} rows={rows} />}

          <Section id="derivatives" title="Derivatives" count={derivativeRows.length}>
            <DerivativesPanel rows={derivativeRows} />
          </Section>

          <Section id="liquidations" title="Liquidations" count={Math.min(state.liquidations.length, 20)}>
            <LiquidationsPanel events={state.liquidations} derivatives={state.derivatives} />
          </Section>

          <div className="mt-8">
            <Notice kind="warn" title="Shadow signals: not validated">
              These classifications have not passed the evaluation gate. They are shown for review with their evidence and
              probability, not as trusted signals or advice.
            </Notice>
            <p className="mt-2 text-[12px] text-ink-3">Market states and probabilities only; not investment advice.</p>
          </div>

          <Section id="pegs" title="Stablecoin peg" count={pegs.length}>
            <SignalBoard items={pegs} empty="No peg classification yet: it needs fresh trades from at least two venues." />
          </Section>

          <Section id="momentum" title="Short-horizon momentum" count={momentum.length}>
            <SignalBoard items={momentum} empty="No momentum classification yet: it needs 30 trades over at least 10 seconds." />
          </Section>

          <Section id="gate" title="Evaluation gate">
            {gateError ? (
              <Notice kind="error" role="alert" title="The evaluation gate could not be read.">
                {gateError.message}
              </Notice>
            ) : gate ? (
              <GatePanel gate={gate} />
            ) : (
              <p className="text-[12.5px] text-ink-3">Reading the evaluation gate…</p>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
