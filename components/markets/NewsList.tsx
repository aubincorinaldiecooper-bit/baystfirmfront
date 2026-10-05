"use client";

import Link from "next/link";
import type { NewsItem } from "@/lib/markets/types";
import { formatAge, SOLANA_MINT } from "@/lib/markets/tokens";

export const NEWS_NOTE =
  "Headlines link to the original publisher. Market and token events are measured by Baystfirm from exchange and on-chain data. Facts, not investment advice.";

const KIND_LABELS: Record<NewsItem["kind"], string> = {
  official: "Regulator",
  filing: "SEC filing",
  market_event: "Market event",
  token_event: "Token event",
};

type CurrentAsset = { kind: "crypto" | "token"; symbol: string };

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function ownEventHref(item: NewsItem, currentAsset?: CurrentAsset): string | null {
  const symbol = item.symbols[0];
  if (item.kind === "market_event" && symbol && /^[A-Za-z0-9.-]{1,10}$/.test(symbol)) {
    if (currentAsset?.kind === "crypto" && currentAsset.symbol.toUpperCase() === symbol.toUpperCase()) return null;
    return `/crypto/${encodeURIComponent(symbol.toUpperCase())}`;
  }
  if (item.kind === "token_event" && symbol && SOLANA_MINT.test(symbol)) {
    if (currentAsset?.kind === "token" && currentAsset.symbol === symbol) return null;
    return `/tokens/${encodeURIComponent(symbol)}`;
  }
  return null;
}

function crossMarketSummary(item: NewsItem): string | null {
  if (item.kind !== "market_event") return null;
  const readings = item.details.venue_readings;
  const crossMarketMedian = item.details.cross_market_median;
  if (!Array.isArray(readings) || typeof crossMarketMedian !== "number" || !Number.isFinite(crossMarketMedian)) {
    return null;
  }
  const venues = readings.flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const reading = value as Record<string, unknown>;
    if (typeof reading.venue !== "string" || typeof reading.median_price !== "number" || !Number.isFinite(reading.median_price)) {
      return [];
    }
    return [`${reading.venue} ${reading.median_price.toFixed(4)}`];
  });
  return venues.length > 0 ? `${venues.join(" · ")} · cross-market ${crossMarketMedian.toFixed(4)}` : null;
}

export default function NewsList({
  items,
  loading = false,
  error = null,
  emptyMessage = "No events yet",
  note = NEWS_NOTE,
  currentAsset,
}: {
  items: NewsItem[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  note?: string;
  currentAsset?: CurrentAsset;
}) {
  return (
    <div>
      {loading && items.length === 0 && <p role="status" className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Loading news and events…</p>}
      {error && items.length === 0 && <p role="alert" className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-2 shadow-card">News could not be loaded. {error}</p>}
      {!loading && !error && items.length === 0 && <p role="status" className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">{emptyMessage}</p>}
      {error && items.length > 0 && <p role="status" className="mb-2 text-[11.5px] text-ink-3">Some news could not be loaded: {error}</p>}
      {items.length > 0 && (
        <ul aria-label="News and events" className="divide-y divide-line rounded-[10px] bg-surface shadow-card">
          {items.map((item) => {
            const externalUrl = safeExternalUrl(item.url);
            const internalHref = externalUrl ? null : ownEventHref(item, currentAsset);
            const publishedAt = Date.parse(item.published_at);
            const absoluteTime = Number.isFinite(publishedAt) ? new Date(publishedAt).toLocaleString() : "Time unavailable";
            const crossMarket = crossMarketSummary(item);
            const headline = externalUrl ? (
              <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-accent hover:underline">
                {item.title}
              </a>
            ) : internalHref ? (
              <Link href={internalHref} className="font-medium text-ink hover:text-accent hover:underline">
                {item.title}
              </Link>
            ) : (
              <span className="font-medium text-ink">{item.title}</span>
            );
            return (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-inset px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2">{KIND_LABELS[item.kind]}</span>
                    <span className="text-[11.5px] text-ink-3">{item.source_label}</span>
                  </div>
                  <p className="text-[12.5px] leading-[1.5]">{headline}</p>
                  {crossMarket && <p className="mt-0.5 text-[10.5px] leading-[1.4] text-ink-3">{crossMarket}</p>}
                </div>
                <time dateTime={item.published_at} title={absoluteTime} className="shrink-0 pt-0.5 text-[11.5px] text-ink-3">
                  {formatAge(item.published_at, Date.now())}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-[1.5] text-ink-3">{note}</p>
    </div>
  );
}
