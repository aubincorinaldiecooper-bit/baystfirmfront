"use client";

/* Live progress from recorded events only: the trace (one step per received
 * phase event) and the sources found or rejected so far. No percentages, no
 * timers. */

import ThinkingState from "@/components/primitives/ThinkingState";
import type { AnalysisViewState } from "@/lib/analysis/reducer";
import { isTerminalUiStatus } from "@/lib/analysis/reducer";
import { freshnessLabel, freshnessTone, humanizeName, sourceTypeLabel } from "@/lib/analysis/labels";
import { phaseLabel, progressSteps } from "@/lib/analysis/progress";
import { Badge } from "./ui";

export function ProgressTrace({ state }: { state: AnalysisViewState }) {
  const steps = progressSteps(state);
  const active = !isTerminalUiStatus(state.status);
  return (
    <div className="[&>div]:max-w-full">
      <ThinkingState label={phaseLabel(state)} active={active} steps={steps} />
    </div>
  );
}

export function LiveSources({ state }: { state: AnalysisViewState }) {
  const { sources } = state;
  const rejected = state.research.rejected;
  if (sources.length === 0 && rejected.length === 0) return null;
  return (
    <details className="rounded-[10px] bg-surface p-3 shadow-card" open={!isTerminalUiStatus(state.status)}>
      <summary className="cursor-pointer text-[13px] font-medium text-ink">
        Sources found <span className="tabular-nums text-ink-2">{sources.length}</span>
        {rejected.length > 0 && <span className="text-ink-3"> · {rejected.length} rejected</span>}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {sources.map((source) => (
          <li key={source.source_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
            <a href={source.url} target="_blank" rel="noreferrer noopener" className="min-w-0 max-w-full truncate font-medium text-ink hover:underline">
              {source.title}
            </a>
            <span className="text-ink-3">{[source.publisher, sourceTypeLabel(source.source_type)].filter(Boolean).join(" · ")}</span>
            <Badge tone={freshnessTone(source.freshness)}>{freshnessLabel(source.freshness)}</Badge>
          </li>
        ))}
        {rejected.map((item) => (
          <li key={`rejected-${item.seq}`} className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
            <span className="min-w-0 max-w-full truncate line-through">{item.title}</span>
            <span>rejected: {humanizeName(item.reason)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
