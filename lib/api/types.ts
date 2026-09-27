/**
 * TypeScript mirrors of the BayAnalytics API contract (`/api/v1`).
 *
 * Source of truth: `backend/src/bayanalytics/schemas/*.py` in the backend
 * repository. Field names, optionality and enum values are copied verbatim;
 * nothing here is inferred from model or runtime internals. Dates are ISO 8601
 * strings on the wire. Fields typed `T | null` are `Optional` in Pydantic and
 * are always present in the JSON (the backend serialises `None` as `null`).
 */

/* ── common literals ─────────────────────────────────────── */

export type Profile = "fast" | "deep";
export const PROFILES = ["fast", "deep"] as const satisfies readonly Profile[];

export type Horizon =
  | "auto"
  | "near_term"
  | "next_cycle"
  | "medium_term"
  | "long_term"
  | "multi_horizon";
export type ResolvedHorizon = Exclude<Horizon, "auto">;
export type SingleHorizon = Exclude<ResolvedHorizon, "multi_horizon">;
export const SINGLE_HORIZONS = [
  "near_term",
  "next_cycle",
  "medium_term",
  "long_term",
] as const satisfies readonly SingleHorizon[];

/** Backend `HORIZON_LABELS`, for showing the resolved horizon. */
export const HORIZON_LABELS: Record<ResolvedHorizon, string> = {
  near_term: "Near term (days to several weeks)",
  next_cycle: "Next cycle (next earnings / quarter)",
  medium_term: "Medium term (6-12 months)",
  long_term: "Long term (multi-year)",
  multi_horizon: "Multi-horizon",
};

export type AnalysisStatus =
  | "queued"
  | "resolving_instrument"
  | "researching"
  | "normalizing"
  | "scoring"
  | "calculating"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";
export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type Stance = "bullish" | "neutral" | "bearish" | "mixed";

export type SourceType =
  | "regulatory_filing"
  | "exchange_data"
  | "investor_relations"
  | "financial_statement"
  | "earnings_release"
  | "earnings_transcript"
  | "market_data"
  | "financial_journalism"
  | "secondary_commentary"
  | "unverified_web";

export type Freshness = "current" | "recent" | "stale" | "unknown";
export type Basis = "gaap" | "adjusted" | "unknown";
export type Redistribution = "allowed" | "metadata_only" | "unknown";

export type Deployment = "local" | "cloud";

/* ── errors (schemas/common.py ErrorCode, schemas/errors.py) ─ */

/** The 16 locked analysis error codes; these can arrive in `analysis.failed`. */
export const ANALYSIS_ERROR_CODES = [
  "AMBIGUOUS_INSTRUMENT",
  "INSUFFICIENT_EVIDENCE",
  "STALE_EVIDENCE",
  "RESEARCH_UNAVAILABLE",
  "SOURCE_CONFLICT",
  "MISSING_CALCULATION_INPUT",
  "FAST_PROFILE_UNAVAILABLE",
  "DEEP_PROFILE_UNAVAILABLE",
  "MEMORY_PRESSURE",
  "SPARK_START_FAILED",
  "SPARK_INFERENCE_FAILED",
  "LAYA_INFERENCE_FAILED",
  "WHISPER_FAILED",
  "INTERRUPTED",
  "CANCELLED",
  "INTERNAL_ERROR",
] as const;

/** HTTP-level codes; never emitted on the event stream. */
export const HTTP_ERROR_CODES = [
  "NOT_FOUND",
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "TOO_MANY_ANALYSES",
] as const;

export const ERROR_CODES = [...ANALYSIS_ERROR_CODES, ...HTTP_ERROR_CODES] as const;
export type AnalysisErrorCode = (typeof ANALYSIS_ERROR_CODES)[number];
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown> | null;
}

export interface ErrorEnvelope {
  error: ErrorPayload;
}

/** `details.candidates[*]` of a 422 AMBIGUOUS_INSTRUMENT (instruments/base.py). */
export interface InstrumentCandidate {
  symbol: string;
  exchange: string | null;
  name: string;
  cik: string | null;
  score: number;
}

