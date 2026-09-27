/**
 * Pure, deterministic reducer from the analysis event stream into UI state
 * (frontend spec section 22). No timers, no synthetic progress, no
 * chain-of-thought: every field below is a recorded backend state.
 *
 * `applyEvent` is idempotent on replayed events (dedupe by `seq`) and ignores
 * events for another analysis. `analysisReducer` wraps it with the few
 * non-event lifecycle actions a `useReducer` needs (submit, created, result,
 * request failure, reset).
 */

import type {
  AnalysisEvent,
  AnalysisEventOf,
  AnalysisResult,
  AnalysisStatus,
  AnalysisSummary,
  CalculationEventView,
  CreateAnalysisResponse,
  ErrorPayload,
  EventName,
  ExecutionInfo,
  InstrumentResolvedData,
  LayaDecisionEventView,
  LayaStage,
  NormalizationCompletedData,
  Profile,
  ResearchStats,
  ResolvedHorizon,
  SourcePublicView,
} from "@/lib/api/types";
import { isTerminalStatus } from "@/lib/api/types";
import { requirementLabels } from "./requirements";

/* ── state ───────────────────────────────────────────────── */

/**
 * Spec section 22's list plus `resolving`, which mirrors the backend's
 * `resolving_instrument` status between `analysis.started` and the first
 * `research.started` (the backend is identifying the company then).
 */
export type AnalysisUIStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "resolving"
  | "researching"
  | "normalizing"
  | "scoring"
  | "calculating"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export const ACTIVE_STATUSES: readonly AnalysisUIStatus[] = [
  "submitting",
  "queued",
  "resolving",
  "researching",
  "normalizing",
  "scoring",
  "calculating",
  "synthesizing",
];

export interface ResearchProgress {
  started: boolean;
  completed: boolean;
  /** Highest `round` seen on research events. */
  rounds: number;
  queriesIssued: number;
  sourcesFound: number;
  sourcesRejected: number;
  /** Intents planned in the latest round. */
  intents: string[];
  /** Evidence gaps reported at the start of the latest round. */
  evidenceGaps: string[];
  /** The query currently running, for a compact research trace. */
  currentQuery: { intent: string; kind: string; label: string; round: number } | null;
  /** Every `research.query`, in seq order. */
  queries: ResearchQueryView[];
  /** Every `research.source_rejected`, in seq order. */
  rejected: RejectedSourceView[];
  /** Product-level requirement labels from `research.started` (backend PR #4, optional). */
  requirements: string[];
  /** `research.completed` payload (`ResearchStats`). */
  stats: ResearchStats | null;
}

export interface ResearchQueryView {
  seq: number;
  intent: string;
  kind: string;
  label: string;
  round: number;
}

export interface RejectedSourceView {
  seq: number;
  url: string;
  title: string;
  /** A fixed backend keyword, never upstream text. */
  reason: string;
  round: number;
}

export interface SourceView extends SourcePublicView {
  intent: string;
  round: number;
  seq: number;
}

export interface LayaStageProgress {
  stage: LayaStage;
  status: "running" | "completed";
  questions: number;
  questionSets: number | null;
  /** Count reported by `laya.completed`; decisions.length while running. */
  decisionCount: number;
  decisions: LayaDecisionEventView[];
}

export interface CalculationProgress {
  started: boolean;
  pack: string | null;
  items: CalculationEventView[];
}

export type SparkPhase = "idle" | "queued" | "loading" | "streaming" | "completed";

export interface SparkProgress {
  phase: SparkPhase;
  activeAnalyses: number | null;
  contextCeiling: number | null;
  kvCacheType: string | null;
  promptTokens: number | null;
  horizons: string[];
  /** Concatenated `spark.token` text, in seq order. */
  text: string;
  tokenEvents: number;
  outputTokens: number | null;
  timeToFirstTokenMs: number | null;
  totalMs: number | null;
  tokensPerSecond: number | null;
  truncated: boolean;
}

