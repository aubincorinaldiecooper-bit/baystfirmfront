/**
 * The live research dock, derived from recorded state only.
 *
 * The activity feed and the live view are pure functions of the reducer's
 * state: one feed row per recorded research event (a round starting, a web
 * search, a request and its outcome, a source kept or skipped, research
 * finishing), in seq order. Nothing is simulated or timed: a row is "reading"
 * exactly while its `research.fetching` has no recorded outcome, and stops
 * being so when the run ends. A finished analysis opened without its events
 * is shown from its durable result (the sources it kept, the research stats).
 */

import type { Freshness, Redistribution, SearchHit, SourcePreview, SourceRecord, SourceType } from "@/lib/api/types";
import { hostOf, msBetween } from "@/lib/market/format";
import type { AnalysisViewState, FetchView, SearchResultsView, SourceView } from "./reducer";
import { isTerminalUiStatus } from "./reducer";

/* ── rejection and skip reasons ──────────────────────────── */

export interface ReasonText {
  /** Short label for a pill: "Paywalled". */
  label: string;
  /** One plain sentence for the live view. */
  text: string;
}

const REASONS: Record<string, ReasonText> = {
  published_after_as_of: {
    label: "Published after the as-of date",
    text: "It was published after this analysis's as-of date, so it can't be used.",
  },
  paywalled: { label: "Paywalled", text: "The page asked for a subscription, so nothing from it is used." },
  thin_content: { label: "Too little text", text: "The page had too little readable text to use." },
  fetch_failed: { label: "Couldn't load", text: "The request failed, so nothing from it is used." },
  blocked_target: { label: "Blocked site", text: "This site is excluded from research, so it was not opened." },
  timeout: { label: "Timed out", text: "No response in time, so the page was dropped." },
  extract_failed: { label: "Couldn't read", text: "The page loaded, but no readable text could be extracted from it." },
  robots_disallowed: {
    label: "Blocked by robots.txt",
    text: "The site's robots.txt disallows automated reading, so the page was not opened.",
  },
  search_failed: { label: "Search failed", text: "The web search did not return results." },
  duplicate: { label: "Duplicate", text: "Already covered by another source, so it was skipped." },
  budget: { label: "Budget reached", text: "The run's source budget was already spent, so this source wasn't kept." },
};

/** Plain English for a backend reason keyword; an unknown keyword is shown humanized, never invented. */
export function reasonText(keyword: string | null | undefined): ReasonText {
  const known = keyword ? REASONS[keyword] : undefined;
  if (known) return known;
  const words = (keyword ?? "").replace(/[_-]+/g, " ").trim();
  const label = words ? words.charAt(0).toUpperCase() + words.slice(1) : "Not used";
  return { label, text: "It was not used for this analysis." };
}

/* ── sources, from events and from the result ────────────── */

/** One kept source as the dock shows it, whichever way it was recorded. */
export interface LiveSource {
  source_id: string;
  title: string;
  publisher: string | null;
  url: string;
  domain: string | null;
  source_type: SourceType | string;
  published_at: string | null;
  freshness: Freshness | string;
  is_primary: boolean;
  fiscal_period: string | null;
  redistribution: Redistribution | null;
  /** Only when the terms allow redistribution. */
  excerpt: string | null;
  preview: SourcePreview | null;
  fetchMs: number | null;
  textChars: number | null;
  /** The event that recorded it, or null for a source known only from the result. */
  seq: number | null;
}

function fromEvent(source: SourceView): LiveSource {
  return {
    source_id: source.source_id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    domain: source.domain ?? hostOf(source.url),
    source_type: source.source_type,
    published_at: source.published_at,
    freshness: source.freshness,
    is_primary: source.is_primary,
    fiscal_period: source.fiscal_period,
    redistribution: source.redistribution,
    excerpt: source.redistribution === "allowed" ? source.excerpt : null,
    preview: source.preview,
    fetchMs: source.fetchMs,
    textChars: source.textChars,
    seq: source.seq,
  };
}

function fromRecord(record: SourceRecord): LiveSource {
  return {
    source_id: record.source_id,
    title: record.title,
    publisher: record.publisher,
    url: record.url,
    domain: hostOf(record.url),
    source_type: record.source_type,
    published_at: record.published_at,
    freshness: record.freshness,
    is_primary: record.is_primary,
    fiscal_period: record.fiscal_period,
    redistribution: record.redistribution,
    excerpt: record.redistribution === "allowed" && record.excerpt ? record.excerpt : null,
    preview: null,
    fetchMs: null,
    textChars: null,
    seq: null,
  };
}