/* ── requests (schemas/requests.py) ─────────────────────── */

export interface InstrumentRef {
  /** 1–16 characters; the backend upper-cases it. */
  symbol: string;
  exchange?: string | null;
}

export interface CreateAnalysisRequest {
  /** 1–2000 characters, not blank. */
  query: string;
  instrument?: InstrumentRef | null;
  /** Defaults to "fast" on the backend when omitted. */
  profile?: Profile;
  /** Defaults to "auto" on the backend when omitted. */
  horizon?: Horizon;
}

export interface CreateAnalysisResponse {
  analysis_id: string;
  status: AnalysisStatus;
  profile: Profile;
  resolved_horizon: ResolvedHorizon;
}

export interface CancelAnalysisResponse {
  analysis_id: string;
  status: AnalysisStatus;
  cancel_requested: boolean;
}

export interface AnalysisSummary {
  analysis_id: string;
  query: string;
  instrument: InstrumentView | null;
  profile: Profile;
  horizon: ResolvedHorizon;
  status: AnalysisStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_code: string | null;
}

export interface AnalysisListResponse {
  analyses: AnalysisSummary[];
  /** Opaque; pass back as `?cursor=`. `null` when the list is exhausted. */
  next_cursor: string | null;
}

/* ── evidence (schemas/evidence.py) ─────────────────────── */

export interface SourceRecord {
  source_id: string;
  url: string;
  title: string;
  publisher: string | null;
  source_type: SourceType;
  published_at: string | null;
  retrieved_at: string;
  symbol: string | null;
  fiscal_period: string | null;
  /** Short evidence excerpt, never a full article. */
  excerpt: string;
  content_hash: string | null;
  extraction_method: string;
  freshness: Freshness;
  redistribution: Redistribution;
  terms_note: string | null;
  rejected_reason: string | null;
  research_intent: string | null;
  metadata: Record<string, unknown>;
  /** Computed on the backend from `source_type`. */
  is_primary: boolean;
  /** Computed on the backend; lower = more authoritative (1..8). */
  rank: number;
}

/** `SourceRecord.public_view()`: what `research.source_found` carries. */
export interface SourcePublicView {
  source_id: string;
  title: string;
  publisher: string | null;
  source_type: SourceType;
  published_at: string | null;
  retrieved_at: string;
  url: string;
  fiscal_period: string | null;
  freshness: Freshness;
  is_primary: boolean;
}

export type ConflictReason =
  | "definition_mismatch"
  | "basis_mismatch"
  | "period_mismatch"
  | "currency_mismatch"
  | "restatement"
  | "split_adjustment"
  | "unknown";

export interface ConflictValue {
  value: number;
  basis: Basis;
  unit: string | null;
  source_id: string;
  published_at: string | null;
  period_label: string | null;
}

export interface Conflict {
  metric: string;
  period_label: string | null;
  status: "conflict" | "resolved_by_primary" | "unresolved";
  reason: ConflictReason;
  values: ConflictValue[];
  material: boolean;
  note: string | null;
}

/* ── calculations (schemas/calculations.py) ─────────────── */

export interface CalculationInput {
  name: string;
  value: number | null;
  unit: string | null;
  source_id: string | null;
  period_label: string | null;
  fact_id: string | null;
}

export type CalculationStatus = "computed" | "unavailable";

export interface CalculationResult {
  calc_id: string;
  name: string;
  formula: string;
  inputs: CalculationInput[];
  value: number | null;
  unit: string;
  period_label: string | null;
  status: CalculationStatus;
  missing_inputs: string[];
  display: string;
  notes: string[];
  meta: Record<string, unknown>;
}

/** `CalculationResult.event_view()`: what `calculation.completed` carries. */
export interface CalculationEventView {
  calc_id: string;
  name: string;
  value: number | null;
  unit: string;
  display: string;
  status: CalculationStatus;
  period_label: string | null;
  missing_inputs: string[];
}

