/**
 * The progress trace, derived from recorded events only.
 *
 * Every step below is one received milestone event (`state.milestones`), in
 * seq order: nothing is added on a timer, nothing is estimated, and there are
 * no percentages. A step's label is a product-level description of the stage
 * that event opened; Laya's questions, answers and probabilities are never
 * shown, only which stage ran. Counts in the details are the backend's own
 * numbers from the event payloads, or the number of events received.
 */

import { HORIZON_LABELS, type ResolvedHorizon } from "@/lib/api/types";
import { isTerminalUiStatus, type AnalysisViewState, type Milestone } from "./reducer";

export type ProgressStepStatus = "active" | "done" | "stopped";

export interface ProgressStep {
  /** `step-<seq>`: one step per milestone event. */
  id: string;
  seq: number;
  event: Milestone["event"];
  label: string;
  detail?: string;
  status: ProgressStepStatus;
}

/** Product-level names for the Laya stages the backend documents; anything else is generic. */
const LAYA_STAGE_LABELS: Record<string, string> = {
  research_plan: "Deciding whether more research is needed",
  evidence_scan: "Scoring the evidence",
  history_scan: "Reviewing the company's history",
  text_evidence: "Classifying the text evidence",
  horizon: "Assessing each horizon",
};

export function layaStageLabel(stage: string): string {
  return LAYA_STAGE_LABELS[stage] ?? "Evaluating the evidence";
}

const QUERY_KIND_LABELS: Record<string, string> = {
  edgar_submissions: "SEC EDGAR",
  edgar_companyfacts: "SEC EDGAR",
  prices: "Prices",
  benchmarks: "Benchmarks",
  search: "Web search",
};

export function queryKindLabel(kind: string): string {
  return QUERY_KIND_LABELS[kind] ?? kind;
}

export function profileLabel(profile: string | null): string {
  if (profile === "fast") return "Fast";
  if (profile === "deep") return "Deep";
  return profile ?? "";
}

export function horizonLabel(horizon: string | null): string {
  if (!horizon) return "";
  return HORIZON_LABELS[horizon as ResolvedHorizon] ?? horizon;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Steps that describe an instant (done on arrival) rather than work that runs until the next event. */
const INSTANT: ReadonlySet<Milestone["event"]> = new Set([
  "analysis.started",
  "instrument.resolved",
  "research.started",
  "research.completed",
  "normalization.completed",
]);

export function progressSteps(state: AnalysisViewState): ProgressStep[] {
  const { milestones } = state;
  const terminal = isTerminalUiStatus(state.status);
  const interrupted = state.status === "failed" || state.status === "cancelled";
  const queriesBySeq = new Map(state.research.queries.map((q) => [q.seq, q]));

  return milestones.map((milestone, index) => {
    const superseded = index < milestones.length - 1;
    const base = { id: `step-${milestone.seq}`, seq: milestone.seq, event: milestone.event };
    const { label, detail, finished } = describe(milestone, state, queriesBySeq, isLastOfStage(milestones, index));
    let status: ProgressStepStatus;
    if (INSTANT.has(milestone.event) || finished || superseded) status = "done";
    else if (!terminal) status = "active";
    else status = interrupted ? "stopped" : "done";
    return { ...base, label, ...(detail ? { detail } : {}), status };
  });
}

function isLastOfStage(milestones: Milestone[], index: number): boolean {
  const current = milestones[index];
  if (current.event !== "laya.started") return true;
  return !milestones.slice(index + 1).some((m) => m.event === "laya.started" && m.key === current.key);
}

function describe(
  milestone: Milestone,
  state: AnalysisViewState,
  queriesBySeq: Map<number, AnalysisViewState["research"]["queries"][number]>,
  lastOfStage: boolean,
): { label: string; detail?: string; finished?: boolean } {
  switch (milestone.event) {
    case "analysis.started":
      return {
        label: "Analysis started",
        detail: [profileLabel(state.profile), horizonLabel(state.resolvedHorizon)].filter(Boolean).join(" · "),
      };
    case "instrument.resolved": {
      const instrument = state.instrument;
      return {
        label: instrument ? `Identified ${instrument.name}` : "Identified the company",
        detail: instrument ? [instrument.symbol, instrument.exchange].filter(Boolean).join(" · ") : undefined,
      };
    }
    case "research.started":
      return { label: `Research round ${milestone.key ?? ""}`.trim() };
    case "research.query": {
      const query = queriesBySeq.get(milestone.seq);
      return { label: query ? query.label : "Research query", detail: query ? queryKindLabel(query.kind) : undefined };
    }
    case "research.completed": {
      const stats = state.research.stats;
      return {
        label: "Research finished",
        detail: stats
          ? `${plural(stats.sources_fetched, "source", "sources")} · ${stats.sources_rejected} rejected`
          : undefined,
      };
    }
    case "normalization.completed": {
      const n = state.normalization;
      return {
        label: "Evidence normalized",
        detail: n ? `${plural(n.facts, "fact", "facts")} · ${plural(n.conflicts, "conflict", "conflicts")}` : undefined,
      };
    }
    case "laya.started": {
      const stage = milestone.key ?? "";
      const progress = state.laya[stage];
      return { label: layaStageLabel(stage), finished: lastOfStage && progress?.status === "completed" };
    }
    case "calculation.started": {
      const count = state.calculations.items.length;
      return { label: "Running the deterministic calculations", detail: count > 0 ? `${count} recorded` : undefined };
    }
    case "spark.queued":
      return {
        label: "Waiting for the synthesis model",
        detail:
          state.spark.activeAnalyses !== null
            ? `${plural(state.spark.activeAnalyses, "analysis", "analyses")} active`
            : undefined,
      };
    case "spark.loading":
      return { label: "Loading the synthesis model", detail: profileLabel(state.profile) || undefined };
    case "spark.started":
      return {
        label: "Writing the assessment",
        detail: state.spark.truncated ? "cut off" : undefined,
        finished: state.spark.phase === "completed" && !isInterrupted(state),
      };
    default:
      return { label: milestone.event };
  }
}

function isInterrupted(state: AnalysisViewState): boolean {
  return state.status === "failed" || state.status === "cancelled";
}

/** Header text for the trace: the current recorded phase, or the outcome. */
export function phaseLabel(state: AnalysisViewState): string {
  switch (state.status) {
    case "idle":
      return "Not started";
    case "submitting":
      return "Submitting";
    case "queued":
      return "Queued";
    case "resolving":
      return "Identifying the company";
    case "researching":
      return "Researching";
    case "normalizing":
      return "Normalizing the evidence";
    case "scoring":
      return "Scoring the evidence";
    case "calculating":
      return "Calculating";
    case "synthesizing":
      switch (state.spark.phase) {
        case "queued":
          return "Waiting for the synthesis model";
        case "loading":
          return "Loading the synthesis model";
        case "streaming":
          return "Writing the assessment";
        case "completed":
          return "Assembling the result";
        default:
          return "Preparing the synthesis";
      }
    case "completed":
      return "Analysis complete";
    case "failed":
      return "Analysis failed";
    case "cancelled":
      return "Analysis cancelled";
    default:
      return state.status;
  }
}
