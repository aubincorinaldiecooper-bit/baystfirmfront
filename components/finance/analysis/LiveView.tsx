"use client";

/* The live view: a browser-like frame that shows the research step the run
 * is on (or the row the person pinned). Everything in it comes from recorded
 * events: the search results a search returned, a request while it is in
 * flight, the kept page with its excerpt only when the terms allow it, why a
 * page was not used, and the summary once research is over. Nothing is
 * rendered from the page itself and nothing moves on a timer. */

import { ExternalLink, Globe, Search } from "lucide-react";
import { hitStates, reasonText, type LiveTarget, type ResearchSummary } from "@/lib/analysis/activity";
import { freshnessLabel } from "@/lib/analysis/labels";
import type { AnalysisViewState } from "@/lib/analysis/reducer";
import { formatClock, formatCount, formatDay, formatDuration, hostOf, monogram, pathOf } from "@/lib/market/format";

function elapsedText(ms: number): string {
  return ms < 60_000 ? formatDuration(ms) : formatClock(ms);
}
import { Monogram, Pill, SkeletonLines, Spinner, Tag, sourceTone, type PillTone } from "./controls";

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** How the page was read, from the measured request time and text length. */
export function readNote(fetchMs: number | null, textChars: number | null): string | null {
  if (textChars !== null && fetchMs !== null) return `Read ${formatCount(textChars)} characters in ${formatDuration(fetchMs)}`;
  if (textChars !== null) return `Read ${formatCount(textChars)} characters`;
  if (fetchMs !== null) return `Loaded in ${formatDuration(fetchMs)}`;
  return null;
}

function address(target: LiveTarget): { host: string; rest: string } {
  switch (target.kind) {
    case "idle":
      return { host: "Research", rest: target.phase === "planning" ? ` · ${target.title.toLowerCase()}` : "" };
    case "search":
      return { host: "Web search", rest: "" };
    case "loading":
      return { host: target.fetch.domain || hostOf(target.fetch.url) || "", rest: pathOf(target.fetch.url) };
    case "source":
      return { host: target.source.domain ?? hostOf(target.source.url) ?? "", rest: pathOf(target.source.url) };
    case "rejected":
      return { host: target.rejection.domain ?? hostOf(target.rejection.url) ?? "", rest: pathOf(target.rejection.url) };
    case "skipped":
      return { host: target.skip.domain ?? hostOf(target.skip.url) ?? "", rest: pathOf(target.skip.url) };
    case "summary":
      return { host: "Research", rest: " · summary" };
  }
}

function pill(target: LiveTarget): { label: string; tone: PillTone } {
  switch (target.kind) {
    case "idle":
      if (target.phase === "planning") return { label: "Planning", tone: "accent" };
      return target.phase === "ended" ? { label: "Ended", tone: "neutral" } : { label: "Waiting", tone: "neutral" };
    case "search":
      if (target.pending) return { label: "Searching", tone: "accent" };
      if (!target.results) return { label: "No results recorded", tone: "neutral" };
      if (target.results.failed) return { label: "Search failed", tone: "warn" };
      return { label: `${formatCount(target.results.total)} results`, tone: "neutral" };
    case "loading":
      return target.pending ? { label: "Reading", tone: "accent" } : { label: "No outcome", tone: "neutral" };
    case "source":
      return { label: "Kept", tone: "gain" };
    case "rejected":
    case "skipped":
      return { label: "Skipped", tone: "warn" };
    case "summary":
      return target.summary.stopped ? { label: "Stopped", tone: "warn" } : { label: "Finished", tone: "gain" };
  }
}

function NotUsed({ reason }: { reason: string }) {
  const text = reasonText(reason);
  return (
    <div className="flex flex-col gap-1 rounded-[8px] bg-orange-tint px-3 py-2.5">
      <div className="text-[12.5px] font-semibold text-warn">Not used · {lowerFirst(text.label)}</div>
      <div className="text-[12.5px] leading-normal text-ink">{text.text}</div>
    </div>
  );
}