/* ── Laya decisions (schemas/decisions.py) ──────────────── */

export type LayaQuestionType = "choice" | "score" | "noul";

export interface LayaQuestion {
  type: LayaQuestionType;
  instructions: string;
  criteria: Record<string, string> | string[] | null;
}

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
}
export interface ScoreAnswer {
  score: number;
  distribution: number[] | null;
}
export interface NoulAnswer {
  noul: number;
}
export type LayaAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface LayaDecision {
  decision_id: string;
  /** research_plan, evidence_scan, history_scan, text_evidence, horizon, calculation, ... */
  stage: string;
  decision_type: string;
  question: LayaQuestion;
  answer: LayaAnswer;
  /** Confidence in the structured decision itself, never an outcome probability. */
  confidence: number;
  state_digest: string;
  state_tokens: number | null;
  segment_id: string | null;
  created_at: string;
  schema_version: string;
}

/** `LayaDecision.event_view()`: what `laya.decision` carries. */
export interface LayaDecisionEventView {
  decision_id: string;
  stage: string;
  decision_type: string;
  decision: string | number;
  confidence: number;
  segment_id: string | null;
}

/* ── results (schemas/results.py) ───────────────────────── */

export interface InstrumentView {
  symbol: string;
  exchange: string | null;
  name: string;
  cik: string | null;
  sector: string | null;
  instrument_type: string;
}

export interface EvidenceItem {
  text: string;
  source_ids: string[];
  stance: Stance | null;
  metric: string | null;
  period_label: string | null;
  decision_id: string | null;
  calc_id: string | null;
}

export interface Assessment {
  summary: string;
  what_changed: EvidenceItem[];
  fundamentals: Record<string, unknown>;
  valuation: Record<string, unknown>;
  benchmark_context: Record<string, unknown>;
  historical_context: Record<string, unknown>;
  market_context: Record<string, unknown>;
  bull_evidence: EvidenceItem[];
  bear_evidence: EvidenceItem[];
  risks: EvidenceItem[];
  conflicts: Conflict[];
  uncertainties: string[];
  follow_up_questions: string[];
}

export interface HorizonAssessment {
  horizon: string;
  stance: Stance;
  /** Confidence in the Laya decision, never an outcome probability. */
  confidence: number;
  summary: string;
  key_evidence: EvidenceItem[];
  decision_id: string | null;
  /** False when Spark produced no section for this horizon. */
  synthesized: boolean;
  /** Laya's stance confidence was below the floor. */
  low_confidence: boolean;
}

export interface ResearchStats {
  search_rounds: number;
  queries_issued: number;
  queries_failed: number;
  structured_failures: number;
  sources_fetched: number;
  sources_rejected: number;
  duplicate_sources_removed: number;
  evidence_gaps_remaining: number;
  retrieval_total_ms: number;
  intents: string[];
  termination_reason: string | null;
}

export interface ExecutionInfo {
  spark_mode: string;
  whisper_mode: string;
  deployment: string;
  search_configured: boolean;
}

export interface VersionInfo {
  normalization_version: string;
  laya_schema_version: string;
  laya_package_version: string | null;
  spark_artifact: string | null;
  spark_runtime: string | null;
  spark_gguf_sha256: string | null;
  spark_hf_revision: string | null;
  execution: ExecutionInfo;
}

/** Measured, never estimated; `null` means the runtime did not report it. */
export interface Telemetry {
  profile: Profile | null;
  context_ceiling: number | null;
  kv_cache_type: string | null;

  retrieval_ms: number | null;
  normalization_ms: number | null;
  laya_ms: number | null;
  math_ms: number | null;
  spark_load_ms: number | null;
  spark_time_to_first_token_ms: number | null;
  spark_total_ms: number | null;
  total_request_ms: number | null;

  laya_load_ms: number | null;
  laya_warm_inference_ms: number | null;
  whisper_load_ms: number | null;

  spark_prompt_tokens: number | null;
  spark_output_tokens: number | null;
  spark_tokens_per_second: number | null;

