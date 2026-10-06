"use client";

import Link from "next/link";
import { Button } from "@/components/atoms/Button";
import { Notice } from "@/components/finance/ui";
import { assetName } from "@/lib/markets/labels";
import { headlinePrice, OFF_PEG_PCT, summarizeStablecoins } from "@/lib/markets/stablecoins";
import type { MarketsState } from "@/lib/markets/state";

function pegCoverage(summary: ReturnType<typeof summarizeStablecoins>[number] | undefined): string {
  if (!summary) return "No exchange data";
  if (summary.coverage === "no_usd_pair") return "No $1 market (priced in USDT)";
  if (summary.coverage === "stale") return "No fresh price";
  if (summary.crossMarketDeviationPct === null) return "—";
  const deviation = summary.crossMarketDeviationPct;
  if (Math.abs(deviation) < OFF_PEG_PCT - 1e-10) return "Near $1";
  return `${Math.abs(deviation).toFixed(2)}% ${deviation < 0 ? "below" : "above"} $1`;
}

function exchangesChecked(summary: ReturnType<typeof summarizeStablecoins>[number]): string {
  if (summary.coverage === "no_usd_pair") {
    const freshReadings = summary.otherQuoteReadings.filter((reading) => reading.fresh);
    const venueCount = new Set(freshReadings.map((reading) => reading.venue)).size;
    const quote = freshReadings[0]?.quote ?? summary.otherQuoteReadings[0]?.quote;
    return quote ? `${venueCount} (priced in ${quote})` : String(venueCount);
  }
  const count = summary.freshUsdVenueCount;
  return count === 1 ? "1 (can't cross-check)" : String(count);
}

function CoinName({ base }: { base: string }) {
  const name = assetName(base);
  return (
    <span className="min-w-0">
      <span className="font-semibold text-ink">{base}</span>
      {name && <span className="ml-2 text-[11.5px] text-ink-3">{name}</span>}
    </span>
  );
}

export default function SimpleStablecoinTable({
  marketState,
  snapshotLoaded,
  snapshotError,
  reload,
}: {
  marketState: Pick<MarketsState, "instruments" | "quotes">;
  snapshotLoaded: boolean;
  snapshotError: Error | null;
  reload: () => void;
}) {
  const summaries = summarizeStablecoins(marketState, Date.now());
  const coins = summaries
    .filter((summary) => summary.usdReadings.length > 0 || summary.otherQuoteReadings.length > 0)
    .map((summary) => ({ base: summary.base, summary }));

  return (
    <div className="mt-6">
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
      {!snapshotLoaded && summaries.length === 0 ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
          Waiting for exchange prices…
        </p>
      ) : snapshotLoaded && coins.length === 0 ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
          No recent stablecoin spot readings are available.
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-[10px] bg-surface shadow-card sm:block">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-[0.04em] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Coin</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">vs $1</th>
                  <th className="px-4 py-2 text-right font-medium">Exchanges checked</th>
                </tr>
              </thead>
              <tbody>
                {coins.map(({ base, summary }) => (
                  <tr key={base} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/crypto/${encodeURIComponent(base)}`} className="hover:text-accent">
                        <CoinName base={base} />
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
                      {summary ? headlinePrice(summary) : "—"}
                    </td>
                    <td className="px-3 py-3 text-ink-2">{pegCoverage(summary)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-2">
                      {exchangesChecked(summary)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {coins.map(({ base, summary }) => (
              <Link
                key={base}
                href={`/crypto/${encodeURIComponent(base)}`}
                className="block rounded-[10px] bg-surface p-3 shadow-card hover:bg-hover-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <CoinName base={base} />
                  <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink">
                    {summary ? headlinePrice(summary) : "—"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-2">
                  <span>
                    <span className="text-ink-3">vs $1:</span> {pegCoverage(summary)}
                  </span>
                  <span>
                    <span className="text-ink-3">Exchanges checked:</span> {exchangesChecked(summary)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