export interface AnalysisViewState {
  status: AnalysisUIStatus;
  analysisId: string | null;
  query: string;
  profile: Profile | null;
  resolvedHorizon: ResolvedHorizon | null;
  asOf: string | null;
  execution: ExecutionInfo | null;
  instrument: InstrumentResolvedData | null;
  /** Seq of the last applied event; events at or below it are ignored. */
  lastSeq: number;
  eventCount: number;
  research: ResearchProgress;
  sources: SourceView[];
  normalization: NormalizationCompletedData | null;
  /** Keyed by Laya stage, in order of first appearance. */
  laya: Record<string, LayaStageProgress>;
  layaStageOrder: string[];
  calculations: CalculationProgress;
  spark: SparkProgress;
  totalRequestMs: number | null;
  error: ErrorPayload | null;
  /** Some content was preserved after a cancel/failure, or a completed synthesis was cut off. */
  partial: boolean;
  /** The canonical structured result from `GET /analyses/{id}`. */
  result: AnalysisResult | null;
  /** The stream could not be recovered and the durable state should be fetched. */
  streamFallback: boolean;
  /** `POST /cancel` was accepted; the terminal event still decides the outcome. */
  cancelRequested: boolean;
  /** One entry per received phase event, in seq order: the progress trace's source. */
  milestones: Milestone[];
}

/** Events that mark a step of the recorded progress (tokens, decisions and per-item events do not). */
export const MILESTONE_EVENTS = [
  "analysis.started",
  "instrument.resolved",
  "research.started",
  "research.query",
  "research.completed",
  "normalization.completed",
  "laya.started",
  "calculation.started",
  "spark.queued",
  "spark.loading",
  "spark.started",
] as const satisfies readonly EventName[];
export type MilestoneEvent = (typeof MILESTONE_EVENTS)[number];

export interface Milestone {
  seq: number;
  event: MilestoneEvent;
  /** The Laya stage for `laya.started`, the round for `research.started`. */
  key: string | null;
}

function isMilestoneEvent(name: EventName): name is MilestoneEvent {
  return (MILESTONE_EVENTS as readonly string[]).includes(name);
}

export const initialResearch: ResearchProgress = {
  started: false,
  completed: false,
  rounds: 0,
  queriesIssued: 0,
  sourcesFound: 0,
  sourcesRejected: 0,
  intents: [],
  evidenceGaps: [],
  currentQuery: null,
  queries: [],
  rejected: [],
  requirements: [],
  stats: null,
};

export const initialSpark: SparkProgress = {
  phase: "idle",
  activeAnalyses: null,
  contextCeiling: null,
  kvCacheType: null,
  promptTokens: null,
  horizons: [],
  text: "",
  tokenEvents: 0,
  outputTokens: null,
  timeToFirstTokenMs: null,
  totalMs: null,
  tokensPerSecond: null,
  truncated: false,
};

export const initialAnalysisState: AnalysisViewState = {
  status: "idle",
  analysisId: null,
  query: "",
  profile: null,
  resolvedHorizon: null,
  asOf: null,
  execution: null,
  instrument: null,
  lastSeq: 0,
  eventCount: 0,
  research: initialResearch,
  sources: [],
  normalization: null,
  laya: {},
  layaStageOrder: [],
  calculations: { started: false, pack: null, items: [] },
  spark: initialSpark,
  totalRequestMs: null,
  error: null,
  partial: false,
  result: null,
  streamFallback: false,
  cancelRequested: false,
  milestones: [],
};

/* ── event application ───────────────────────────────────── */

/** Laya stages that belong to the scoring phase; `research_plan` runs inside research, `horizon` after the calculations. */
const SCORING_STAGES: ReadonlySet<string> = new Set(["evidence_scan", "history_scan", "text_evidence"]);

export function applyEvent(state: AnalysisViewState, event: AnalysisEvent): AnalysisViewState {
  const next = reduceEvent(state, event);
  if (next === state || !isMilestoneEvent(event.event)) return next;
  const key =
    event.event === "laya.started" ? event.stage : event.event === "research.started" ? String(event.round) : null;
  return { ...next, milestones: [...next.milestones, { seq: event.seq, event: event.event, key }] };
}

