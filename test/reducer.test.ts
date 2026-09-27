import { describe, expect, it } from "vitest";
import {
  analysisReducer,
  applyEvent,
  applyEvents,
  applyResult,
  initialAnalysisState,
  type AnalysisViewState,
} from "@/lib/analysis/reducer";
import type { AnalysisEvent, AnalysisEventOf } from "@/lib/api/types";
import {
  ANALYSIS_ID,
  CANCELLED_PATH,
  FAILED_PATH,
  HAPPY_PATH,
  STREAMED_TEXT,
  TRUNCATED_PATH,
  completedResult,
} from "./fixtures/events";

const byName = (name: AnalysisEvent["event"]) => HAPPY_PATH.findIndex((e) => e.event === name);
const upTo = (name: AnalysisEvent["event"]) => HAPPY_PATH.slice(0, byName(name) + 1);
const stateAfter = (name: AnalysisEvent["event"]) => applyEvents(initialAnalysisState, upTo(name));

describe("applyEvents over the ARCHITECTURE.md sequence", () => {
  const final = applyEvents(initialAnalysisState, HAPPY_PATH);

  it("settles on completed with the terminal timing", () => {
    expect(final.status).toBe("completed");
    expect(final.analysisId).toBe(ANALYSIS_ID);
    expect(final.lastSeq).toBe(HAPPY_PATH.length);
    expect(final.eventCount).toBe(HAPPY_PATH.length);
    expect(final.totalRequestMs).toBe(61234.5);
    expect(final.error).toBeNull();
    expect(final.partial).toBe(false);
  });

  it("records the request, the instrument and the resolved horizon", () => {
    expect(final.query).toBe("Assess Example Holdings.");
    expect(final.profile).toBe("fast");
    expect(final.resolvedHorizon).toBe("multi_horizon");
    expect(final.execution?.search_configured).toBe(true);
    expect(final.instrument).toMatchObject({ symbol: "EXHL", exchange: "NASDAQ", name: "Example Holdings Inc.", resolution_method: "ticker" });
  });

  it("walks the UI status through the backend phases", () => {
    expect(stateAfter("analysis.started").status).toBe("resolving");
    expect(stateAfter("instrument.resolved").status).toBe("resolving");
    expect(stateAfter("research.started").status).toBe("researching");
    expect(stateAfter("laya.completed").status).toBe("researching"); // the research_plan stage stays inside research
    expect(stateAfter("research.completed").status).toBe("normalizing");
    expect(stateAfter("normalization.completed").status).toBe("normalizing");
    const scoring = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, byName("normalization.completed") + 2));
    expect(scoring.status).toBe("scoring"); // laya.started stage=evidence_scan
    expect(stateAfter("calculation.started").status).toBe("calculating");
    const horizonStart = HAPPY_PATH.findIndex((e) => e.event === "laya.started" && e.stage === "horizon");
    expect(applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, horizonStart + 1)).status).toBe("calculating");
    expect(stateAfter("spark.queued").status).toBe("synthesizing");
    expect(stateAfter("spark.completed").status).toBe("synthesizing");
  });

  it("counts research progress and keeps found sources in order", () => {
    expect(final.research).toMatchObject({
      started: true,
      completed: true,
      rounds: 1,
      queriesIssued: 2,
      sourcesFound: 2,
      sourcesRejected: 1,
      currentQuery: null,
    });
    expect(final.research.stats?.termination_reason).toBe("evidence_sufficient");
    expect(final.sources.map((s) => s.source_id)).toEqual(["src_filing", "src_prices"]);
    expect(final.sources[0]).toMatchObject({ is_primary: true, source_type: "regulatory_filing", fiscal_period: "Q2 FY2026", seq: 5 });
    const mid = stateAfter("research.query");
    expect(mid.research.currentQuery).toEqual({ intent: "retrieve_latest_filing", kind: "edgar", label: "Latest quarterly filing", round: 1 });
  });

  it("records normalization counts", () => {
    expect(final.normalization).toMatchObject({ facts: 12, conflicts: 0, uncertainties: 1, sources: 2, segments: 3 });
    expect(final.normalization?.freshness.facts.total).toBe(12);
  });

  it("keys Laya progress by stage, not by first occurrence", () => {
    expect(final.layaStageOrder).toEqual(["research_plan", "evidence_scan", "horizon"]);
    expect(final.laya.research_plan).toMatchObject({ status: "completed", questions: 3, questionSets: null, decisionCount: 1 });
    expect(final.laya.evidence_scan).toMatchObject({ status: "completed", questions: 6, questionSets: 2, decisionCount: 1 });
    expect(final.laya.horizon).toMatchObject({ status: "completed", questions: 4, questionSets: 4, decisionCount: 1 });
    expect(final.laya.horizon.decisions[0]).toMatchObject({ decision_type: "stance_near_term", decision: "neutral", confidence: 0.55 });
    const running = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, byName("laya.decision") + 1));
    expect(running.laya.research_plan.status).toBe("running");
    expect(running.laya.research_plan.decisionCount).toBe(1);
  });

  it("lists calculations, computed and unavailable alike, without inventing values", () => {
    expect(final.calculations.started).toBe(true);
    expect(final.calculations.pack).toBe("all_standard");
    expect(final.calculations.items).toHaveLength(2);
    expect(final.calculations.items[0]).toMatchObject({ name: "revenue_growth_yoy", display: "+18.2%", status: "computed", value: 0.182 });
    expect(final.calculations.items[1]).toMatchObject({ name: "pe_ratio", status: "unavailable", value: null, missing_inputs: ["eps_diluted_ttm"] });
  });

  it("tracks the Spark lane and appends tokens in order", () => {
    expect(stateAfter("spark.queued").spark).toMatchObject({ phase: "queued", activeAnalyses: 2 });
    expect(stateAfter("spark.loading").spark).toMatchObject({ phase: "loading", contextCeiling: 32768, kvCacheType: "f16" });
    expect(stateAfter("spark.started").spark).toMatchObject({ phase: "streaming", promptTokens: 6100, horizons: ["near_term", "next_cycle", "medium_term", "long_term"] });
    expect(final.spark.text).toBe(STREAMED_TEXT);
    expect(final.spark.tokenEvents).toBe(3);
    expect(final.spark).toMatchObject({ phase: "completed", outputTokens: 9, timeToFirstTokenMs: 812.5, totalMs: 2400.1, tokensPerSecond: 3.75, truncated: false });
  });
});

