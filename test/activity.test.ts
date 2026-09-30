/**
 * The live research dock's selectors: the activity feed in seq order, the
 * live view's target as the run progresses (and when a row is pinned), the
 * state of each search hit, the header's activity label, the reason keyword
 * mapping, and a finished analysis shown from its result alone.
 */
import { describe, expect, it } from "vitest";
import {
  activityLabel,
  feedCounts,
  filingMarkers,
  filterFeed,
  findFeedItem,
  followTarget,
  hitStates,
  latestHeadline,
  liveSources,
  liveTarget,
  reasonText,
  researchFeed,
  researchSummary,
  sourceKey,
  type LiveSource,
} from "@/lib/analysis/activity";
import { applyEvents, applyResult, initialAnalysisState } from "@/lib/analysis/reducer";
import type { AnalysisEvent } from "@/lib/api/types";
import { completedRun } from "./fixtures/backend";
import { LIVE_EVENTS, URLS, seqOf, upToSeq } from "./fixtures/live";

const at = (predicate: (e: AnalysisEvent) => boolean) => applyEvents(initialAnalysisState, upToSeq(seqOf(predicate)));
const byUrl = (name: AnalysisEvent["event"], url: string) => (e: AnalysisEvent) => e.event === name && (e as { url?: string }).url === url;
const final = applyEvents(initialAnalysisState, LIVE_EVENTS);

describe("reasonText", () => {
  it("maps every backend keyword to plain English", () => {
    const keywords = [
      "published_after_as_of",
      "paywalled",
      "thin_content",
      "fetch_failed",
      "blocked_target",
      "timeout",
      "extract_failed",
      "robots_disallowed",
      "search_failed",
      "duplicate",
      "budget",
    ];
    for (const keyword of keywords) {
      const text = reasonText(keyword);
      expect(text.label, keyword).not.toMatch(/_/);
      expect(text.text.length, keyword).toBeGreaterThan(10);
    }
    expect(reasonText("paywalled").label).toBe("Paywalled");
    expect(reasonText("robots_disallowed").label).toBe("Blocked by robots.txt");
    expect(reasonText("budget").label).toBe("Budget reached");
    expect(reasonText("published_after_as_of").label).toBe("Published after the as-of date");
  });

  it("humanizes an unknown keyword instead of inventing a reason", () => {
    expect(reasonText("some_new_reason")).toEqual({ label: "Some new reason", text: "It was not used for this analysis." });
    expect(reasonText(null).label).toBe("Not used");
  });
});

describe("researchFeed", () => {
  it("lists rounds, searches, requests and their outcomes in seq order, then the finish", () => {
    const items = researchFeed(final);
    expect(items.map((i) => i.kind)).toEqual([
      "round",
      "search",
      "kept", // the request for URLS.kept, settled
      "rejected", // the paywalled request, settled
      "rejected", // rejected by date, no request
      "skipped", // URL duplicate, no request
      "round",
      "search",
      "kept", // metadata-only page
      "skipped", // budget
      "finished",
    ]);
    expect(items.find((i) => i.kind === "kept")!.key).toBe(sourceKey("src_kept"));
  });

  it("shows a request as reading while it has no outcome, and stops calling it pending when the run ends", () => {
    const mid = at(byUrl("research.fetching", URLS.paywalled));
    const reading = researchFeed(mid).filter((i) => i.kind === "reading");
    expect(reading.map((i) => i.kind === "reading" && [i.fetch.url, i.pending])).toEqual([
      [URLS.kept, true],
      [URLS.paywalled, true],
    ]);
    const cancelled = { ...mid, status: "cancelled" as const };
    expect(researchFeed(cancelled).filter((i) => i.kind === "reading" && i.pending)).toHaveLength(0);
  });

  it("marks a search pending until its results arrive, and failed searches as failed", () => {
    const querying = at((e) => e.event === "research.query");
    const [search] = researchFeed(querying).filter((i) => i.kind === "search");
    expect(search).toMatchObject({ pending: true, results: null, query: "Example Holdings outlook" });
    const failed = researchFeed(final).filter((i) => i.kind === "search")[1];
    expect(failed.kind === "search" && failed.results?.failed).toBe(true);
  });

  it("filters and counts kept and skipped rows", () => {
    const items = researchFeed(final);
    expect(feedCounts(items)).toEqual({ kept: 2, skipped: 4 });
    expect(filterFeed(items, "kept").map((i) => i.key)).toEqual([sourceKey("src_kept"), sourceKey("src_meta")]);
    expect(filterFeed(items, "skipped").every((i) => i.kind === "rejected" || i.kind === "skipped")).toBe(true);
    expect(filterFeed(items, "all")).toHaveLength(items.length);
  });

  it("resolves a pinned request to its outcome once it arrives", () => {
    const fetchSeq = seqOf(byUrl("research.fetching", URLS.kept));
    const item = findFeedItem(researchFeed(final), `fetch-${fetchSeq}`);
    expect(item?.key).toBe(sourceKey("src_kept"));
  });

  it("shows a finished analysis opened without events from its result", () => {
    const state = applyResult(initialAnalysisState, completedRun.result);
    const items = researchFeed(state);
    const kept = completedRun.result.sources.filter((s) => !s.rejected_reason);
    expect(items.filter((i) => i.kind === "kept")).toHaveLength(kept.length);
    expect(items[items.length - 1].kind).toBe("finished");
    expect(researchSummary(state)).toMatchObject({ kept: kept.length, rounds: completedRun.result.telemetry.research.search_rounds, stopped: false });
  });
});