function reduceEvent(state: AnalysisViewState, event: AnalysisEvent): AnalysisViewState {
  if (state.analysisId !== null && event.analysis_id !== state.analysisId) return state;
  if (typeof event.seq !== "number" || event.seq <= state.lastSeq) return state;
  /* a terminal state never moves again, whatever arrives late */
  if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
    return state;
  }
  const base: AnalysisViewState = {
    ...state,
    analysisId: state.analysisId ?? event.analysis_id,
    lastSeq: event.seq,
    eventCount: state.eventCount + 1,
  };
  switch (event.event) {
    case "analysis.started":
      return {
        ...base,
        status: "resolving",
        query: event.query,
        profile: event.profile,
        resolvedHorizon: event.resolved_horizon,
        asOf: event.as_of,
        execution: event.execution ?? null,
      };
    case "instrument.resolved":
      return { ...base, instrument: pick(event) };
    case "research.started":
      return {
        ...base,
        status: "researching",
        research: {
          ...base.research,
          started: true,
          rounds: Math.max(base.research.rounds, event.round),
          intents: event.intents,
          evidenceGaps: event.evidence_gaps,
          currentQuery: null,
          requirements: mergeLabels(base.research.requirements, requirementLabels(event.requirements)),
        },
      };
    case "research.query":
      return {
        ...base,
        status: "researching",
        research: {
          ...base.research,
          started: true,
          rounds: Math.max(base.research.rounds, event.round),
          queriesIssued: base.research.queriesIssued + 1,
          currentQuery: { intent: event.intent, kind: event.kind, label: event.label, round: event.round },
          queries: [
            ...base.research.queries,
            { seq: event.seq, intent: event.intent, kind: event.kind, label: event.label, round: event.round },
          ],
        },
      };
    case "research.source_found": {
      if (base.sources.some((s) => s.source_id === event.source_id)) {
        return { ...base, research: { ...base.research, rounds: Math.max(base.research.rounds, event.round) } };
      }
      const source: SourceView = { ...pickSource(event), intent: event.intent, round: event.round, seq: event.seq };
      return {
        ...base,
        research: {
          ...base.research,
          rounds: Math.max(base.research.rounds, event.round),
          sourcesFound: base.research.sourcesFound + 1,
        },
        sources: [...base.sources, source],
      };
    }
    case "research.source_rejected":
      return {
        ...base,
        research: {
          ...base.research,
          rounds: Math.max(base.research.rounds, event.round),
          sourcesRejected: base.research.sourcesRejected + 1,
          rejected: [
            ...base.research.rejected,
            { seq: event.seq, url: event.url, title: event.title, reason: event.reason, round: event.round },
          ],
        },
      };
    case "research.completed":
      return {
        ...base,
        status: "normalizing",
        research: { ...base.research, started: true, completed: true, currentQuery: null, stats: pickStats(event) },
      };
    case "normalization.completed":
      return { ...base, status: "normalizing", normalization: pickNormalization(event) };
    case "laya.started": {
      const status = SCORING_STAGES.has(event.stage) ? "scoring" : base.status;
      const existing = base.laya[event.stage];
      const progress: LayaStageProgress = {
        stage: event.stage,
        status: "running",
        questions: event.questions,
        questionSets: event.question_sets ?? null,
        decisionCount: existing?.decisionCount ?? 0,
        decisions: existing?.decisions ?? [],
      };
      return {
        ...base,
        status,
        laya: { ...base.laya, [event.stage]: progress },
        layaStageOrder: existing ? base.layaStageOrder : [...base.layaStageOrder, event.stage],
      };
    }
    case "laya.decision": {
      const existing = base.laya[event.stage];
      const decision: LayaDecisionEventView = pickDecision(event);
      const decisions = existing ? [...existing.decisions, decision] : [decision];
      const progress: LayaStageProgress = {
        stage: event.stage,
        status: existing?.status ?? "running",
        questions: existing?.questions ?? 0,
        questionSets: existing?.questionSets ?? null,
        decisionCount: decisions.length,
        decisions,
      };
      return {
        ...base,
        laya: { ...base.laya, [event.stage]: progress },
        layaStageOrder: existing ? base.layaStageOrder : [...base.layaStageOrder, event.stage],
      };
    }
    case "laya.completed": {
      const existing = base.laya[event.stage];
      const progress: LayaStageProgress = {
        stage: event.stage,
        status: "completed",
        questions: existing?.questions ?? 0,
        questionSets: existing?.questionSets ?? null,
        decisionCount: event.decisions,
        decisions: existing?.decisions ?? [],
      };
      return {
        ...base,
        laya: { ...base.laya, [event.stage]: progress },
        layaStageOrder: existing ? base.layaStageOrder : [...base.layaStageOrder, event.stage],
      };
    }
    case "calculation.started":
      return { ...base, status: "calculating", calculations: { ...base.calculations, started: true, pack: event.pack } };
    case "calculation.completed": {
      const item = pickCalculation(event);
      const items = base.calculations.items.some((c) => c.calc_id === item.calc_id)
        ? base.calculations.items.map((c) => (c.calc_id === item.calc_id ? item : c))
        : [...base.calculations.items, item];
      return { ...base, status: "calculating", calculations: { ...base.calculations, started: true, items } };
    }
    case "spark.queued":
      return {
        ...base,
        status: "synthesizing",
        spark: { ...base.spark, phase: "queued", activeAnalyses: event.active_analyses },
      };
    case "spark.loading":
      return {
        ...base,
        status: "synthesizing",
        spark: {
          ...base.spark,
          phase: "loading",
          contextCeiling: event.context_ceiling,
          kvCacheType: event.kv_cache_type,
        },
      };
    case "spark.started":
      return {
        ...base,
        status: "synthesizing",
        spark: {
          ...base.spark,
          phase: "streaming",
          contextCeiling: event.context_ceiling,
          promptTokens: event.prompt_tokens,
          horizons: event.horizons,
        },
      };
    case "spark.token":
      return {
        ...base,
        status: "synthesizing",
        spark: {
          ...base.spark,
          phase: "streaming",
          text: base.spark.text + event.text,
          tokenEvents: base.spark.tokenEvents + 1,
        },
      };
    case "spark.completed":
      return {
        ...base,
        status: "synthesizing",
        spark: {
          ...base.spark,
          phase: "completed",
          promptTokens: event.prompt_tokens ?? base.spark.promptTokens,
          outputTokens: event.output_tokens,
          timeToFirstTokenMs: event.time_to_first_token_ms,
          totalMs: event.total_ms,
          tokensPerSecond: event.tokens_per_second,
          truncated: event.truncated,
        },
        partial: base.partial || event.truncated,
      };
    case "analysis.completed":
      return {
        ...base,
        status: "completed",
        totalRequestMs: event.total_request_ms,
        research: { ...base.research, currentQuery: null },
        spark: base.spark.phase === "streaming" ? { ...base.spark, phase: "completed" } : base.spark,
      };
    case "analysis.failed":
      return {
        ...base,
        status: event.status === "cancelled" ? "cancelled" : "failed",
        error: event.error,
        partial: event.partial,
        research: { ...base.research, currentQuery: null },
        spark: base.spark.phase === "streaming" ? { ...base.spark, phase: "completed" } : base.spark,
      };
    default:
      return base;
  }
}

