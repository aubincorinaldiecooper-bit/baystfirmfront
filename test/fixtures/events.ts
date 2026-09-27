/**
 * The event sequence from docs/ARCHITECTURE.md ("Analysis lifecycle and
 * events") for one Fast, multi-horizon analysis, plus the cancelled and
 * failed endings. Test-only: the company, the sources and every number are
 * synthetic and never reach the product.
 */

import type { AnalysisEvent, AnalysisEventOf, AnalysisResult, EventName, ErrorPayload } from "@/lib/api/types";

export const ANALYSIS_ID = "an_0123456789abcdef";
const T0 = Date.parse("2026-09-27T10:00:00Z");

type Payload<N extends EventName> = Omit<AnalysisEventOf<N>, "event" | "analysis_id" | "seq" | "ts">;

let seq = 0;
function ev<N extends EventName>(event: N, data: Payload<N>): AnalysisEventOf<N> {
  seq += 1;
  return { event, analysis_id: ANALYSIS_ID, seq, ts: new Date(T0 + seq * 250).toISOString(), ...data } as unknown as AnalysisEventOf<N>;
}

const EXECUTION = { spark_mode: "managed", whisper_mode: "disabled", deployment: "local", search_configured: true };

const research: AnalysisEvent[] = [
  ev("analysis.started", {
    query: "Assess Example Holdings.",
    profile: "fast",
    resolved_horizon: "multi_horizon",
    as_of: "2026-09-27T10:00:00+00:00",
    execution: EXECUTION,
  }),
  ev("instrument.resolved", {
    symbol: "EXHL",
    exchange: "NASDAQ",
    name: "Example Holdings Inc.",
    cik: "0000000000",
    sector: null,
    resolution_method: "ticker",
    confidence: 1,
  }),
  ev("research.started", { round: 1, intents: ["retrieve_latest_filing", "retrieve_price_history"], evidence_gaps: [] }),
  ev("research.query", { intent: "retrieve_latest_filing", kind: "edgar", query: "EXHL 10-Q", label: "Latest quarterly filing", round: 1 }),
  ev("research.source_found", {
    source_id: "src_filing",
    title: "Form 10-Q",
    publisher: "SEC EDGAR",
    source_type: "regulatory_filing",
    published_at: "2026-08-01T00:00:00+00:00",
    retrieved_at: "2026-09-27T10:00:01+00:00",
    url: "https://example.com/filings/exhl-10q",
    fiscal_period: "Q2 FY2026",
    freshness: "current",
    is_primary: true,
    intent: "retrieve_latest_filing",
    round: 1,
  }),
  ev("research.query", { intent: "retrieve_price_history", kind: "prices", query: "EXHL", label: "Price history", round: 1 }),
  ev("research.source_found", {
    source_id: "src_prices",
    title: "EXHL daily prices",
    publisher: "Example Prices",
    source_type: "market_data",
    published_at: null,
    retrieved_at: "2026-09-27T10:00:02+00:00",
    url: "https://example.com/prices/exhl",
    fiscal_period: null,
    freshness: "current",
    is_primary: false,
    intent: "retrieve_price_history",
    round: 1,
  }),
  ev("research.source_rejected", {
    url: "https://example.com/filings/exhl-10q-copy",
    title: "Form 10-Q (mirror)",
    reason: "duplicate",
    intent: "retrieve_latest_filing",
    round: 1,
  }),
  ev("laya.started", { stage: "research_plan", questions: 3 }),
  ev("laya.decision", {
    decision_id: "dec_plan",
    stage: "research_plan",
    decision_type: "research_intent",
    decision: "stop_research",
    confidence: 0.81,
    segment_id: null,
  }),
  ev("laya.completed", { stage: "research_plan", decisions: 1 }),
  ev("research.completed", {
    search_rounds: 1,
    queries_issued: 2,
    queries_failed: 0,
    structured_failures: 0,
    sources_fetched: 3,
    sources_rejected: 1,
    duplicate_sources_removed: 1,
    evidence_gaps_remaining: 0,
    retrieval_total_ms: 1834.2,
    intents: ["retrieve_latest_filing", "retrieve_price_history"],
    termination_reason: "evidence_sufficient",
  }),
  ev("normalization.completed", {
    facts: 12,
    conflicts: 0,
    uncertainties: 1,
    sources: 2,
    segments: 3,
    freshness: {
      facts: { current: 10, recent: 2, stale: 0, unknown: 0, total: 12 },
      latest_quarter_end: "2026-06-30",
      prices: "current",
      warnings: 0,
    },
  }),
];

