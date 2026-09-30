/**
 * Live research events (contract v1, web search only) for one synthetic run:
 * a web search whose hits are fetched and kept or rejected, a hit rejected by
 * its date without any request, a URL duplicate skipped before any request, a
 * failed search, a kept page whose terms forbid redistribution, a budget skip
 * after a request, and research completing. Plus optional market events,
 * which the current backend does not send, to cover the reducer's handling.
 * Test-only: the company, pages and figures are synthetic and never reach the
 * product.
 */

import type { AnalysisEvent, AnalysisEventOf, EventName, MarketSeries, PricePoint } from "@/lib/api/types";

export const LIVE_ID = "an_live0000000000a1";
const T0 = Date.parse("2026-09-27T10:00:00Z");

type Payload<N extends EventName> = Omit<AnalysisEventOf<N>, "event" | "analysis_id" | "seq" | "ts">;

let seq = 0;
function ev<N extends EventName>(event: N, data: Payload<N>): AnalysisEventOf<N> {
  seq += 1;
  return { event, analysis_id: LIVE_ID, seq, ts: new Date(T0 + seq * 1000).toISOString(), ...data } as unknown as AnalysisEventOf<N>;
}

export const URLS = {
  kept: "https://news.example.com/markets/example-holdings-outlook",
  paywalled: "https://paywall.example.org/story/example-holdings",
  late: "https://later.example.net/recap",
  duplicate: "https://news.example.com/markets/example-holdings-outlook-amp",
  metadataOnly: "https://blog.example.com/example-holdings-notes",
  budget: "https://extra.example.com/example-holdings",
  pending: "https://slow.example.com/example-holdings",
} as const;

const EXECUTION = { spark_mode: "managed", whisper_mode: "disabled", deployment: "local", search_configured: true };
const SEARCH_1 = "Example Holdings outlook";
const SEARCH_2 = "Example Holdings guidance";

export const LIVE_EVENTS: AnalysisEvent[] = [
  ev("analysis.started", {
    query: "Assess Example Holdings.",
    profile: "fast",
    resolved_horizon: "medium_term",
    as_of: "2026-09-27T10:00:00+00:00",
    execution: EXECUTION,
  }),
  ev("instrument.resolved", {
    symbol: "EXHL",
    exchange: "NASDAQ",
    name: "Example Holdings Inc.",
    cik: null,
    sector: "Example sector",
    resolution_method: "ticker",
    confidence: 1,
  }),
  ev("research.started", { round: 1, intents: ["retrieve_recent_news"], evidence_gaps: ["recent news"] }),
  ev("research.query", { intent: "retrieve_recent_news", kind: "search", query: SEARCH_1, label: "recent news for Example Holdings Inc.", round: 1 }),
  ev("research.search_results", {
    query: SEARCH_1,
    intent: "retrieve_recent_news",
    round: 1,
    total: 12,
    failed: false,
    hits: [
      { url: URLS.kept, title: "Example Holdings raises its outlook", domain: "news.example.com", published_at: "2026-09-20T00:00:00+00:00" },
      { url: URLS.paywalled, title: "Subscriber story on Example Holdings", domain: "paywall.example.org", published_at: null },
      { url: URLS.late, title: "Next month's recap", domain: "later.example.net", published_at: "2026-10-02T00:00:00+00:00" },
      { url: URLS.duplicate, title: "Example Holdings raises its outlook (AMP)", domain: "news.example.com", published_at: null },
      { url: "https://unvisited.example.com/", title: "An unvisited hit", domain: "unvisited.example.com", published_at: null },
    ],
  }),
  ev("research.fetching", { url: URLS.kept, domain: "news.example.com", kind: "web", label: null, intent: "retrieve_recent_news", round: 1 }),
  ev("research.fetching", { url: URLS.paywalled, domain: "paywall.example.org", kind: "web", label: null, intent: "retrieve_recent_news", round: 1 }),
  ev("research.source_found", {
    source_id: "src_kept",
    title: "Example Holdings raises its outlook",
    publisher: "Example News",
    source_type: "financial_journalism",
    published_at: "2026-09-20T00:00:00+00:00",
    retrieved_at: "2026-09-27T10:00:08+00:00",
    url: URLS.kept,
    fiscal_period: null,
    freshness: "current",
    is_primary: false,
    intent: "retrieve_recent_news",
    round: 1,
    domain: "news.example.com",
    fetch_ms: 1234,
    text_chars: 4180,
    redistribution: "allowed",
    excerpt: "The company raised its full-year outlook.",
    preview: null,
  }),
  ev("research.source_rejected", {
    url: URLS.paywalled,
    title: "Subscriber story on Example Holdings",
    reason: "paywalled",
    intent: "retrieve_recent_news",
    round: 1,
    domain: "paywall.example.org",
    fetch_ms: 800,
  }),
  /* decided from the hit's date: no request was made */
  ev("research.source_rejected", {
    url: URLS.late,
    title: "Next month's recap",
    reason: "published_after_as_of",
    intent: "retrieve_recent_news",
    round: 1,
    domain: "later.example.net",
    fetch_ms: null,
  }),
  /* a URL duplicate, detected before any request */
  ev("research.fetch_skipped", { url: URLS.duplicate, domain: "news.example.com", reason: "duplicate", intent: "retrieve_recent_news", round: 1 }),
  ev("research.started", { round: 2, intents: ["retrieve_guidance_history"], evidence_gaps: ["guidance history"] }),
  ev("research.query", { intent: "retrieve_guidance_history", kind: "search", query: SEARCH_2, label: "guidance history for Example Holdings Inc.", round: 2 }),
  ev("research.search_results", { query: SEARCH_2, intent: "retrieve_guidance_history", round: 2, total: 0, hits: [], failed: true }),
  ev("research.fetching", { url: URLS.metadataOnly, domain: "blog.example.com", kind: "web", label: null, intent: "retrieve_guidance_history", round: 2 }),
  ev("research.source_found", {
    source_id: "src_meta",
    title: "Notes on Example Holdings",
    publisher: "Example Blog",
    source_type: "secondary_commentary",
    published_at: "2026-09-18T00:00:00+00:00",
    retrieved_at: "2026-09-27T10:00:16+00:00",
    url: URLS.metadataOnly,
    fiscal_period: null,
    freshness: "recent",
    is_primary: false,
    intent: "retrieve_guidance_history",
    round: 2,
    domain: "blog.example.com",
    fetch_ms: 2100,
    text_chars: 2610,
    redistribution: "metadata_only",
    /* the contract sends null here; a stray value must still never be shown */
    excerpt: "Text the terms do not allow to redistribute.",
    preview: null,
  }),
  ev("research.fetching", { url: URLS.budget, domain: "extra.example.com", kind: "web", label: null, intent: "retrieve_guidance_history", round: 2 }),
  ev("research.fetch_skipped", { url: URLS.budget, domain: "extra.example.com", reason: "budget", intent: "retrieve_guidance_history", round: 2 }),
  ev("research.completed", {
    search_rounds: 2,
    queries_issued: 2,
    queries_failed: 1,
    structured_failures: 0,
    sources_fetched: 3,
    sources_rejected: 2,
    duplicate_sources_removed: 1,
    evidence_gaps_remaining: 0,
    retrieval_total_ms: 5400,
    intents: ["retrieve_recent_news", "retrieve_guidance_history"],
    termination_reason: "evidence_sufficient",
  }),
];

