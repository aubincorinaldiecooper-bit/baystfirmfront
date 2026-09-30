"use client";

/* The activity feed: one row per recorded research event, in order. Rows
 * that show something in the live view are buttons; choosing one pins it
 * there. While following the run, the list keeps its newest row in view. */

import { useEffect, useRef } from "react";
import { Check, Search, X } from "lucide-react";
import { reasonText, type FeedItem, type ResearchSummary } from "@/lib/analysis/activity";
import { freshnessLabel, humanizeName, sourceTypeLabel } from "@/lib/analysis/labels";
import { formatCount, formatDay, formatDuration, monogram, pathOf } from "@/lib/market/format";
import { cn } from "@/lib/utils";
import { Monogram, Spinner, Tag, sourceTone } from "./controls";

const TERMINATION: Record<string, string> = {
  evidence_sufficient: "Stopped: enough evidence to answer the question",
};

function terminationText(reason: string | null): string | null {
  if (!reason) return null;
  return TERMINATION[reason] ?? `Stopped: ${humanizeName(reason).toLowerCase()}`;
}

/** "retrieve_recent_news" → "Recent news". */
function intentLabel(intent: string): string {
  return humanizeName(intent.replace(/^retrieve_/, ""));
}

function summaryLine(summary: ResearchSummary): string {
  return [
    `${summary.kept} ${summary.kept === 1 ? "source" : "sources"} kept`,
    `${summary.skipped} skipped`,
    `${summary.rounds} ${summary.rounds === 1 ? "round" : "rounds"}`,
  ].join(" · ");
}

const ROW = "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-150";

export default function ActivityFeed({
  items,
  pinned,
  following,
  emptyText,
  onPin,
}: {
  items: readonly FeedItem[];
  pinned: string | null;
  /** The live view follows the run: keep the newest row in view. */
  following: boolean;
  emptyText: string;
  onPin: (key: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list && following) list.scrollTop = list.scrollHeight;
  }, [items.length, following]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinned) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>("[data-feed-key]")).find((el) => el.dataset.feedKey === pinned);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [pinned]);

  if (items.length === 0) {
    return <p className="px-4 py-5 text-[12.5px] text-ink-2">{emptyText}</p>;
  }

  return (
    <ol ref={listRef} aria-label="Research activity" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-1 pr-1">
      {items.map((item) => {
        const current = pinned === item.key || (item.kind !== "round" && item.kind !== "finished" && "fetch" in item && item.fetch && pinned === `fetch-${item.fetch.seq}`);
        return (
          <li key={item.key} data-feed-key={item.key} style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
            <Row item={item} current={Boolean(current)} onPin={onPin} />
          </li>
        );
      })}
    </ol>
  );
}

