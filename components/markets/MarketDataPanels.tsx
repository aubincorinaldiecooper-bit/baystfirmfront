"use client";

import { basisBps } from "@/lib/markets/metrics";
import { formatClock, formatCompact, formatQuote, venueLabel } from "@/lib/markets/labels";
import { instrumentKey, type DerivativeState } from "@/lib/markets/state";
import type { MarketEvent } from "@/lib/markets/types";

export interface DerivativeRow {
  key: string;
  venue: string;
  symbol: string;
  data: DerivativeState | null;
}

function DerivativesPanel({ rows }: { rows: DerivativeRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">No funding update received yet</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
      <table className="w-full min-w-[900px] text-left text-[12.5px]">
        <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Instrument</th>
            <th className="px-2 py-2 font-medium">Venue</th>
            <th className="px-2 py-2 font-medium">Funding (% / interval)</th>
            <th className="px-2 py-2 font-medium">Next funding</th>
            <th className="px-2 py-2 text-right font-medium">Open interest</th>
            <th className="px-2 py-2 text-right font-medium">Value</th>
            <th className="px-2 py-2 text-right font-medium">Mark</th>
            <th className="px-2 py-2 text-right font-medium">Index</th>
            <th className="px-4 py-2 text-right font-medium">Basis (bps)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const data = row.data;
            const basis = basisBps(data?.mark_price, data?.index_price);
            const nextFunding = data?.next_funding_at ? formatClock(data.next_funding_at) : "";
            return (
              <tr key={row.key} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-mono text-ink">{row.symbol}</td>
                <td className="px-2 py-2 text-ink-2">{venueLabel(row.venue)}</td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-2">
                  {data?.funding_rate == null ? "No funding update received yet" : `${(data.funding_rate * 100).toFixed(4)}%`}
                </td>
                <td className="px-2 py-2 font-mono text-ink-2">{nextFunding || "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatCompact(data?.open_interest)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatCompact(data?.open_interest_value)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatQuote(data?.mark_price)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatQuote(data?.index_price)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-2">
                  {basis === null ? "—" : basis.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function liquidationSide(event: MarketEvent): string {
  if (event.venue === "bybit") return event.side === "buy" ? "buy · long" : "sell · short";
  const position = event.metadata.position_side;
  return typeof position === "string" ? `${event.side} · ${position} position` : event.side;
}

function notional(event: MarketEvent, derivatives: Record<string, DerivativeState>): number | null {
  if (typeof event.price !== "number" || typeof event.size !== "number") return null;
  const metadataMultiplier = event.metadata.contract_multiplier;
  const multiplier =
    typeof metadataMultiplier === "number"
      ? metadataMultiplier
      : derivatives[instrumentKey(event.venue, event.symbol)]?.contract_multiplier;
  if (event.venue === "okx" && event.instrument_kind === "perpetual" && multiplier == null) return null;
  return event.price * event.size * (multiplier ?? 1);
}

function LiquidationsPanel({
  events,
  derivatives,
}: {
  events: MarketEvent[];
  derivatives: Record<string, DerivativeState>;
}) {
  const newest = events.slice(0, 20);
  if (newest.length === 0) {
    return (
      <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
        No liquidations received since this page opened.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
      <table className="w-full min-w-[760px] text-left text-[12.5px]">
        <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Time (UTC)</th>
            <th className="px-2 py-2 font-medium">Venue</th>
            <th className="px-2 py-2 font-medium">Instrument</th>
            <th className="px-2 py-2 font-medium">Side</th>
            <th className="px-2 py-2 text-right font-medium">Size</th>
            <th className="px-2 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Notional</th>
          </tr>
        </thead>
        <tbody>
          {newest.map((event) => (
            <tr key={event.event_id} className="border-b border-line last:border-0">
              <td className="px-4 py-2 font-mono text-ink-3">{formatClock(event.exchange_timestamp) || "—"}</td>
              <td className="px-2 py-2 text-ink-2">{venueLabel(event.venue)}</td>
              <td className="px-2 py-2 font-mono text-ink">{event.symbol}</td>
              <td className="px-2 py-2 text-ink-2">{liquidationSide(event)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatCompact(event.size)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-2">{formatQuote(event.price)}</td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-2">
                {formatCompact(notional(event, derivatives))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { DerivativesPanel, LiquidationsPanel };