const scoring: AnalysisEvent[] = [
  ev("laya.started", { stage: "evidence_scan", question_sets: 2, questions: 6 }),
  ev("laya.decision", {
    decision_id: "dec_material",
    stage: "evidence_scan",
    decision_type: "materiality",
    decision: 0.7,
    confidence: 0.7,
    segment_id: "seg_1",
  }),
  ev("laya.completed", { stage: "evidence_scan", decisions: 1 }),
];

const calculations: AnalysisEvent[] = [
  ev("calculation.started", { pack: "all_standard" }),
  ev("calculation.completed", {
    calc_id: "calc_revenue_growth",
    name: "revenue_growth_yoy",
    value: 0.182,
    unit: "percent",
    display: "+18.2%",
    status: "computed",
    period_label: "Q2 FY2026",
    missing_inputs: [],
  }),
  ev("calculation.completed", {
    calc_id: "calc_pe",
    name: "pe_ratio",
    value: null,
    unit: "ratio",
    display: "",
    status: "unavailable",
    period_label: null,
    missing_inputs: ["eps_diluted_ttm"],
  }),
  ev("laya.started", { stage: "horizon", question_sets: 4, questions: 4 }),
  ev("laya.decision", {
    decision_id: "dec_near",
    stage: "horizon",
    decision_type: "stance_near_term",
    decision: "neutral",
    confidence: 0.55,
    segment_id: null,
  }),
  ev("laya.completed", { stage: "horizon", decisions: 1 }),
];

const synthesis: AnalysisEvent[] = [
  ev("spark.queued", { profile: "fast", active_analyses: 2 }),
  ev("spark.loading", { profile: "fast", context_ceiling: 32768, kv_cache_type: "f16" }),
  ev("spark.started", {
    profile: "fast",
    context_ceiling: 32768,
    prompt_tokens: 6100,
    horizons: ["near_term", "next_cycle", "medium_term", "long_term"],
  }),
  ev("spark.token", { text: "Revenue " }),
  ev("spark.token", { text: "grew " }),
  ev("spark.token", { text: "18.2% year over year." }),
  ev("spark.completed", {
    prompt_tokens: 6100,
    output_tokens: 9,
    time_to_first_token_ms: 812.5,
    total_ms: 2400.1,
    tokens_per_second: 3.75,
    truncated: false,
  }),
];

const completed = ev("analysis.completed", { status: "completed", total_request_ms: 61234.5 });

/** The full happy path, seq 1..N, exactly the order ARCHITECTURE.md documents. */
export const HAPPY_PATH: AnalysisEvent[] = [...research, ...scoring, ...calculations, ...synthesis, completed];

export const STREAMED_TEXT = "Revenue grew 18.2% year over year.";

export const CANCELLED_ERROR: ErrorPayload = { code: "CANCELLED", message: "The analysis was cancelled.", retryable: false, details: null };
export const RESEARCH_ERROR: ErrorPayload = {
  code: "RESEARCH_UNAVAILABLE",
  message: "Public research is unavailable right now. The analysis was not completed.",
  retryable: true,
  details: { reason: "ticker_directory_unavailable" },
};

function terminalFailed(after: AnalysisEvent[], data: Payload<"analysis.failed">): AnalysisEvent[] {
  const last = after[after.length - 1].seq;
  return [
    ...after,
    {
      event: "analysis.failed",
      analysis_id: ANALYSIS_ID,
      seq: last + 1,
      ts: new Date(T0 + (last + 1) * 250).toISOString(),
      ...data,
    },
  ];
}

