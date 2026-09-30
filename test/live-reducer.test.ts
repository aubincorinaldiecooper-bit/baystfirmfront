/**
 * The reducer over the live-research contract (v1, web search only): per-URL
 * request state, outcomes that arrive without a request, search results with
 * their hits, the extended source fields, the optional market events and the
 * result's optional `market` block. Dedupe by seq still holds.
 */
import { describe, expect, it } from "vitest";
import { applyEvents, applyResult, initialAnalysisState } from "@/lib/analysis/reducer";
import type { AnalysisEvent } from "@/lib/api/types";
import { completedResult } from "./fixtures/events";
import { LIVE_EVENTS, LIVE_ID, MARKET_EVENTS, URLS, linearPoints, seqOf, syntheticSeries, tradingDays, upToSeq } from "./fixtures/live";

const final = applyEvents(initialAnalysisState, LIVE_EVENTS);
const seqWhere = (name: AnalysisEvent["event"], url?: string) =>
  seqOf((e) => e.event === name && (url === undefined || (e as { url?: string }).url === url));

describe("research.fetching and its outcomes", () => {
  it("records a pending request per URL", () => {
    const state = applyEvents(initialAnalysisState, upToSeq(seqWhere("research.fetching", URLS.paywalled)));
    expect(state.research.fetches.map((f) => [f.url, f.state, f.kind, f.domain])).toEqual([
      [URLS.kept, "fetching", "web", "news.example.com"],
      [URLS.paywalled, "fetching", "web", "paywall.example.org"],
    ]);
    expect(state.research.fetches[0]).toMatchObject({ settledSeq: null, sourceId: null, reason: null, round: 1, intent: "retrieve_recent_news" });
  });

  it("settles a request as kept by the matching source_found, and links the source to it", () => {
    const fetch = final.research.fetches.find((f) => f.url === URLS.kept)!;
    expect(fetch).toMatchObject({ state: "kept", sourceId: "src_kept", settledSeq: seqWhere("research.source_found", URLS.kept) });
    expect(final.sources.find((s) => s.source_id === "src_kept")!.fetchSeq).toBe(fetch.seq);
  });

  it("settles a request as rejected by the matching source_rejected", () => {
    const fetch = final.research.fetches.find((f) => f.url === URLS.paywalled)!;
    expect(fetch).toMatchObject({ state: "rejected", reason: "paywalled" });
    const rejected = final.research.rejected.find((r) => r.url === URLS.paywalled)!;
    expect(rejected).toMatchObject({ fetchSeq: fetch.seq, domain: "paywall.example.org", fetchMs: 800, reason: "paywalled" });
  });

  it("keeps a rejection that had no request (decided from the hit's date) as standalone", () => {
    const rejected = final.research.rejected.find((r) => r.url === URLS.late)!;
    expect(rejected).toMatchObject({ fetchSeq: null, reason: "published_after_as_of", fetchMs: null });
    expect(final.research.fetches.some((f) => f.url === URLS.late)).toBe(false);
  });

  it("records a duplicate skipped before any request, and a budget skip that settles its request", () => {
    expect(final.research.skipped.map((s) => [s.url, s.reason, s.fetchSeq === null])).toEqual([
      [URLS.duplicate, "duplicate", true],
      [URLS.budget, "budget", false],
    ]);
    expect(final.research.fetches.find((f) => f.url === URLS.budget)).toMatchObject({ state: "skipped", reason: "budget" });
  });

  it("settles only a pending request, the most recent one for that URL", () => {
    const again = {
      ...(LIVE_EVENTS.find((e) => e.event === "research.fetching" && e.url === URLS.kept) as AnalysisEvent),
      seq: 1000,
    } as AnalysisEvent;
    const found = { ...(LIVE_EVENTS.find((e) => e.event === "research.source_found" && e.url === URLS.kept) as AnalysisEvent), seq: 1001, source_id: "src_kept_2" } as AnalysisEvent;
    const state = applyEvents(final, [again, found]);
    const fetches = state.research.fetches.filter((f) => f.url === URLS.kept);
    expect(fetches.map((f) => f.sourceId)).toEqual(["src_kept", "src_kept_2"]);
    expect(fetches[1].seq).toBe(1000);
  });
});

describe("research.search_results", () => {
  it("keeps the hits in engine order, the total, and the query it answered", () => {
    const [first, second] = final.research.searches;
    expect(first).toMatchObject({ query: "Example Holdings outlook", total: 12, failed: false, round: 1, querySeq: seqOf((e) => e.event === "research.query") });
    expect(first.hits.map((h) => h.domain)).toEqual(["news.example.com", "paywall.example.org", "later.example.net", "news.example.com", "unvisited.example.com"]);
    expect(second).toMatchObject({ total: 0, hits: [], failed: true, round: 2 });
    expect(second.querySeq).not.toBeNull();
  });

  it("keeps the search text of research.query", () => {
    expect(final.research.queries.map((q) => q.query)).toEqual(["Example Holdings outlook", "Example Holdings guidance"]);
  });

  it("keeps a search result with no matching query as unlinked", () => {
    const orphan = { ...(LIVE_EVENTS[4] as AnalysisEvent), seq: 999, query: "never queried" } as AnalysisEvent;
    const state = applyEvents(final, [orphan]);
    expect(state.research.searches[state.research.searches.length - 1].querySeq).toBeNull();
  });
});