/** Index just after the event with this seq. */
export const upToSeq = (last: number) => LIVE_EVENTS.filter((e) => e.seq <= last);
export const seqOf = (predicate: (e: AnalysisEvent) => boolean) => LIVE_EVENTS.find(predicate)!.seq;

/* ── optional market events (not sent by the current backend) ── */

/** Weekday dates ending on `end`, oldest first. */
export function tradingDays(count: number, end = "2026-09-25"): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T00:00:00Z`);
  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

/** A synthetic linear series: close = start + step × index; open/high/low around it. */
export function linearPoints(dates: string[], start: number, step: number, volume = 1000): PricePoint[] {
  return dates.map((date, i) => {
    const close = start + step * i;
    return [date, close - step / 2, close + 1, close - 1, close, volume + i];
  });
}

export function syntheticSeries(role: MarketSeries["role"], symbol: string, points: PricePoint[]): MarketSeries {
  return { role, symbol, name: `${symbol} (synthetic)`, source_id: `src_${symbol.toLowerCase()}`, currency: "USD", interval: "1d", points };
}

const MARKET_BASE = LIVE_EVENTS[LIVE_EVENTS.length - 1].seq;
export const MARKET_EVENTS: AnalysisEvent[] = [
  {
    event: "market.series",
    analysis_id: LIVE_ID,
    seq: MARKET_BASE + 1,
    ts: new Date(T0 + (MARKET_BASE + 1) * 1000).toISOString(),
    ...syntheticSeries("company", "EXHL", linearPoints(tradingDays(30), 100, 1)),
  },
  {
    event: "market.series",
    analysis_id: LIVE_ID,
    seq: MARKET_BASE + 2,
    ts: new Date(T0 + (MARKET_BASE + 2) * 1000).toISOString(),
    ...syntheticSeries("broad_market", "MKT", linearPoints(tradingDays(30), 50, 0.5)),
  },
  {
    event: "market.fundamentals",
    analysis_id: LIVE_ID,
    seq: MARKET_BASE + 3,
    ts: new Date(T0 + (MARKET_BASE + 3) * 1000).toISOString(),
    currency: "USD",
    quarters: [
      { label: "Q1 2026", end: "2026-03-31", revenue: 100_000_000, gross_margin_pct: 40.5 },
      { label: "Q2 2026", end: "2026-06-30", revenue: 110_000_000, gross_margin_pct: null },
    ],
    source_ids: ["src_facts"],
  },
];