/** A user cancel during the calculations: `analysis.failed` with status "cancelled". */
export const CANCELLED_PATH: AnalysisEvent[] = terminalFailed(
  [...research, ...scoring, ...calculations.slice(0, 2)],
  { status: "cancelled", error: CANCELLED_ERROR, partial: true },
);

/** A public-source outage: `analysis.failed` with status "failed". */
export const FAILED_PATH: AnalysisEvent[] = terminalFailed(research.slice(0, 4), {
  status: "failed",
  error: RESEARCH_ERROR,
  partial: false,
});

/** A synthesis that was cut off, then completed with `partial` semantics. */
export const TRUNCATED_PATH: AnalysisEvent[] = [
  ...research,
  ...scoring,
  ...calculations,
  ...synthesis.slice(0, 6),
  { ...(synthesis[6] as AnalysisEventOf<"spark.completed">), truncated: true },
  completed,
];

/** Encode one event exactly as `AnalysisEvent.to_sse()` does on the backend. */
export function toSse(event: AnalysisEvent): string {
  const { event: name, ...payload } = event;
  return `id: ${event.seq}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function toSseStream(events: AnalysisEvent[], comments: string[] = []): string {
  return comments.map((c) => `: ${c}\n\n`).join("") + events.map(toSse).join("");
}

/** A durable result as `GET /analyses/{id}` returns it after `analysis.completed`. */
export function completedResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    analysis_id: ANALYSIS_ID,
    status: "completed",
    query: "Assess Example Holdings.",
    instrument: { symbol: "EXHL", exchange: "NASDAQ", name: "Example Holdings Inc.", cik: "0000000000", sector: null, instrument_type: "equity" },
    profile: "fast",
    horizon: "multi_horizon",
    as_of: "2026-09-27T10:00:00+00:00",
    created_at: "2026-09-27T10:00:00+00:00",
    completed_at: "2026-09-27T10:01:01+00:00",
    assessment: {
      summary: STREAMED_TEXT,
      what_changed: [],
      fundamentals: {},
      valuation: {},
      benchmark_context: {},
      historical_context: {},
      market_context: {},
      bull_evidence: [],
      bear_evidence: [],
      risks: [],
      conflicts: [],
      uncertainties: ["one uncertainty"],
      follow_up_questions: [],
    },
    horizon_assessments: {},
    sources: [],
    calculations: [],
    laya_decisions: [],
    freshness_summary: {},
    streamed_text: STREAMED_TEXT,
    telemetry: {
      profile: "fast",
      context_ceiling: 32768,
      kv_cache_type: "f16",
      retrieval_ms: null,
      normalization_ms: null,
      laya_ms: null,
      math_ms: null,
      spark_load_ms: null,
      spark_time_to_first_token_ms: null,
      spark_total_ms: null,
      total_request_ms: 61234.5,
      laya_load_ms: null,
      laya_warm_inference_ms: null,
      whisper_load_ms: null,
      spark_prompt_tokens: 6100,
      spark_output_tokens: 9,
      spark_tokens_per_second: null,
      process_peak_rss_mb: null,
      laya_resident_ram_mb: null,
      laya_peak_rss_mb: null,
      spark_resident_ram_mb: null,
      spark_peak_rss_mb: null,
      whisper_peak_rss_mb: null,
      system_total_ram_mb: null,
      system_peak_ram_mb: null,
      swap_used_mb: null,
      cpu_percent: null,
      research: {
        search_rounds: 1,
        queries_issued: 2,
        queries_failed: 0,
        structured_failures: 0,
        sources_fetched: 3,
        sources_rejected: 1,
        duplicate_sources_removed: 1,
        evidence_gaps_remaining: 0,
        retrieval_total_ms: 1834.2,
        intents: [],
        termination_reason: "evidence_sufficient",
      },
      versions: {
        normalization_version: "",
        laya_schema_version: "",
        laya_package_version: null,
        spark_artifact: null,
        spark_runtime: null,
        spark_gguf_sha256: null,
        spark_hf_revision: null,
        execution: EXECUTION,
      },
    },
    error: null,
    partial: false,
    ...overrides,
  };
}