  process_peak_rss_mb: number | null;
  laya_resident_ram_mb: number | null;
  laya_peak_rss_mb: number | null;
  spark_resident_ram_mb: number | null;
  spark_peak_rss_mb: number | null;
  whisper_peak_rss_mb: number | null;
  system_total_ram_mb: number | null;
  system_peak_ram_mb: number | null;
  swap_used_mb: number | null;
  cpu_percent: number | null;

  research: ResearchStats;
  versions: VersionInfo;
}

export interface AnalysisResult {
  analysis_id: string;
  status: AnalysisStatus;
  query: string;
  instrument: InstrumentView | null;
  profile: Profile;
  horizon: ResolvedHorizon;
  as_of: string;
  created_at: string;
  completed_at: string | null;
  assessment: Assessment;
  horizon_assessments: Record<string, HorizonAssessment>;
  sources: SourceRecord[];
  calculations: CalculationResult[];
  laya_decisions: LayaDecision[];
  freshness_summary: Record<string, unknown>;
  /** Exactly what was streamed as `spark.token`, for recovery. */
  streamed_text: string;
  telemetry: Telemetry;
  error: ErrorPayload | null;
  /** True when cancelled/failed with some content preserved, or when a
   * completed synthesis was cut off / a horizon section is missing. */
  partial: boolean;
}

/* ── capabilities / health (schemas/capabilities.py) ────── */

export interface ProfileCapability {
  available: boolean;
  context_ceiling: number;
  reason: string | null;
  code: ErrorCode | null;
}

export interface Capabilities {
  /** Keyed by profile name ("fast", "deep"). */
  profiles: Record<string, ProfileCapability>;
  voice: boolean;
  deployment: string;
  research: boolean;
  execution: ExecutionInfo;
}

export type ComponentStatus = "ok" | "degraded" | "down" | "disabled";

export interface ComponentHealth {
  name: string;
  status: ComponentStatus | string;
  detail: string | null;
}

export interface Health {
  status: string;
  version: string;
  components: ComponentHealth[];
  active_analyses: number;
  execution: ExecutionInfo;
}

/* ── transcriptions (schemas/transcriptions.py) ─────────── */

export interface Transcription {
  text: string;
  duration_ms: number;
  transcription_ms: number;
}

/* ── SSE events (schemas/events.py + the emit sites) ────── */