/**
 * Every kept source by id: the streamed ones, completed by the durable
 * result (which can add the excerpt and terms an older backend did not
 * stream), plus sources known only from the result.
 */
export function liveSources(state: AnalysisViewState): Map<string, LiveSource> {
  const map = new Map<string, LiveSource>();
  const records = new Map((state.result?.sources ?? []).map((r) => [r.source_id, r]));
  for (const source of state.sources) {
    const live = fromEvent(source);
    const record = records.get(source.source_id);
    if (record) {
      live.redistribution = live.redistribution ?? record.redistribution;
      if (!live.excerpt && live.redistribution === "allowed" && record.redistribution === "allowed" && record.excerpt) {
        live.excerpt = record.excerpt;
      }
    }
    map.set(source.source_id, live);
  }
  for (const record of state.result?.sources ?? []) {
    if (!map.has(record.source_id) && !record.rejected_reason) map.set(record.source_id, fromRecord(record));
  }
  return map;
}

/* ── the feed ────────────────────────────────────────────── */

export interface RejectionView {
  url: string;
  title: string;
  domain: string | null;
  reason: string;
  fetchMs: number | null;
}

export interface SkipView {
  url: string;
  domain: string | null;
  reason: string;
}

export interface ResearchSummary {
  kept: number;
  skipped: number;
  rounds: number;
  /** From event times (or the result's measured retrieval time); null when not measurable. */
  elapsedMs: number | null;
  termination: string | null;
  /** The run ended before research finished. */
  stopped: boolean;
}

interface Base {
  /** Stable identity, also used to pin the row in the live view. */
  key: string;
  seq: number;
}

export type FeedItem =
  | (Base & { kind: "round"; round: number; intents: string[]; gaps: string[] })
  | (Base & { kind: "search"; query: string; round: number; results: SearchResultsView | null; pending: boolean })
  | (Base & { kind: "reading"; fetch: FetchView; pending: boolean })
  | (Base & { kind: "kept"; source: LiveSource; fetch: FetchView | null })
  | (Base & { kind: "rejected"; rejection: RejectionView; fetch: FetchView | null })
  | (Base & { kind: "skipped"; skip: SkipView; fetch: FetchView | null })
  | (Base & { kind: "finished"; summary: ResearchSummary });

export function sourceKey(sourceId: string): string {
  return `source-${sourceId}`;
}

/** Whether the run can still produce research activity (so a pending row is really pending). */
export function researchLive(state: AnalysisViewState): boolean {
  return !isTerminalUiStatus(state.status) && !state.research.completed;
}

function hasResearchEvents(state: AnalysisViewState): boolean {
  const r = state.research;
  return (
    r.roundLog.length > 0 ||
    r.queries.length > 0 ||
    r.fetches.length > 0 ||
    r.searches.length > 0 ||
    r.rejected.length > 0 ||
    r.skipped.length > 0 ||
    state.sources.length > 0 ||
    r.completed
  );
}

export function researchSummary(state: AnalysisViewState): ResearchSummary | null {
  const r = state.research;
  if (hasResearchEvents(state)) {
    return {
      kept: state.sources.length,
      skipped: r.rejected.length + r.skipped.length,
      rounds: r.stats?.search_rounds ?? r.rounds,
      elapsedMs: msBetween(r.startedTs, r.completedTs ?? r.lastTs),
      termination: r.stats?.termination_reason ?? null,
      stopped: !r.completed,
    };
  }
  const result = state.result;
  if (!result || !isTerminalUiStatus(state.status)) return null;
  const stats = result.telemetry?.research;
  const kept = result.sources.filter((s) => !s.rejected_reason).length;
  if (!stats && kept === 0) return null;
  if (stats && stats.search_rounds === 0 && stats.sources_fetched === 0 && kept === 0) return null;
  return {
    kept,
    skipped: result.sources.filter((s) => s.rejected_reason).length || (stats?.sources_rejected ?? 0),
    rounds: stats?.search_rounds ?? 0,
    elapsedMs: result.telemetry?.retrieval_ms ?? null,
    termination: stats?.termination_reason ?? null,
    stopped: result.status !== "completed" && !stats?.termination_reason,
  };
}