describe("idempotence and ordering", () => {
  const final = applyEvents(initialAnalysisState, HAPPY_PATH);

  it("returns the same state object when a full replay arrives", () => {
    expect(applyEvents(final, HAPPY_PATH)).toBe(final);
  });

  it("ignores an event whose seq is at or below the last applied seq", () => {
    const partial = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, 10));
    expect(applyEvent(partial, HAPPY_PATH[4])).toBe(partial);
    expect(applyEvent(partial, HAPPY_PATH[9])).toBe(partial);
    expect(applyEvent(partial, HAPPY_PATH[10])).not.toBe(partial);
  });

  it("does not double count a replayed tail after a reconnect", () => {
    const first = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, 7));
    const reconnected = applyEvents(first, HAPPY_PATH.slice(3)); // overlap of 4 events
    expect(reconnected).toEqual(final);
    expect(reconnected.sources).toHaveLength(2);
    expect(reconnected.research.queriesIssued).toBe(2);
    expect(reconnected.spark.text).toBe(STREAMED_TEXT);
  });

  it("ignores events for a different analysis", () => {
    const started = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, 2));
    const foreign = { ...HAPPY_PATH[2], analysis_id: "an_other" } as AnalysisEvent;
    expect(applyEvent(started, foreign)).toBe(started);
  });

  it("never moves a terminal state again", () => {
    const late = { ...(HAPPY_PATH[25] as AnalysisEventOf<"spark.token">), seq: 999, text: "late" };
    expect(applyEvent(final, late)).toBe(final);
  });
});

describe("terminal failures", () => {
  it("treats a user cancel as cancelled, keeping what was already visible", () => {
    const state = applyEvents(initialAnalysisState, CANCELLED_PATH);
    expect(state.status).toBe("cancelled");
    expect(state.error?.code).toBe("CANCELLED");
    expect(state.partial).toBe(true);
    expect(state.sources).toHaveLength(2);
    expect(state.calculations.items).toHaveLength(1);
    expect(state.research.currentQuery).toBeNull();
  });

  it("surfaces the backend error for a failed analysis", () => {
    const state = applyEvents(initialAnalysisState, FAILED_PATH);
    expect(state.status).toBe("failed");
    expect(state.error).toMatchObject({ code: "RESEARCH_UNAVAILABLE", retryable: true, details: { reason: "ticker_directory_unavailable" } });
    expect(state.partial).toBe(false);
    expect(state.sources).toHaveLength(0);
  });

  it("marks a truncated synthesis as partial even though the analysis completed", () => {
    const state = applyEvents(initialAnalysisState, TRUNCATED_PATH);
    expect(state.status).toBe("completed");
    expect(state.partial).toBe(true);
    expect(state.spark.truncated).toBe(true);
    expect(state.spark.text).toBe(STREAMED_TEXT);
  });
});

