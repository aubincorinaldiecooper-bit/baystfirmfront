"use client";

/* Live progress from recorded events only: the trace, one step per received
 * phase event. No percentages, no timers. (Sources found or rejected so far
 * are shown by the live research dock.) */

import ThinkingState from "@/components/primitives/ThinkingState";
import type { AnalysisViewState } from "@/lib/analysis/reducer";
import { isTerminalUiStatus } from "@/lib/analysis/reducer";
import { phaseLabel, progressSteps } from "@/lib/analysis/progress";

export function ProgressTrace({ state }: { state: AnalysisViewState }) {
  const steps = progressSteps(state);
  const active = !isTerminalUiStatus(state.status);
  return (
    <div className="[&>div]:max-w-full">
      <ThinkingState label={phaseLabel(state)} active={active} steps={steps} />
    </div>
  );
}