describe("the live view", () => {
  it("follows the newest recorded moment", () => {
    const planning = followTarget(at((e) => e.event === "research.started"), researchFeed(at((e) => e.event === "research.started")));
    expect(planning).toMatchObject({ kind: "idle", title: "Planning round 1", text: "Looking for: recent news" });

    const searching = at((e) => e.event === "research.query");
    expect(followTarget(searching, researchFeed(searching))).toMatchObject({ kind: "search", pending: true });

    const results = at((e) => e.event === "research.search_results");
    expect(followTarget(results, researchFeed(results))).toMatchObject({ kind: "search", pending: false, results: { total: 12 } });

    const loading = at(byUrl("research.fetching", URLS.kept));
    expect(followTarget(loading, researchFeed(loading))).toMatchObject({ kind: "loading", fetch: { url: URLS.kept }, pending: true });

    const kept = at(byUrl("research.source_found", URLS.kept));
    expect(followTarget(kept, researchFeed(kept))).toMatchObject({ kind: "source", source: { source_id: "src_kept" } });

    const late = at(byUrl("research.source_rejected", URLS.late));
    expect(followTarget(late, researchFeed(late))).toMatchObject({ kind: "rejected", rejection: { reason: "published_after_as_of" } });

    expect(followTarget(final, researchFeed(final))).toMatchObject({ kind: "summary", summary: { kept: 2, skipped: 4, rounds: 2, elapsedMs: 16_000 } });
  });

  it("shows an idle state before research starts", () => {
    const early = applyEvents(initialAnalysisState, LIVE_EVENTS.slice(0, 2));
    expect(followTarget(early, researchFeed(early))).toMatchObject({ kind: "idle", title: "Research hasn't started yet" });
  });

  it("shows the pinned row, or a pinned source known only from the result", () => {
    const items = researchFeed(final);
    const sources = liveSources(final);
    expect(liveTarget(final, items, sources, sourceKey("src_meta"))).toMatchObject({ pinned: true, target: { kind: "source", source: { excerpt: null } } });
    expect(liveTarget(final, items, sources, null).pinned).toBe(false);
    const finished = applyResult(initialAnalysisState, completedRun.result);
    const id = completedRun.result.sources[0].source_id;
    expect(liveTarget(finished, [], liveSources(finished), sourceKey(id))).toMatchObject({ pinned: true, target: { kind: "source", source: { source_id: id } } });
  });
});

describe("hitStates", () => {
  const hits = final.research.searches[0].hits;

  it("marks each hit from the recorded outcomes only", () => {
    const states = hitStates(final, hits);
    expect(states.get(URLS.kept)).toBe("kept");
    expect(states.get(URLS.paywalled)).toBe("skipped");
    expect(states.get(URLS.late)).toBe("skipped");
    expect(states.get(URLS.duplicate)).toBe("skipped");
    expect(states.has("https://unvisited.example.com/")).toBe(false);
  });

  it("marks a hit as reading while its request is pending", () => {
    const mid = at(byUrl("research.fetching", URLS.kept));
    expect(hitStates(mid, hits).get(URLS.kept)).toBe("reading");
  });
});

describe("activityLabel", () => {
  it("names what research is doing now, from the pending request or search", () => {
    const reading = at(byUrl("research.fetching", URLS.kept));
    expect(activityLabel(reading, researchFeed(reading))).toBe("Reading news.example.com");
    const searching = at((e) => e.event === "research.query");
    expect(activityLabel(searching, researchFeed(searching))).toBe("Searching the web");
    const between = at(byUrl("research.source_rejected", URLS.late));
    expect(activityLabel(between, researchFeed(between))).toBe("Researching");
    expect(activityLabel(final, researchFeed(final))).toBe("Research finished");
    const early = applyEvents(initialAnalysisState, LIVE_EVENTS.slice(0, 2));
    expect(activityLabel(early, researchFeed(early))).toBe("Waiting for research to start");
  });
});

describe("derived from kept sources", () => {
  const source = (id: string, type: string, title: string, published: string | null): LiveSource => ({
    source_id: id,
    title,
    publisher: null,
    url: `https://example.com/${id}`,
    domain: "example.com",
    source_type: type,
    published_at: published,
    freshness: "current",
    is_primary: false,
    fiscal_period: null,
    redistribution: null,
    excerpt: null,
    preview: null,
    fetchMs: null,
    textChars: null,
    seq: null,
  });

  it("picks the most recent news or company source as the headline", () => {
    const headline = latestHeadline([
      source("a", "financial_journalism", "Older story", "2026-09-01T00:00:00Z"),
      source("b", "regulatory_filing", "10-Q filed", "2026-09-25T00:00:00Z"),
      source("c", "earnings_release", "Results", "2026-09-10T00:00:00Z"),
      source("d", "financial_journalism", "Undated", null),
    ]);
    expect(headline?.source_id).toBe("c");
  });

  it("finds 10-K / 10-Q filings with their dates, oldest first", () => {
    const markers = filingMarkers([
      source("q", "regulatory_filing", "10-Q filed 2026-07-31", "2026-07-31T00:00:00Z"),
      source("k", "regulatory_filing", "Annual report (10-K)", "2025-10-31T00:00:00Z"),
      source("n", "financial_journalism", "What the 10-Q says", "2026-08-01T00:00:00Z"),
      source("e", "regulatory_filing", "8-K filed", "2026-07-30T00:00:00Z"),
    ]);
    expect(markers).toEqual([
      { sourceId: "k", form: "10-K", date: "2025-10-31" },
      { sourceId: "q", form: "10-Q", date: "2026-07-31" },
    ]);
  });
});
