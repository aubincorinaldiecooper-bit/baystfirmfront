"use client";

import Link from "next/link";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { Badge, Notice, Section } from "@/components/finance/ui";
import type { StreamStatus } from "@/lib/markets/client";
import { formatCompact, formatQuote, venueLabel } from "@/lib/markets/labels";
import { OFF_PEG_PCT, summarizeStablecoins } from "@/lib/markets/stablecoins";
import type { MarketsState } from "@/lib/markets/state";

const STREAM_STATUS: Record<StreamStatus, { label: string; tone: "orange" | "green" | "red" }> = {
  connecting: { label: "Connecting", tone: "orange" },
  live: { label: "Live", tone: "green" },
  reconnecting: { label: "Reconnecting", tone: "orange" },
  closed: { label: "Stream closed", tone: "red" },
};

function coverageLabel(coverage: string): string {
  if (coverage === "cross_checked") return "Cross-checked";
  if (coverage === "single_venue") return "One exchange · can't cross-check";
  if (coverage === "stale") return "No fresh exchange price";
  if (coverage === "no_usd_pair") return "Quoted vs USDT only";
  return "No data";
}

export default function StablecoinBoard({
  marketState,
  snapshotLoaded,
  snapshotError,
  stream,
  reload,
}: {
  marketState: Pick<MarketsState, "instruments" | "quotes">;
  snapshotLoaded: boolean;
  snapshotError: Error | null;
  stream: StreamStatus;
  reload: () => void;
}) {
  const summaries = summarizeStablecoins(marketState, Date.now());
  const status = STREAM_STATUS[stream];

  return (
    <Section
      id="stablecoin-board"
      title="Stablecoins — live from exchanges"
      count={summaries.length}
      aside={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
    >
      {snapshotError && (
        <div className="mb-3">
          <Notice
            kind="error"
            role="alert"
            title="The crypto backend could not be read."
            actions={
              <Button variant="secondary" size="xs" onClick={reload}>
                Try again
              </Button>
            }
          >
            {snapshotError.message}
          </Notice>
        </div>
      )}
      {summaries.length === 0 ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
          {snapshotLoaded ? "No recent stablecoin spot readings are available." : "Waiting for the exchange snapshot…"}
        </p>
      ) : (
        <div className="space-y-2">
          {summaries.map((summary) => {
            const deviation = summary.crossMarketDeviationPct;
            const significant = deviation !== null && Math.abs(deviation) >= OFF_PEG_PCT - 1e-10;
            const deviationTone =
              significant && deviation !== null
                ? deviation > 0
                  ? "text-green"
                  : "text-red"
                : "text-ink-2";
            const offPegVenues = new Set(summary.venuesOffPeg.map((reading) => reading.venue)).size;
            const readings = [...summary.usdReadings, ...summary.otherQuoteReadings];

            return (
              <article key={summary.base} className="rounded-[10px] bg-surface p-3 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <Link
                      href={`/crypto/${encodeURIComponent(summary.base)}`}
                      className="text-[13.5px] font-semibold text-ink hover:text-accent"
                    >
                      {summary.base}
                    </Link>
                    <p className="mt-1 font-mono text-[13px] tabular-nums text-ink">
                      {summary.crossMarketPrice === null
                        ? "—"
                        : `$${formatQuote(summary.crossMarketPrice)}`}
                      {summary.crossMarketPrice !== null && (
                        <span className={`ml-2 text-[11.5px] ${deviationTone}`}>
                          {deviation !== null && deviation > 0 ? "+" : ""}
                          {deviation?.toFixed(2)}%
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge tone={summary.coverage === "cross_checked" ? "green" : "neutral"}>
                      {coverageLabel(summary.coverage)}
                    </Badge>
                    {(summary.coverage === "cross_checked" || summary.coverage === "single_venue") && (
                      <span className="text-[10.5px] text-ink-3">
                        {offPegVenues}/{summary.freshUsdVenueCount} venues off by ≥{OFF_PEG_PCT}%
                      </span>
                    )}
                  </div>
                </div>
                {readings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-2">
                    {readings.map((reading) => (
                      <span
                        key={`${reading.venue}|${reading.symbol}`}
                        title={`${reading.source === "trade" ? "last trade" : "order-book mid"} · ${reading.at}`}
                        className="inline-flex items-center gap-1"
                      >
                        <span>
                          {venueLabel(reading.venue)}{" "}
                          {reading.quote === "USD" ? `$${formatQuote(reading.price)}` : `${formatQuote(reading.price)} ${reading.quote}`}
                        </span>
                        {!reading.fresh && <Badge tone="neutral">stale</Badge>}
                      </span>
                    ))}
                  </div>
                )}
                {summary.depthUsd10bps !== null && (
                  <p className="mt-2 text-[10.5px] text-ink-3">
                    Order-book depth ±0.1%: ${formatCompact(summary.depthUsd10bps)}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