describe("research.source_found extended fields", () => {
  it("records domain, request time, text length, terms and the excerpt", () => {
    expect(final.sources.find((s) => s.source_id === "src_kept")).toMatchObject({
      domain: "news.example.com",
      fetchMs: 1234,
      textChars: 4180,
      redistribution: "allowed",
      excerpt: "The company raised its full-year outlook.",
      preview: null,
    });
  });

  it("never keeps an excerpt the terms do not allow", () => {
    expect(final.sources.find((s) => s.source_id === "src_meta")).toMatchObject({ redistribution: "metadata_only", excerpt: null });
  });

  it("tolerates source events from a backend without the new fields", () => {
    const legacy = applyEvents(initialAnalysisState, [
      {
        event: "research.source_found",
        analysis_id: LIVE_ID,
        seq: 1,
        ts: "2026-09-27T10:00:00Z",
        source_id: "src_legacy",
        title: "Legacy",
        publisher: null,
        source_type: "unverified_web",
        published_at: null,
        retrieved_at: "2026-09-27T10:00:00Z",
        url: "https://legacy.example.com/",
        fiscal_period: null,
        freshness: "unknown",
        is_primary: false,
        intent: "x",
        round: 1,
      } as AnalysisEvent,
    ]);
    expect(legacy.sources[0]).toMatchObject({ domain: null, fetchMs: null, textChars: null, redistribution: null, excerpt: null, preview: null, fetchSeq: null });
  });
});

describe("rounds and timing", () => {
  it("logs each round with its gaps and the event times research started and finished", () => {
    expect(final.research.roundLog.map((r) => [r.round, r.evidenceGaps])).toEqual([
      [1, ["recent news"]],
      [2, ["guidance history"]],
    ]);
    expect(final.research.startedTs).toBe(LIVE_EVENTS[2].ts);
    expect(final.research.completedTs).toBe(LIVE_EVENTS[LIVE_EVENTS.length - 1].ts);
    expect(final.startedTs).toBe(LIVE_EVENTS[0].ts);
  });
});

describe("market events (optional)", () => {
  const withMarket = applyEvents(final, MARKET_EVENTS);

  it("stores each series' points by role, company first", () => {
    expect(withMarket.market.series.map((s) => [s.role, s.symbol, s.points.length])).toEqual([
      ["company", "EXHL", 30],
      ["broad_market", "MKT", 30],
    ]);
  });

  it("replaces a series of the same role", () => {
    const replacement = { ...MARKET_EVENTS[0], seq: 500, symbol: "EXHL2" } as AnalysisEvent;
    const state = applyEvents(withMarket, [replacement]);
    expect(state.market.series.map((s) => s.symbol)).toEqual(["EXHL2", "MKT"]);
  });

  it("stores the quarterly fundamentals", () => {
    expect(withMarket.market.fundamentals).toMatchObject({ currency: "USD", source_ids: ["src_facts"] });
    expect(withMarket.market.fundamentals?.quarters.map((q) => q.gross_margin_pct)).toEqual([40.5, null]);
  });

  it("is empty when the backend sends none (web search only)", () => {
    expect(final.market).toEqual({ series: [], fundamentals: null });
  });
});

describe("result.market", () => {
  const base = applyEvents(initialAnalysisState, LIVE_EVENTS.slice(0, 3));
  const result = (market: unknown) => completedResult({ analysis_id: LIVE_ID, market } as never);

  it("takes the series and fundamentals of a finished analysis loaded without events", () => {
    const series = syntheticSeries("company", "EXHL", linearPoints(tradingDays(5), 10, 1));
    const state = applyResult(initialAnalysisState, result({ price_display: true, series: [series], fundamentals: null }));
    expect(state.market.series).toEqual([series]);
    expect(state.market.fundamentals).toBeNull();
  });

  it("lets the result's series win per role and keeps streamed ones it lacks", () => {
    const withMarket = applyEvents(base, MARKET_EVENTS.map((e, i) => ({ ...e, seq: 10 + i }) as AnalysisEvent));
    const company = syntheticSeries("company", "EXHL", linearPoints(tradingDays(3), 1, 1));
    const state = applyResult(withMarket, result({ series: [company], fundamentals: null }));
    expect(state.market.series.map((s) => [s.role, s.points.length])).toEqual([
      ["company", 3],
      ["broad_market", 30],
    ]);
    expect(state.market.fundamentals?.source_ids).toEqual(["src_facts"]);
  });

  it("leaves the market alone when the result has none", () => {
    const state = applyResult(base, result(undefined));
    expect(state.market).toBe(base.market);
  });
});

describe("dedupe by seq", () => {
  it("ignores a full replay of the live events", () => {
    expect(applyEvents(final, LIVE_EVENTS)).toBe(final);
  });

  it("does not double count a replayed tail after a reconnect", () => {
    const first = applyEvents(initialAnalysisState, LIVE_EVENTS.slice(0, 9));
    const resumed = applyEvents(first, LIVE_EVENTS.slice(5));
    expect(resumed).toEqual(final);
    expect(resumed.research.fetches).toHaveLength(final.research.fetches.length);
    expect(resumed.research.searches).toHaveLength(2);
  });
});
