"use client";

import { useMemo } from "react";
import { formatCompact, venueLabel } from "@/lib/markets/labels";
import { candlePricePrecision, formatCandlePrice } from "@/lib/markets/chartPrices";
import { OFF_PEG_PCT, STABLECOINS, summarizeStablecoins, type StablecoinSummary } from "@/lib/markets/stablecoins";
import type { InstrumentRow, MarketsState, Tick } from "@/lib/markets/state";
import { Section } from "@/components/finance/ui";
import LiveChart from "./LiveChart";
import NewsSection from "./NewsSection";

function stablecoinSummaryLine(summary: StablecoinSummary | undefined): string {
  if (!summary || summary.coverage === "stale") return "No fresh exchange prices are available.";
  if (summary.coverage === "no_usd_pair") {
    const quotes = Array.from(new Set(summary.otherQuoteReadings.filter((reading) => reading.fresh).map((reading) => reading.quote)));
    if (quotes.length === 1) return `Only priced against ${quotes[0]} on the exchanges we cover`;
    if (quotes.length > 1) return `Only priced against ${quotes.join(" and ")} on the exchanges we cover`;
    return "No $1 market is available on the exchanges we cover.";
  }
  if (summary.freshUsdVenueCount === 1) return "Only 1 exchange, so we can't cross-check it";
  if (summary.crossMarketDeviationPct === null) return "No fresh exchange prices are available.";
  const deviation = summary.crossMarketDeviationPct;
  if (Math.abs(deviation) < OFF_PEG_PCT - 1e-10) {
    return `Near its $1 target, checked on ${summary.freshUsdVenueCount} exchanges`;
  }
  return `${Math.abs(deviation).toFixed(2)}% ${deviation < 0 ? "below" : "above"} its $1 target, checked on ${summary.freshUsdVenueCount} exchanges`;
}

function priceFor(row: InstrumentRow): string {
  const value = row.last.price;
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const precision = candlePricePrecision([{ low: value }]);
  const price = formatCandlePrice(value, precision);
  return row.last.quote_asset.toUpperCase() === "USD" ? `$${price}` : `${price} ${row.last.quote_asset.toUpperCase()}`;
}

function exchangePrices(rows: InstrumentRow[]): InstrumentRow[] {
  const preferredByVenue = new Map<string, InstrumentRow>();
  for (const row of rows) {
    const quote = row.last.quote_asset.toUpperCase();
    if (row.kind !== "spot" || (quote !== "USD" && quote !== "USDT")) continue;
    const previous = preferredByVenue.get(row.venue);
    const quoteRank = quote === "USD" ? 0 : 1;
    const previousQuoteRank = previous?.last.quote_asset.toUpperCase() === "USD" ? 0 : 1;
    if (
      !previous ||
      quoteRank < previousQuoteRank ||
      (quoteRank === previousQuoteRank && Date.parse(row.last.exchange_timestamp) > Date.parse(previous.last.exchange_timestamp))
    ) {
      preferredByVenue.set(row.venue, row);
    }
  }
  return [...preferredByVenue.values()].sort((a, b) => venueLabel(a.venue).localeCompare(venueLabel(b.venue)));
}

export default function SimpleCryptoAssetView({
  base,
  rows,
  preferredRow,
  ticks,
  marketState,
  referenceLines,
}: {
  base: string;
  rows: InstrumentRow[];
  preferredRow: InstrumentRow | null;
  ticks: Tick[];
  marketState: Pick<MarketsState, "instruments" | "quotes">;
  referenceLines?: readonly { price: number; title: string }[];
}) {
  const isStablecoin = STABLECOINS.includes(base as (typeof STABLECOINS)[number]);
  const summary = useMemo(
    () => summarizeStablecoins(marketState, Date.now()).find((item) => item.base === base),
    [base, marketState],
  );
  const priceRows = useMemo(() => exchangePrices(rows), [rows]);
  const summaryLine = isStablecoin
    ? stablecoinSummaryLine(summary)
    : preferredRow
      ? `Live price from ${venueLabel(preferredRow.venue)}. Tracked on ${rows.length} markets across ${new Set(rows.map((row) => row.venue)).size} exchanges.`
      : "No recent exchange price is available.";

  return (
    <>
      <div className="mt-4">
        {preferredRow ? (
          <>
            <p className="text-[34px] font-semibold leading-tight tracking-tight text-ink sm:text-[40px]">
              {priceFor(preferredRow)}
            </p>
            <p className="mt-1 text-[13px] text-ink-2">{summaryLine}</p>
          </>
        ) : (
          <p className="text-[14px] text-ink-2">{summaryLine}</p>
        )}
        <p className="mt-2 text-[11.5px] text-ink-3">
          Measured market data only, not investment advice. No trading, wallets or custody.
        </p>
      </div>

      <Section id="simple-crypto-chart" title="Price history">
        <LiveChart
          title={preferredRow ? `${preferredRow.symbol} on ${venueLabel(preferredRow.venue)}` : `${base} · no recent trade`}
          venue={preferredRow?.venue ?? null}
          symbol={preferredRow?.symbol ?? null}
          ticks={ticks}
          referenceLines={referenceLines}
          showIndicators={false}
          simple
        />
      </Section>

      <Section id="simple-crypto-exchanges" title="Price on each exchange" count={priceRows.length}>
        {priceRows.length > 0 ? (
          <div className="divide-y divide-line rounded-[10px] bg-surface shadow-card">
            {priceRows.map((row) => (
              <div key={row.venue} className="flex items-center justify-between gap-4 px-3 py-2.5 text-[12.5px]">
                <span className="text-ink-2">{venueLabel(row.venue)}</span>
                <span className="font-mono tabular-nums text-ink">{priceFor(row)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
            No spot USD or USDT market prices are available.
          </p>
        )}
      </Section>

      {isStablecoin && summary?.depthUsd10bps !== null && summary?.depthUsd10bps !== undefined && (
        <section className="mt-6 rounded-[10px] bg-surface px-3.5 py-3 shadow-card" aria-label="Market depth near this price">
          <p className="text-[13px] font-medium text-ink">
            Money waiting to trade near this price: ${formatCompact(summary.depthUsd10bps)}
          </p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            Buy and sell orders within 0.1% of the price, across exchanges.
          </p>
        </section>
      )}

      <h2 className="mt-8 text-[14px] font-semibold text-ink">Latest news</h2>
      <NewsSection
        title={`${base} events`}
        feed="news"
        symbol={base}
        kinds={["market_event"]}
        currentAsset={{ kind: "crypto", symbol: base }}
      />
      <NewsSection title="Regulator releases" feed="news" kinds={["official"]} limit={3} />
    </>
  );
}