export const EVENT_NAMES = [
  "analysis.started",
  "instrument.resolved",
  "research.started",
  "research.query",
  "research.source_found",
  "research.source_rejected",
  "research.completed",
  "normalization.completed",
  "laya.started",
  "laya.decision",
  "laya.completed",
  "calculation.started",
  "calculation.completed",
  "spark.queued",
  "spark.loading",
  "spark.started",
  "spark.token",
  "spark.completed",
  "analysis.completed",
  "analysis.failed",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const TERMINAL_EVENTS = ["analysis.completed", "analysis.failed"] as const;
export type TerminalEventName = (typeof TERMINAL_EVENTS)[number];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

export function isTerminalEvent(name: string): name is TerminalEventName {
  return (TERMINAL_EVENTS as readonly string[]).includes(name);
}

/**
 * Envelope shared by every event. On the wire the `data:` JSON is flat:
 * `{analysis_id, seq, ts, ...data}` (see `AnalysisEvent.to_sse` in events.py);
 * the event name comes from the SSE `event:` field and `id:` equals `seq`.
 */
export interface EventEnvelope {
  analysis_id: string;
  seq: number;
  ts: string;
}

/** Laya stages seen on `laya.*` events. Map by stage, not by first occurrence. */
export type LayaStage =
  | "research_plan"
  | "evidence_scan"
  | "history_scan"
  | "text_evidence"
  | "horizon"
  | (string & {});

export interface AnalysisStartedData {
  query: string;
  profile: Profile;
  resolved_horizon: ResolvedHorizon;
  as_of: string;
  execution: ExecutionInfo | null;
}

export interface InstrumentResolvedData {
  symbol: string;
  exchange: string | null;
  name: string;
  cik: string | null;
  sector: string | null;
  resolution_method: string;
  confidence: number;
}

export interface ResearchStartedData {
  round: number;
  intents: string[];
  evidence_gaps: string[];
}

export interface ResearchQueryData {
  intent: string;
  kind: string;
  query: string;
  label: string;
  round: number;
}

export interface ResearchSourceFoundData extends SourcePublicView {
  intent: string;
  round: number;
}

export interface ResearchSourceRejectedData {
  url: string;
  title: string;
  /** A fixed keyword, never upstream text. */
  reason: string;
  intent: string;
  round: number;
}

/** `ResearchStats.model_dump()`. */
export type ResearchCompletedData = ResearchStats;

export interface NormalizationCompletedData {
  facts: number;
  conflicts: number;
  uncertainties: number;
  sources: number;
  segments: number;
  freshness: {
    facts: {
      current: number | null;
      recent: number | null;
      stale: number | null;
      unknown: number | null;
      total: number | null;
    };
    latest_quarter_end: string | null;
    prices: string | null;
    warnings: number;
  };
}

export interface LayaStartedData {
  stage: LayaStage;
  questions: number;
  /** Present for the evidence_scan and horizon stages. */
  question_sets?: number;
}

export type LayaDecisionData = LayaDecisionEventView;

export interface LayaCompletedData {
  stage: LayaStage;
  decisions: number;
}

export interface CalculationStartedData {
  /** The calculation pack Laya chose. */
  pack: string;
}

export type CalculationCompletedData = CalculationEventView;

export interface SparkQueuedData {
  profile: Profile;
  active_analyses: number;
}

export interface SparkLoadingData {
  profile: Profile;
  context_ceiling: number;
  kv_cache_type: string;
}

export interface SparkStartedData {
  profile: Profile;
  context_ceiling: number;
  /** Measured by the server's own tokenizer, or null if not measured. */
  prompt_tokens: number | null;
  horizons: string[];
}

export interface SparkTokenData {
  /** The `content` delta of the chat completion. */
  text: string;
}

export interface SparkCompletedData {
  prompt_tokens: number | null;
  output_tokens: number | null;
  time_to_first_token_ms: number | null;
  total_ms: number | null;
  tokens_per_second: number | null;
  truncated: boolean;
}

export interface AnalysisCompletedData {
  status: "completed";
  analysis_id: string;
  total_request_ms: number | null;
}

export interface AnalysisFailedData {
  /** "cancelled" for a user cancel (error.code CANCELLED), otherwise "failed". */
  status: "failed" | "cancelled";
  error: ErrorPayload;
  partial: boolean;
}

export interface EventDataMap {
  "analysis.started": AnalysisStartedData;
  "instrument.resolved": InstrumentResolvedData;
  "research.started": ResearchStartedData;
  "research.query": ResearchQueryData;
  "research.source_found": ResearchSourceFoundData;
  "research.source_rejected": ResearchSourceRejectedData;
  "research.completed": ResearchCompletedData;
  "normalization.completed": NormalizationCompletedData;
  "laya.started": LayaStartedData;
  "laya.decision": LayaDecisionData;
  "laya.completed": LayaCompletedData;
  "calculation.started": CalculationStartedData;
  "calculation.completed": CalculationCompletedData;
  "spark.queued": SparkQueuedData;
  "spark.loading": SparkLoadingData;
  "spark.started": SparkStartedData;
  "spark.token": SparkTokenData;
  "spark.completed": SparkCompletedData;
  "analysis.completed": AnalysisCompletedData;
  "analysis.failed": AnalysisFailedData;
}

/** One parsed event: the name plus the flattened `data:` payload. */
export type AnalysisEventOf<N extends EventName> = { event: N } & EventEnvelope & EventDataMap[N];

export type AnalysisEvent = { [N in EventName]: AnalysisEventOf<N> }[EventName];