/** Fold a whole sequence; order-preserving and safe to call with overlapping replays. */
export function applyEvents(state: AnalysisViewState, events: Iterable<AnalysisEvent>): AnalysisViewState {
  let next = state;
  for (const event of events) next = applyEvent(next, event);
  return next;
}

/* ── lifecycle actions ───────────────────────────────────── */

export type AnalysisAction =
  | { type: "submit"; query: string; profile: Profile }
  | { type: "created"; response: CreateAnalysisResponse }
  | { type: "event"; event: AnalysisEvent }
  | { type: "request_failed"; error: ErrorPayload }
  | { type: "result"; result: AnalysisResult }
  | { type: "stream_fallback" }
  | { type: "stream_resumed" }
  | { type: "attach"; snapshot: AttachSnapshot }
  | { type: "cancel_requested" }
  | { type: "reset" };

/**
 * What the page knows about an analysis before its events replay: the
 * durable job fields from `GET /analyses/{id}` (or a history row). Used when
 * the page is opened or reloaded mid-run, before the stream is attached.
 */
export type AttachSnapshot = Pick<AnalysisSummary, "analysis_id" | "query" | "profile" | "horizon" | "status" | "instrument">;

/** The backend's job status as the UI status (`resolving_instrument` → `resolving`). */
export function uiStatusOf(status: AnalysisStatus): AnalysisUIStatus {
  return status === "resolving_instrument" ? "resolving" : status;
}

