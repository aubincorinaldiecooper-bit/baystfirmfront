"use client";

/* The live research dock at the bottom of the main window: what research is
 * doing now (from the latest recorded events), counts, a filter, and, when
 * open, the live view beside the activity feed (stacked on narrow widths). */

import { ChevronDown, ChevronUp } from "lucide-react";
import {
  activityLabel,
  feedCounts,
  filterFeed,
  liveTarget,
  researchLive,
  researchSummary,
  type FeedFilter,
  type FeedItem,
  type LiveSource,
} from "@/lib/analysis/activity";
import { isTerminalUiStatus, type AnalysisViewState } from "@/lib/analysis/reducer";
import { formatClock, formatDuration } from "@/lib/market/format";
import ActivityFeed from "./ActivityFeed";
import { Pill, Segmented } from "./controls";
import LiveView from "./LiveView";

export const DOCK_BODY_ID = "live-research-body";

/** Elapsed research time from event times: "850 ms", "12.4 s", "2:05". */
export function elapsedLabel(ms: number): string {
  return ms < 60_000 ? formatDuration(ms) : formatClock(ms);
}

export default function ResearchDock({
  state,
  items,
  sources,
  open,
  onToggle,
  pinned,
  onPin,
  onUnpin,
  filter,
  onFilter,
}: {
  state: AnalysisViewState;
  items: readonly FeedItem[];
  sources: Map<string, LiveSource>;
  open: boolean;
  onToggle: () => void;
  pinned: string | null;
  onPin: (key: string) => void;
  onUnpin: () => void;
  filter: FeedFilter;
  onFilter: (filter: FeedFilter) => void;
}) {
  const live = researchLive(state);
  const counts = feedCounts(items);
  const summary = researchSummary(state);
  const { target, pinned: isPinned } = liveTarget(state, items, sources, pinned);
  const shown = filterFeed(items, filter);
  const rounds = summary?.rounds ?? state.research.rounds;
  const elapsed = summary?.elapsedMs != null ? elapsedLabel(summary.elapsedMs) : null;
  const stats = [rounds > 0 ? `Round ${rounds}` : null, `${counts.kept} kept`, `${counts.skipped} skipped`, elapsed].filter(Boolean).join(" · ");
  const status = live
    ? { label: "Live", tone: "accent" as const, pulse: true }
    : !summary
      ? { label: isTerminalUiStatus(state.status) ? "No research" : "Waiting", tone: "neutral" as const, pulse: false }
      : summary.stopped
        ? { label: "Stopped", tone: "warn" as const, pulse: false }
        : { label: elapsed ? `Finished in ${elapsed}` : "Finished", tone: "gain" as const, pulse: false };
  const emptyText =
    filter === "kept"
      ? "Nothing kept yet. Sources appear here as they are read."
      : filter === "skipped"
        ? "Nothing skipped."
        : live
          ? "Research activity appears here as it happens."
          : "No research activity was recorded for this analysis.";

  return (
    <section aria-labelledby="live-research-heading" className="@container flex shrink-0 flex-col border-t border-line bg-inset">
      <div className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1.5 py-1.5 pl-4 pr-2.5">
        {/* inline nowrap: the global heading `text-wrap: balance` would otherwise win over the utility */}
        <h2 id="live-research-heading" className="shrink-0 text-[13px] font-semibold text-ink" style={{ whiteSpace: "nowrap" }}>
          Live research
        </h2>
        <Pill tone={status.tone} pulse={status.pulse}>
          {status.label}
        </Pill>
        <span className={`min-w-24 flex-1 basis-0 truncate text-[12.5px] text-ink ${live ? "animate-pulse" : ""}`}>
          {activityLabel(state, items)}
        </span>
        <span className="min-w-0 truncate text-[12px] text-ink-2 @max-[600px]:sr-only">{stats}</span>
        {open && (
          <Segmented
            className="@max-[560px]:order-last"
            label="Filter research activity"
            size="sm"
            value={filter}
            onChange={onFilter}
            options={[
              { value: "all", label: "All" },
              { value: "kept", label: `Kept ${counts.kept}`, ariaLabel: `Kept, ${counts.kept}` },
              { value: "skipped", label: `Skipped ${counts.skipped}`, ariaLabel: `Skipped, ${counts.skipped}` },
            ]}
          />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={DOCK_BODY_ID}
          aria-label={open ? "Collapse live research" : "Expand live research"}
          onClick={onToggle}
          className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 transition-colors duration-150 hover:bg-hover-2 hover:text-ink"
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronUp size={15} aria-hidden />}
        </button>
      </div>
      {open && (
        <div id={DOCK_BODY_ID} className="flex h-[260px] min-h-0 gap-0 pb-2.5 pl-3 @max-[720px]:h-auto @max-[720px]:flex-col @max-[720px]:gap-2 @max-[720px]:pr-3">
          <div className="flex w-[420px] shrink-0 flex-col @max-[720px]:h-[240px] @max-[720px]:w-full">
            <LiveView state={state} target={target} pinned={isPinned} live={live} onBack={onUnpin} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col @max-[720px]:max-h-[280px]">
            <ActivityFeed items={shown} pinned={pinned} following={!pinned && filter === "all"} emptyText={emptyText} onPin={onPin} />
          </div>
        </div>
      )}
    </section>
  );
}