function Row({ item, current, onPin }: { item: FeedItem; current: boolean; onPin: (key: string) => void }) {
  const selected = current ? "true" : undefined;
  switch (item.kind) {
    case "round":
      return (
        <div className="flex flex-col gap-0.5 px-4 pb-1.5 pt-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2">Round {item.round}</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </div>
          {item.intents.length > 0 && <div className="text-[13px] font-semibold text-ink">{item.intents.map(intentLabel).join(", ")}</div>}
          {item.gaps.length > 0 && <div className="text-[12px] text-ink-2">Looking for: {item.gaps.join(", ")}</div>}
        </div>
      );
    case "search": {
      const results = item.results;
      return (
        <div className="px-2.5 py-0.5">
          <button
            type="button"
            aria-current={selected}
            onClick={() => onPin(item.key)}
            className={cn(ROW, item.pending ? "bg-accent-tint" : current ? "bg-hover-2" : "hover:bg-hover")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface text-ink-2">
              <Search size={14} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-[12px] text-ink-2">{item.pending ? "Searching the web" : "Searched the web"}</span>
              <span className="truncate text-[13px] text-ink">“{item.query}”</span>
            </span>
            {item.pending ? (
              <Spinner />
            ) : results?.failed ? (
              <Tag tone="warn">Search failed</Tag>
            ) : results ? (
              <span className="shrink-0 whitespace-nowrap text-[12px] text-ink-2">
                {formatCount(results.total)} {results.total === 1 ? "result" : "results"}
              </span>
            ) : null}
          </button>
        </div>
      );
    }
    case "reading":
      return (
        <div className="px-2.5 py-0.5">
          <button
            type="button"
            aria-current={selected}
            onClick={() => onPin(item.key)}
            className={cn(ROW, item.pending ? "bg-accent-tint" : current ? "bg-hover-2" : "hover:bg-hover")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface">
              {item.pending ? <Spinner /> : <X size={13} aria-hidden className="text-ink-2" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-[13px] text-ink">
                {item.pending ? "Reading" : "Requested"} <strong className="font-semibold">{item.fetch.domain}</strong>
                {!item.pending && <span className="text-ink-2"> · no outcome recorded</span>}
              </span>
              <span className="truncate font-mono text-[11.5px] text-ink-2">{pathOf(item.fetch.url) || item.fetch.url}</span>
            </span>
          </button>
        </div>
      );
    case "kept": {
      const { source } = item;
      const meta = [source.publisher ?? source.domain, sourceTypeLabel(source.source_type), formatDay(source.published_at)].filter(Boolean).join(" · ");
      return (
        <div className="px-2.5 py-1">
          <button
            type="button"
            aria-current={selected}
            onClick={() => onPin(item.key)}
            className={cn(
              "flex w-full gap-2.5 rounded-[10px] border bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-150",
              current ? "border-accent shadow-[0_0_0_3px_var(--accent-tint)]" : "border-line hover:border-line-strong",
            )}
          >
            <Monogram letter={monogram(source.publisher ?? source.domain)} tone={sourceTone(source.source_type)} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-semibold leading-snug text-ink">{source.title}</span>
                {source.fetchMs !== null && <span className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-2">{formatDuration(source.fetchMs)}</span>}
              </span>
              <span className="text-[12px] text-ink-2">{meta}</span>
              <span className="flex flex-wrap gap-1.5">
                <Tag tone={source.freshness === "current" ? "gain" : source.freshness === "recent" ? "accent" : source.freshness === "stale" ? "warn" : "neutral"}>
                  {freshnessLabel(source.freshness)}
                </Tag>
                {source.is_primary && <Tag>Primary source</Tag>}
              </span>
              {source.excerpt && <span className="line-clamp-3 text-[12.5px] leading-normal text-ink-2">{source.excerpt}</span>}
            </span>
          </button>
        </div>
      );
    }
    case "rejected":
    case "skipped": {
      const title = item.kind === "rejected" ? item.rejection.title : pathOf(item.skip.url) || item.skip.url;
      const domain = item.kind === "rejected" ? item.rejection.domain : item.skip.domain;
      const reason = item.kind === "rejected" ? item.rejection.reason : item.skip.reason;
      return (
        <div className="px-2.5 py-0.5">
          <button type="button" aria-current={selected} onClick={() => onPin(item.key)} className={cn(ROW, current ? "bg-hover-2" : "hover:bg-hover")}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-line-strong text-ink-2">
              <X size={13} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-[13px] text-ink-2 line-through">{title}</span>
              <span className="truncate text-[12px] text-ink-2">{domain}</span>
            </span>
            <Tag tone="warn" className="block max-w-[48%] shrink truncate">
              {reasonText(reason).label}
            </Tag>
          </button>
        </div>
      );
    }
    case "finished": {
      const why = terminationText(item.summary.termination);
      return (
        <div className="mx-2.5 mb-1 mt-2.5 flex gap-2.5 rounded-[10px] bg-green-tint p-3">
          <Check size={16} aria-hidden className="mt-px shrink-0 text-gain" />
          <div className="flex flex-col gap-0.5">
            <div className="text-[13px] font-semibold text-ink">Research finished</div>
            <div className="text-[12px] text-ink-2">{summaryLine(item.summary)}</div>
            {why && <div className="text-[12px] text-ink-2">{why}</div>}
          </div>
        </div>
      );
    }
  }
}