describe("analysisReducer lifecycle", () => {
  it("submit → created → events → completed", () => {
    let state: AnalysisViewState = analysisReducer(initialAnalysisState, { type: "submit", query: "Assess Example Holdings.", profile: "fast" });
    expect(state.status).toBe("submitting");
    state = analysisReducer(state, {
      type: "created",
      response: { analysis_id: ANALYSIS_ID, status: "queued", profile: "fast", resolved_horizon: "multi_horizon" },
    });
    expect(state).toMatchObject({ status: "queued", analysisId: ANALYSIS_ID, resolvedHorizon: "multi_horizon" });
    for (const event of HAPPY_PATH) state = analysisReducer(state, { type: "event", event });
    expect(state.status).toBe("completed");
  });

  it("drops stream events for another analysis once one is active", () => {
    let state = analysisReducer(initialAnalysisState, {
      type: "created",
      response: { analysis_id: ANALYSIS_ID, status: "queued", profile: "fast", resolved_horizon: "multi_horizon" },
    });
    const foreign = { ...HAPPY_PATH[0], analysis_id: "an_other" } as AnalysisEvent;
    const next = analysisReducer(state, { type: "event", event: foreign });
    expect(next).toBe(state);
    state = next;
  });

  it("request_failed records the synchronous error", () => {
    const state = analysisReducer(analysisReducer(initialAnalysisState, { type: "submit", query: "q", profile: "deep" }), {
      type: "request_failed",
      error: { code: "DEEP_PROFILE_UNAVAILABLE", message: "Deep analysis isn't available.", retryable: true, details: null },
    });
    expect(state.status).toBe("failed");
    expect(state.error?.code).toBe("DEEP_PROFILE_UNAVAILABLE");
  });

  it("a terminal result settles a state whose stream was lost", () => {
    const lost = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, 12));
    const settled = applyResult({ ...lost, streamFallback: true }, completedResult());
    expect(settled.status).toBe("completed");
    expect(settled.result?.analysis_id).toBe(ANALYSIS_ID);
    expect(settled.spark.text).toBe(STREAMED_TEXT); // recovered from streamed_text
    expect(settled.spark.phase).toBe("completed");
    expect(settled.totalRequestMs).toBe(61234.5);
  });

  it("a terminal result replaces a partial stream with the canonical text and settles Spark", () => {
    const firstToken = HAPPY_PATH.findIndex((e) => e.event === "spark.token");
    expect(firstToken).toBeGreaterThan(0);
    const cut = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, firstToken + 1)); // stream lost after one token
    expect(cut.spark.phase).toBe("streaming");
    expect(cut.spark.text.length).toBeGreaterThan(0);
    expect(cut.spark.text.length).toBeLessThan(STREAMED_TEXT.length);
    const settled = applyResult({ ...cut, streamFallback: true }, completedResult());
    expect(settled.status).toBe("completed");
    expect(settled.spark.text).toBe(STREAMED_TEXT);
    expect(settled.spark.phase).toBe("completed");
    // A terminal result without persisted text keeps what was streamed and still settles the phase.
    const failed = applyResult(cut, completedResult({ status: "failed", streamed_text: "", partial: true }));
    expect(failed.spark.text).toBe(cut.spark.text);
    expect(failed.spark.phase).toBe("completed");
  });

  it("a running snapshot never regresses the live status", () => {
    const live = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, 18));
    const snapshot = applyResult(live, completedResult({ status: "researching", streamed_text: "", partial: true }));
    expect(snapshot.status).toBe("calculating");
    expect(snapshot.result?.status).toBe("researching");
  });

  it("a result for another analysis is ignored", () => {
    const live = applyEvents(initialAnalysisState, HAPPY_PATH.slice(0, 3));
    expect(applyResult(live, completedResult({ analysis_id: "an_other" }))).toBe(live);
  });

  it("stream_fallback and reset", () => {
    const flagged = analysisReducer(initialAnalysisState, { type: "stream_fallback" });
    expect(flagged.streamFallback).toBe(true);
    expect(analysisReducer(flagged, { type: "reset" })).toBe(initialAnalysisState);
  });
});