/** Everything the dock's feed shows, in seq order. */
export function researchFeed(state: AnalysisViewState, sources: Map<string, LiveSource> = liveSources(state)): FeedItem[] {
  const r = state.research;
  const live = researchLive(state);
  const items: FeedItem[] = [];

  if (!hasResearchEvents(state)) {
    /* a finished analysis opened without its events: what the durable result kept */
    const result = state.result;
    if (!result) return items;
    result.sources.forEach((record, index) => {
      if (record.rejected_reason) {
        items.push({
          kind: "rejected",
          key: `rejected-result-${record.source_id}`,
          seq: index,
          rejection: { url: record.url, title: record.title, domain: hostOf(record.url), reason: record.rejected_reason, fetchMs: null },
          fetch: null,
        });
      } else {
        const source = sources.get(record.source_id);
        if (source) items.push({ kind: "kept", key: sourceKey(record.source_id), seq: index, source, fetch: null });
      }
    });
    const summary = researchSummary(state);
    if (summary && !summary.stopped) items.push({ kind: "finished", key: "finished", seq: Number.MAX_SAFE_INTEGER, summary });
    return items;
  }

  for (const round of r.roundLog) {
    items.push({ kind: "round", key: `round-${round.seq}`, seq: round.seq, round: round.round, intents: round.intents, gaps: round.evidenceGaps });
  }
  for (const query of r.queries) {
    if (query.query === null) continue; /* structured retrievals carry no search text */
    const results = r.searches.find((s) => s.querySeq === query.seq) ?? null;
    items.push({ kind: "search", key: `search-${query.seq}`, seq: query.seq, query: query.query, round: query.round, results, pending: !results && live });
  }
  for (const search of r.searches) {
    if (search.querySeq !== null) continue;
    items.push({ kind: "search", key: `search-${search.seq}`, seq: search.seq, query: search.query, round: search.round, results: search, pending: false });
  }
  for (const fetch of r.fetches) {
    if (fetch.state === "fetching") {
      items.push({ kind: "reading", key: `fetch-${fetch.seq}`, seq: fetch.seq, fetch, pending: live });
      continue;
    }
    if (fetch.state === "kept" && fetch.sourceId) {
      const source = sources.get(fetch.sourceId);
      if (source) items.push({ kind: "kept", key: sourceKey(fetch.sourceId), seq: fetch.seq, source, fetch });
      continue;
    }
    if (fetch.state === "rejected") {
      const rejected = r.rejected.find((x) => x.fetchSeq === fetch.seq);
      items.push({
        kind: "rejected",
        key: `rejected-${fetch.settledSeq ?? fetch.seq}`,
        seq: fetch.seq,
        rejection: {
          url: fetch.url,
          title: rejected?.title || fetch.label || fetch.url,
          domain: rejected?.domain ?? fetch.domain,
          reason: fetch.reason ?? rejected?.reason ?? "",
          fetchMs: rejected?.fetchMs ?? null,
        },
        fetch,
      });
      continue;
    }
    if (fetch.state === "skipped") {
      items.push({
        kind: "skipped",
        key: `skipped-${fetch.settledSeq ?? fetch.seq}`,
        seq: fetch.seq,
        skip: { url: fetch.url, domain: fetch.domain, reason: fetch.reason ?? "" },
        fetch,
      });
    }
  }
  /* outcomes recorded without a request of their own */
  const keptViaFetch = new Set(r.fetches.filter((f) => f.state === "kept").map((f) => f.sourceId));
  for (const source of state.sources) {
    if (source.fetchSeq !== null || keptViaFetch.has(source.source_id)) continue;
    const kept = sources.get(source.source_id);
    if (kept) items.push({ kind: "kept", key: sourceKey(source.source_id), seq: source.seq, source: kept, fetch: null });
  }
  for (const rejected of r.rejected) {
    if (rejected.fetchSeq !== null) continue;
    items.push({
      kind: "rejected",
      key: `rejected-${rejected.seq}`,
      seq: rejected.seq,
      rejection: { url: rejected.url, title: rejected.title, domain: rejected.domain ?? hostOf(rejected.url), reason: rejected.reason, fetchMs: rejected.fetchMs },
      fetch: null,
    });
  }
  for (const skipped of r.skipped) {
    if (skipped.fetchSeq !== null) continue;
    items.push({
      kind: "skipped",
      key: `skipped-${skipped.seq}`,
      seq: skipped.seq,
      skip: { url: skipped.url, domain: skipped.domain, reason: skipped.reason },
      fetch: null,
    });
  }
  items.sort((a, b) => a.seq - b.seq);
  if (r.completed) {
    const summary = researchSummary(state);
    if (summary) items.push({ kind: "finished", key: "finished", seq: Number.MAX_SAFE_INTEGER, summary });
  }
  return items;
}