export function analysisReducer(state: AnalysisViewState, action: AnalysisAction): AnalysisViewState {
  switch (action.type) {
    case "submit":
      return { ...initialAnalysisState, status: "submitting", query: action.query, profile: action.profile };
    case "created":
      return {
        ...state,
        status: "queued",
        analysisId: action.response.analysis_id,
        profile: action.response.profile,
        resolvedHorizon: action.response.resolved_horizon,
      };
    case "event":
      return applyEvent(state, action.event);
    case "request_failed":
      return { ...state, status: "failed", error: action.error };
    case "result":
      return applyResult(state, action.result);
    case "stream_fallback":
      return { ...state, streamFallback: true };
    case "stream_resumed":
      return { ...state, streamFallback: false };
    case "attach":
      return attach(state, action.snapshot);
    case "cancel_requested":
      return isTerminalUiStatus(state.status) ? state : { ...state, cancelRequested: true };
    case "reset":
      return initialAnalysisState;
    default:
      return state;
  }
}

/**
 * Merge the durable `GET /analyses/{id}` result. The persisted status is
 * authoritative: it settles a state whose stream was lost, and it never
 * regresses a terminal state reached through the stream.
 */
export function applyResult(state: AnalysisViewState, result: AnalysisResult): AnalysisViewState {
  if (state.analysisId !== null && result.analysis_id !== state.analysisId) return state;
  const terminal = result.status === "completed" || result.status === "failed" || result.status === "cancelled";
  const status: AnalysisUIStatus =
    result.status === "completed" || result.status === "failed" || result.status === "cancelled"
      ? result.status
      : state.status;
  return {
    ...state,
    analysisId: result.analysis_id,
    status,
    query: state.query || result.query,
    profile: result.profile,
    resolvedHorizon: result.horizon,
    asOf: result.as_of,
    instrument: state.instrument ?? (result.instrument ? { ...result.instrument, resolution_method: "", confidence: 0 } : null),
    result,
    error: result.error ?? state.error,
    /* a running snapshot reports partial=true for any started job; only a
     * terminal result's flag means "content preserved but incomplete" */
    partial: terminal ? result.partial || state.partial : state.partial,
    totalRequestMs: result.telemetry.total_request_ms ?? state.totalRequestMs,
    spark: settleSpark(state.spark, result, terminal),
  };
}

/**
 * `streamed_text` is exactly what the backend streamed as `spark.token`. On a
 * terminal result it is canonical: it replaces whatever prefix a lost stream
 * left behind (tokens missed between the disconnect and the end are in it)
 * and the Spark phase settles. A running snapshot never supplies text: until
 * the run ends, the event stream is the only source, because a resumed stream
 * replays every token after the last seq this view applied, including tokens
 * the snapshot already holds, and they would be appended twice.
 */