function Summary({ summary }: { summary: ResearchSummary }) {
  const stats: [number, string][] = [
    [summary.kept, summary.kept === 1 ? "source kept" : "sources kept"],
    [summary.skipped, summary.skipped === 1 ? "page skipped" : "pages skipped"],
    [summary.rounds, summary.rounds === 1 ? "search round" : "search rounds"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[15px] font-semibold text-ink">
        {summary.stopped ? "Research stopped" : "Research finished"}
        {summary.elapsedMs !== null ? ` in ${elapsedText(summary.elapsedMs)}` : ""}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {stats.map(([value, label]) => (
          <div key={label} className="flex flex-col-reverse rounded-[8px] bg-inset p-2.5">
            <dt className="text-[12px] text-ink-2">{label}</dt>
            <dd className="text-[20px] font-semibold text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12.5px] leading-normal text-ink-2">Select any row in the activity list to see what was read, or a source chip in the analysis.</p>
    </div>
  );
}

export default function LiveView({
  state,
  target,
  pinned,
  live,
  onBack,
}: {
  state: AnalysisViewState;
  target: LiveTarget;
  pinned: boolean;
  /** The run is still researching (so "Back to live" follows it again). */
  live: boolean;
  onBack: () => void;
}) {
  const { host, rest } = address(target);
  const status = pill(target);

  return (
    <div role="region" aria-label="Live view" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line bg-inset pl-2.5 pr-2">
        <Globe size={13} aria-hidden className="shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
          <span className="text-ink">{host}</span>
          {rest}
        </div>
        {pinned && (
          <button
            type="button"
            onClick={onBack}
            className="h-6 shrink-0 rounded-[6px] border border-line-strong bg-surface px-2 text-[11.5px] text-ink transition-colors duration-150 hover:bg-hover"
          >
            {live ? "Back to live" : "Back to summary"}
          </button>
        )}
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-3">
        {target.kind === "idle" && (
          <div className="m-auto flex max-w-[300px] flex-col items-center gap-2 text-center">
            {live && <Spinner size={16} />}
            <div className="text-[13px] text-ink">{target.title}</div>
            <div className="text-[12px] text-ink-2">{target.text}</div>
          </div>
        )}

        {target.kind === "search" && (
          <>
            <div className="flex h-[34px] shrink-0 items-center gap-2 rounded-full border border-line-strong px-3 text-[13px] text-ink">
              <Search size={14} aria-hidden className="shrink-0 text-ink-2" />
              <span className="truncate">{target.query}</span>
            </div>
            {target.pending && <SkeletonLines widths={["70%", "88%", "62%"]} />}
            {target.results?.failed && (
              <div className="flex flex-col gap-1 rounded-[8px] bg-orange-tint px-3 py-2.5">
                <div className="text-[12.5px] font-semibold text-warn">Search failed</div>
                <div className="text-[12.5px] leading-normal text-ink">The web search did not return results, so nothing was read from it.</div>
              </div>
            )}
            {target.results && !target.results.failed && <SearchHits state={state} results={target.results} />}
          </>
        )}

        {target.kind === "loading" && (
          <>
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
              {target.pending && <Spinner />}
              {target.pending ? `Reading ${target.fetch.domain}…` : "No outcome was recorded for this request before the run ended."}
            </div>
            {target.pending && <SkeletonLines widths={["76%", "94%", "90%", "58%"]} />}
          </>
        )}

        {target.kind === "source" && <SourcePage target={target} />}

        {target.kind === "rejected" && (
          <>
            <div className="flex items-center gap-2">
              <Monogram letter={monogram(target.rejection.domain ?? target.rejection.title)} size="sm" />
              <span className="text-[12px] text-ink-2">{target.rejection.domain}</span>
            </div>
            <div className="text-[16px] font-semibold leading-snug text-ink-2 line-through">{target.rejection.title}</div>
            <NotUsed reason={target.rejection.reason} />
            {target.rejection.fetchMs !== null && <div className="text-[12px] text-ink-2">Request took {formatDuration(target.rejection.fetchMs)}</div>}
          </>
        )}

        {target.kind === "skipped" && (
          <>
            <div className="flex items-center gap-2">
              <Monogram letter={monogram(target.skip.domain)} size="sm" />
              <span className="text-[12px] text-ink-2">{target.skip.domain}</span>
            </div>
            <div className="break-all font-mono text-[12.5px] leading-snug text-ink-2 line-through">{target.skip.url}</div>
            <NotUsed reason={target.skip.reason} />
          </>
        )}

        {target.kind === "summary" && <Summary summary={target.summary} />}
      </div>
    </div>
  );
}

function SearchHits({ state, results }: { state: AnalysisViewState; results: NonNullable<Extract<LiveTarget, { kind: "search" }>["results"]> }) {
  const states = hitStates(state, results.hits);
  const tone: Record<string, PillTone> = { reading: "accent", kept: "gain", skipped: "warn" };
  const label: Record<string, string> = { reading: "Reading", kept: "Kept", skipped: "Skipped" };
  return (
    <>
      <div className="text-[11.5px] text-ink-2">
        {formatCount(results.total)} {results.total === 1 ? "result" : "results"}
        {results.hits.length > 0 ? ` · top ${results.hits.length} shown` : ""}
      </div>
      <ul className="flex flex-col gap-2.5">
        {results.hits.map((hit) => {
          const s = states.get(hit.url);
          return (
            <li key={hit.url} className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[12.5px] font-medium text-accent-text">{hit.title}</span>
                <span className="truncate text-[11.5px] text-ink-2">
                  {hit.domain}
                  {hit.published_at ? ` · ${formatDay(hit.published_at)}` : ""}
                </span>
              </div>
              {s && <Tag tone={tone[s]}>{label[s]}</Tag>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SourcePage({ target }: { target: Extract<LiveTarget, { kind: "source" }> }) {
  const { source } = target;
  const note = readNote(source.fetchMs, source.textChars);
  const meta = [source.publisher ?? source.domain, formatDay(source.published_at)].filter(Boolean).join(" · ");
  return (
    <>
      <div className="flex items-center gap-2">
        <Monogram letter={monogram(source.publisher ?? source.domain)} tone={sourceTone(source.source_type)} size="sm" />
        <span className="min-w-0 truncate text-[12px] text-ink-2">{meta}</span>
      </div>
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
        className="group inline-flex items-start gap-1.5 text-[16px] font-semibold leading-snug text-ink hover:underline"
      >
        <span className="min-w-0 break-words">{source.title}</span>
        <ExternalLink size={13} aria-hidden className="mt-1.5 shrink-0 text-ink-2" />
      </a>
      <div className="flex flex-wrap gap-1.5">
        <Tag tone={source.freshness === "current" ? "gain" : source.freshness === "recent" ? "accent" : source.freshness === "stale" ? "warn" : "neutral"}>
          {freshnessLabel(source.freshness)}
        </Tag>
        {source.is_primary && <Tag>Primary source</Tag>}
      </div>
      {source.excerpt ? (
        <figure className="flex flex-col gap-1.5 rounded-[8px] bg-accent-tint px-3 py-2.5">
          <figcaption className="text-[11px] font-semibold uppercase tracking-[0.03em] text-accent-text">Captured for the analysis</figcaption>
          <blockquote className="text-[13px] leading-[1.55] text-ink">{source.excerpt}</blockquote>
        </figure>
      ) : source.preview && source.preview.rows.length > 0 ? null : (
        <p className="text-[12.5px] leading-normal text-ink-2">
          {source.redistribution === "metadata_only"
            ? "Excerpt not shown: this source's terms don't allow redistribution."
            : source.redistribution === "allowed"
              ? "No excerpt was captured from this source."
              : "Excerpt not shown: this source's redistribution terms aren't known."}
        </p>
      )}
      {source.preview && source.preview.rows.length > 0 && (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {source.preview.columns.map((column, i) => (
                <th key={i} scope="col" className={`border-b border-line px-1.5 py-1 font-medium text-ink-2 ${i === 0 ? "text-left" : "text-right"}`}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {source.preview.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} className={`border-b border-line px-1.5 py-1 text-ink ${i === 0 ? "text-left" : "text-right font-mono"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <div className="text-[12px] text-ink-2">{note}</div>}
    </>
  );
}