export type FeedFilter = "all" | "kept" | "skipped";

export function filterFeed(items: readonly FeedItem[], filter: FeedFilter): FeedItem[] {
  if (filter === "kept") return items.filter((i) => i.kind === "kept");
  if (filter === "skipped") return items.filter((i) => i.kind === "rejected" || i.kind === "skipped");
  return [...items];
}

export function feedCounts(items: readonly FeedItem[]): { kept: number; skipped: number } {
  let kept = 0;
  let skipped = 0;
  for (const item of items) {
    if (item.kind === "kept") kept += 1;
    else if (item.kind === "rejected" || item.kind === "skipped") skipped += 1;
  }
  return { kept, skipped };
}

/** The row a pinned key refers to; a pinned request resolves to its outcome once that arrives. */
export function findFeedItem(items: readonly FeedItem[], key: string): FeedItem | null {
  const direct = items.find((i) => i.key === key);
  if (direct) return direct;
  const fetchSeq = /^fetch-(\d+)$/.exec(key);
  if (fetchSeq) {
    const seq = Number(fetchSeq[1]);
    return items.find((i) => "fetch" in i && i.fetch?.seq === seq) ?? null;
  }
  return null;
}

/* ── the live view ───────────────────────────────────────── */

export type LiveTarget =
  | { kind: "idle"; phase: "planning" | "waiting" | "ended"; title: string; text: string; key: null }
  | { kind: "search"; key: string; query: string; results: SearchResultsView | null; pending: boolean }
  | { kind: "loading"; key: string; fetch: FetchView; pending: boolean }
  | { kind: "source"; key: string; source: LiveSource }
  | { kind: "rejected"; key: string; rejection: RejectionView }
  | { kind: "skipped"; key: string; skip: SkipView }
  | { kind: "summary"; key: null; summary: ResearchSummary };

export function targetOf(item: FeedItem): LiveTarget {
  switch (item.kind) {
    case "round":
      return {
        kind: "idle",
        phase: "planning",
        key: null,
        title: `Planning round ${item.round}`,
        text: item.gaps.length > 0 ? `Looking for: ${item.gaps.join(", ")}` : "Deciding what to request first.",
      };
    case "search":
      return { kind: "search", key: item.key, query: item.query, results: item.results, pending: item.pending };
    case "reading":
      return { kind: "loading", key: item.key, fetch: item.fetch, pending: item.pending };
    case "kept":
      return { kind: "source", key: item.key, source: item.source };
    case "rejected":
      return { kind: "rejected", key: item.key, rejection: item.rejection };
    case "skipped":
      return { kind: "skipped", key: item.key, skip: item.skip };
    case "finished":
      return { kind: "summary", key: null, summary: item.summary };
  }
}

/** The latest recorded moment of a row: its own event, or the one that settled or answered it. */
function lastMoment(item: FeedItem): number {
  switch (item.kind) {
    case "search":
      return Math.max(item.seq, item.results?.seq ?? 0);
    case "reading":
      return item.seq;
    case "kept":
    case "rejected":
    case "skipped":
      return Math.max(item.seq, item.fetch?.settledSeq ?? 0);
    default:
      return item.seq;
  }
}

/**
 * What the live view shows while following the run: the row whose latest
 * event is newest, the research summary once research is over, or an idle
 * state before anything was requested.
 */
export function followTarget(state: AnalysisViewState, items: readonly FeedItem[]): LiveTarget {
  const summary = researchSummary(state);
  if (summary && (state.research.completed || isTerminalUiStatus(state.status))) return { kind: "summary", key: null, summary };
  let latest: FeedItem | null = null;
  for (const item of items) {
    if (item.kind === "finished") continue;
    if (!latest || lastMoment(item) >= lastMoment(latest)) latest = item;
  }
  if (latest) return targetOf(latest);
  if (isTerminalUiStatus(state.status)) {
    return { kind: "idle", phase: "ended", key: null, title: "No research was recorded", text: "The analysis ended before any source was requested." };
  }
  return { kind: "idle", phase: "waiting", key: null, title: "Research hasn't started yet", text: "Nothing has been requested from the web yet." };
}