function settleSpark(spark: SparkProgress, result: AnalysisResult, terminal: boolean): SparkProgress {
  const persisted = result.streamed_text;
  if (!terminal) return spark;
  const text = persisted || spark.text;
  const phase: SparkPhase = spark.phase === "streaming" || (persisted.length > 0 && spark.phase !== "completed") ? "completed" : spark.phase;
  return text === spark.text && phase === spark.phase ? spark : { ...spark, text, phase };
}

export function isTerminalUiStatus(status: AnalysisUIStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Attach to an analysis from its durable job fields. A fresh view takes the
 * snapshot's status; a view that already applied events keeps its own (the
 * events are newer). A different analysis id starts from a clean state.
 */
function attach(state: AnalysisViewState, snapshot: AttachSnapshot): AnalysisViewState {
  const fresh = state.analysisId !== snapshot.analysis_id;
  const base = fresh ? initialAnalysisState : state;
  const status: AnalysisUIStatus =
    fresh || base.eventCount === 0 || isTerminalStatus(snapshot.status) ? uiStatusOf(snapshot.status) : base.status;
  return {
    ...base,
    analysisId: snapshot.analysis_id,
    status: isTerminalUiStatus(base.status) ? base.status : status,
    query: base.query || snapshot.query,
    profile: base.profile ?? snapshot.profile,
    resolvedHorizon: base.resolvedHorizon ?? snapshot.horizon,
    instrument:
      base.instrument ?? (snapshot.instrument ? { ...snapshot.instrument, resolution_method: "", confidence: 0 } : null),
  };
}

function mergeLabels(existing: string[], next: string[]): string[] {
  const fresh = next.filter((label) => !existing.includes(label));
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/* ── field pickers (drop the envelope, keep the payload) ─── */

function pick(event: AnalysisEventOf<"instrument.resolved">): InstrumentResolvedData {
  return {
    symbol: event.symbol,
    exchange: event.exchange ?? null,
    name: event.name,
    cik: event.cik ?? null,
    sector: event.sector ?? null,
    resolution_method: event.resolution_method,
    confidence: event.confidence,
  };
}

function pickSource(event: AnalysisEventOf<"research.source_found">): SourcePublicView {
  return {
    source_id: event.source_id,
    title: event.title,
    publisher: event.publisher ?? null,
    source_type: event.source_type,
    published_at: event.published_at ?? null,
    retrieved_at: event.retrieved_at,
    url: event.url,
    fiscal_period: event.fiscal_period ?? null,
    freshness: event.freshness,
    is_primary: event.is_primary,
  };
}

function pickStats(event: AnalysisEventOf<"research.completed">): ResearchStats {
  return {
    search_rounds: event.search_rounds,
    queries_issued: event.queries_issued,
    queries_failed: event.queries_failed,
    structured_failures: event.structured_failures,
    sources_fetched: event.sources_fetched,
    sources_rejected: event.sources_rejected,
    duplicate_sources_removed: event.duplicate_sources_removed,
    evidence_gaps_remaining: event.evidence_gaps_remaining,
    retrieval_total_ms: event.retrieval_total_ms,
    intents: event.intents,
    termination_reason: event.termination_reason ?? null,
  };
}

function pickNormalization(event: AnalysisEventOf<"normalization.completed">): NormalizationCompletedData {
  return {
    facts: event.facts,
    conflicts: event.conflicts,
    uncertainties: event.uncertainties,
    sources: event.sources,
    segments: event.segments,
    freshness: event.freshness,
  };
}

function pickDecision(event: AnalysisEventOf<"laya.decision">): LayaDecisionEventView {
  return {
    decision_id: event.decision_id,
    stage: event.stage,
    decision_type: event.decision_type,
    decision: event.decision,
    confidence: event.confidence,
    segment_id: event.segment_id ?? null,
  };
}

function pickCalculation(event: AnalysisEventOf<"calculation.completed">): CalculationEventView {
  return {
    calc_id: event.calc_id,
    name: event.name,
    value: event.value ?? null,
    unit: event.unit,
    display: event.display,
    status: event.status,
    period_label: event.period_label ?? null,
    missing_inputs: event.missing_inputs ?? [],
  };
}