/** The live view's subject: the pinned row when there is one, else the run as it happens. */
export function liveTarget(
  state: AnalysisViewState,
  items: readonly FeedItem[],
  sources: Map<string, LiveSource>,
  pinned: string | null,
): { target: LiveTarget; pinned: boolean } {
  if (pinned) {
    const item = findFeedItem(items, pinned);
    if (item) return { target: targetOf(item), pinned: true };
    const sourceId = pinned.startsWith("source-") ? pinned.slice("source-".length) : null;
    const source = sourceId ? sources.get(sourceId) : undefined;
    if (source) return { target: { kind: "source", key: pinned, source }, pinned: true };
  }
  return { target: followTarget(state, items), pinned: false };
}

/* ── search hits ─────────────────────────────────────────── */

export type HitState = "reading" | "kept" | "skipped";

function normalizeUrl(url: string): string {
  return url.replace(/#.*$/, "").replace(/\/+$/, "");
}

/** How far each search hit got: requested, kept or skipped, from the recorded events only. */
export function hitStates(state: AnalysisViewState, hits: readonly SearchHit[]): Map<string, HitState> {
  const out = new Map<string, HitState>();
  const live = researchLive(state);
  for (const hit of hits) {
    const url = normalizeUrl(hit.url);
    let found: HitState | null = null;
    for (let i = state.research.fetches.length - 1; i >= 0 && !found; i -= 1) {
      const fetch = state.research.fetches[i];
      if (normalizeUrl(fetch.url) !== url) continue;
      if (fetch.state === "fetching") found = live ? "reading" : null;
      else found = fetch.state === "kept" ? "kept" : "skipped";
      if (!found) break;
    }
    if (!found && state.sources.some((s) => normalizeUrl(s.url) === url)) found = "kept";
    if (!found && state.research.rejected.some((s) => normalizeUrl(s.url) === url)) found = "skipped";
    if (!found && state.research.skipped.some((s) => normalizeUrl(s.url) === url)) found = "skipped";
    if (found) out.set(hit.url, found);
  }
  return out;
}

/* ── labels ──────────────────────────────────────────────── */

/** "Reading" for pages and filings, "Requesting" for structured data. */
export function fetchVerb(kind: string): string {
  return kind === "web" || kind === "filing" ? "Reading" : "Requesting";
}

/** The dock header's one-line description of what research is doing now. */
export function activityLabel(state: AnalysisViewState, items: readonly FeedItem[]): string {
  const summary = researchSummary(state);
  if (state.research.completed || (summary && !hasResearchEvents(state))) return "Research finished";
  if (isTerminalUiStatus(state.status)) return hasResearchEvents(state) ? "Research stopped" : "No research recorded";
  if (!hasResearchEvents(state)) return "Waiting for research to start";
  let reading: FeedItem | null = null;
  let searching: FeedItem | null = null;
  for (const item of items) {
    if (item.kind === "reading" && item.pending && (!reading || item.seq > reading.seq)) reading = item;
    if (item.kind === "search" && item.pending && (!searching || item.seq > searching.seq)) searching = item;
  }
  if (reading && reading.kind === "reading" && (!searching || reading.seq > searching.seq)) {
    return `${fetchVerb(reading.fetch.kind)} ${reading.fetch.domain}`;
  }
  if (searching) return "Searching the web";
  return "Researching";
}

/* ── derived from kept sources ───────────────────────────── */

const HEADLINE_TYPES: ReadonlySet<string> = new Set([
  "financial_journalism",
  "secondary_commentary",
  "investor_relations",
  "earnings_release",
  "earnings_transcript",
]);

/** The most recent kept news or company source (by publication date). */
export function latestHeadline(sources: Iterable<LiveSource>): LiveSource | null {
  let best: LiveSource | null = null;
  for (const source of sources) {
    if (!HEADLINE_TYPES.has(source.source_type) || !source.published_at) continue;
    if (!best || (best.published_at ?? "") < source.published_at) best = source;
  }
  return best;
}

export interface FilingMarker {
  sourceId: string;
  form: string;
  /** YYYY-MM-DD */
  date: string;
}

/** 10-K / 10-Q filings among the kept sources, oldest first, from their type, titles and publication dates. */
export function filingMarkers(sources: Iterable<LiveSource>): FilingMarker[] {
  const markers: FilingMarker[] = [];
  for (const source of sources) {
    const form = /\b(10-[KQ])(\/A)?\b/.exec(source.title);
    const date = /^\d{4}-\d{2}-\d{2}/.exec(source.published_at ?? "");
    if (!form || !date) continue;
    if (source.source_type !== "regulatory_filing") continue;
    markers.push({ sourceId: source.source_id, form: form[0], date: date[0] });
  }
  return markers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
