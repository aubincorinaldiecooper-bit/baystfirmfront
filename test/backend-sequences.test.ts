/**
 * The reducer over complete event sequences the backend actually produced
 * (test/fixtures/backend, generated with the backend's own test doubles):
 * completed, failed and cancelled runs, replays with duplicates, a reconnect
 * mid-stream, a lost stream settled by the durable result, attaching from a
 * running snapshot, and the optional PR #4 requirement labels.
 */
import { describe, expect, it } from "vitest";
import {
  MILESTONE_EVENTS,
  analysisReducer,
  applyEvents,
  applyResult,
  initialAnalysisState,
} from "@/lib/analysis/reducer";
import { requirementLabels } from "@/lib/analysis/requirements";
import { SseParser, parseAnalysisEvent } from "@/lib/api/sse";
import type { AnalysisEvent, AnalysisEventOf, AnalysisResult } from "@/lib/api/types";
import { cancelledRun, clone, completedRun, completedSseTranscript, failedRun } from "./fixtures/backend";

const count = (events: AnalysisEvent[], name: AnalysisEvent["event"]) => events.filter((e) => e.event === name).length;
const tokensText = (events: AnalysisEvent[]) =>
  events
    .filter((e): e is AnalysisEventOf<"spark.token"> => e.event === "spark.token")
    .map((e) => e.text)
    .join("");

describe("the backend's SSE transcript", () => {
  it("parses into exactly the recorded events", () => {
    const parser = new SseParser();
    const frames = [...parser.feed(completedSseTranscript), ...parser.end()];
    const events = frames.map(parseAnalysisEvent).filter((e): e is AnalysisEvent => e !== null);
    expect(events).toEqual(completedRun.events);
    expect(frames.every((f) => f.id === null || Number(f.id) === (JSON.parse(f.data) as { seq: number }).seq)).toBe(true);
  });
});

describe("completed run", () => {
  const { events, result } = completedRun;
  const final = applyEvents(initialAnalysisState, events);

  it("settles on completed with every recorded phase", () => {
    expect(final.status).toBe("completed");
    expect(final.analysisId).toBe(result.analysis_id);
    expect(final.lastSeq).toBe(events[events.length - 1].seq);
    expect(final.eventCount).toBe(events.length);
    expect(final.error).toBeNull();
    expect(final.partial).toBe(false);
    expect(final.instrument).toMatchObject({ symbol: "AAPL", name: "Apple Inc." });
  });

  it("records research, calculations and the streamed text as the backend sent them", () => {
    expect(final.research.queries.map((q) => q.label)).toEqual(
      events.filter((e): e is AnalysisEventOf<"research.query"> => e.event === "research.query").map((e) => e.label),
    );
    expect(final.research.rejected.map((r) => r.reason)).toEqual(["published_after_as_of", "thin_content"]);
    expect(final.sources).toHaveLength(count(events, "research.source_found"));
    expect(final.calculations.items).toHaveLength(count(events, "calculation.completed"));
    expect(final.spark.text).toBe(tokensText(events));
    expect(final.spark.text).toBe(result.streamed_text);
    expect(final.spark.phase).toBe("completed");
  });

  it("keeps one milestone per phase event, in seq order", () => {
    const expected = events.filter((e) => (MILESTONE_EVENTS as readonly string[]).includes(e.event));
    expect(final.milestones.map((m) => [m.seq, m.event])).toEqual(expected.map((e) => [e.seq, e.event]));
    expect(final.milestones.filter((m) => m.event === "laya.started").map((m) => m.key)).toEqual([
      "research_plan",
      "evidence_scan",
      "horizon",
    ]);
  });

  it("takes the durable result on top without changing the outcome", () => {
    const settled = applyResult(final, result);
    expect(settled.status).toBe("completed");
    expect(settled.result).toBe(result);
    expect(settled.partial).toBe(false);
    expect(settled.spark.text).toBe(result.streamed_text);
  });
});

describe("replays", () => {
  const { events } = completedRun;
  const straight = applyEvents(initialAnalysisState, events);

  it("ignores a full duplicate replay", () => {
    expect(applyEvents(initialAnalysisState, [...events, ...events])).toEqual(straight);
  });

  it("ignores overlapping replay windows", () => {
    const first = applyEvents(initialAnalysisState, events.slice(0, 150));
    const overlapped = applyEvents(first, events.slice(100));
    expect(overlapped).toEqual(straight);
  });

  it("drops events of another analysis", () => {
    const foreign = events.map((e) => ({ ...e, analysis_id: "an_other" }));
    const mixed = applyEvents(applyEvents(initialAnalysisState, events.slice(0, 5)), [...foreign.slice(5), ...events.slice(5)]);
    expect(mixed).toEqual(straight);
  });
});

describe("reconnect mid-stream", () => {
  const { events, result } = completedRun;
  const straight = applyEvents(initialAnalysisState, events);
  const tokenIndex = events.findIndex((e) => e.event === "spark.token") + 20;

  it("resumes after Last-Event-ID to the same state as an unbroken stream", () => {
    const beforeDrop = applyEvents(initialAnalysisState, events.slice(0, tokenIndex));
    /* the backend replays the persisted events after the resume point, then follows live ones */
    const resumed = events.filter((e) => e.seq > beforeDrop.lastSeq);
    expect(applyEvents(beforeDrop, resumed)).toEqual(straight);
  });

  it("is unaffected when a resume replays events it already has", () => {
    const beforeDrop = applyEvents(initialAnalysisState, events.slice(0, tokenIndex));
    const stale = events.filter((e) => e.seq > beforeDrop.lastSeq - 10);
    expect(applyEvents(beforeDrop, stale)).toEqual(straight);
  });

  it("settles a lost stream from the durable result, with the canonical text", () => {
    const lost = applyEvents(initialAnalysisState, events.slice(0, tokenIndex));
    expect(lost.status).toBe("synthesizing");
    expect(result.streamed_text.startsWith(lost.spark.text)).toBe(true);
    expect(lost.spark.text.length).toBeLessThan(result.streamed_text.length);
    const settled = analysisReducer(analysisReducer(lost, { type: "stream_fallback" }), { type: "result", result });
    expect(settled.status).toBe("completed");
    expect(settled.spark.text).toBe(result.streamed_text);
    expect(settled.spark.phase).toBe("completed");
    expect(settled.streamFallback).toBe(true);
    expect(analysisReducer(settled, { type: "stream_resumed" }).streamFallback).toBe(false);
  });
});

describe("attaching after a reload", () => {
  const { events, result } = completedRun;
  const running: AnalysisResult = { ...clone(result), status: "synthesizing", partial: true, completed_at: null };

  it("takes the job fields from the running snapshot, then the replay rebuilds the rest", () => {
    const attached = analysisReducer(initialAnalysisState, { type: "attach", snapshot: running });
    expect(attached).toMatchObject({ analysisId: result.analysis_id, status: "synthesizing", query: "Assess Apple.", profile: "fast" });
    expect(attached.eventCount).toBe(0);
    const replayed = applyEvents(attached, events);
    expect(replayed.status).toBe("completed");
    expect(replayed.milestones).toEqual(applyEvents(initialAnalysisState, events).milestones);
  });

  it("does not treat a running snapshot's partial flag as an incomplete result", () => {
    const attached = analysisReducer(initialAnalysisState, { type: "attach", snapshot: running });
    const withSnapshot = applyResult(attached, running);
    expect(withSnapshot.partial).toBe(false);
    expect(withSnapshot.status).toBe("synthesizing");
  });

  it("maps resolving_instrument to the resolving UI status", () => {
    const attached = analysisReducer(initialAnalysisState, { type: "attach", snapshot: { ...running, status: "resolving_instrument" } });
    expect(attached.status).toBe("resolving");
  });
});

describe("failed run", () => {
  const { events, result } = failedRun;
  const final = applyEvents(initialAnalysisState, events);

  it("ends failed with the structured error and keeps what research found", () => {
    expect(final.status).toBe("failed");
    expect(final.error).toEqual({ code: "LAYA_INFERENCE_FAILED", message: "The decision model failed.", retryable: true, details: null });
    expect(final.partial).toBe(true);
    expect(final.sources.length).toBeGreaterThan(0);
    expect(final.laya.research_plan.status).toBe("running");
    const settled = applyResult(final, result);
    expect(settled.status).toBe("failed");
    expect(settled.result?.sources.length).toBe(result.sources.length);
  });
});

describe("cancelled run", () => {
  const { events, result, cancel_response } = cancelledRun;
  const final = applyEvents(initialAnalysisState, events);

  it("branches on status, not on the error code", () => {
    expect(final.status).toBe("cancelled");
    expect(final.error?.code).toBe("CANCELLED");
    expect(final.partial).toBe(true);
    /* the cancel response echoes the pre-cancel stage; the terminal event decides */
    expect(cancel_response.status).toBe("synthesizing");
  });

  it("keeps the streamed prefix, which equals the durable streamed_text", () => {
    expect(final.spark.text).toBe(tokensText(events));
    expect(final.spark.text).toBe(result.streamed_text);
    const settled = applyResult(final, result);
    expect(settled.partial).toBe(true);
    expect(settled.spark.phase).toBe("completed");
  });

  it("records a cancel request until the terminal event, and never after it", () => {
    const running = applyEvents(initialAnalysisState, events.slice(0, -1));
    const requested = analysisReducer(running, { type: "cancel_requested" });
    expect(requested.cancelRequested).toBe(true);
    expect(requested.status).toBe("synthesizing");
    expect(analysisReducer(final, { type: "cancel_requested" }).cancelRequested).toBe(false);
  });
});

describe("requirement labels (backend PR #4, optional)", () => {
  const internalPlan = "Plan: first fetch the 10-K, then compare the multiple against the five-year median because the user asked about valuation";

  it("reads only short product-level string labels", () => {
    expect(
      requirementLabels([
        "Valuation history",
        { label: "Earnings trajectory" },
        "Valuation history",
        internalPlan,
        "two\nlines",
        42,
        { reason: "internal" },
        "  Price performance  ",
      ]),
    ).toEqual(["Valuation history", "Earnings trajectory", "Price performance"]);
    expect(requirementLabels("Valuation history")).toEqual([]);
    expect(requirementLabels(undefined)).toEqual([]);
  });

  it("collects labels from research.started, ignoring the intent and interpretation fields", () => {
    const { events } = completedRun;
    const index = events.findIndex((e) => e.event === "research.started");
    const started = {
      ...events[index],
      question_intent: { kind: "valuation", reasoning: internalPlan },
      requirements: ["Valuation history", "Price performance", internalPlan],
      interpretation_source: "laya",
    } as AnalysisEvent;
    const withLabels = applyEvents(initialAnalysisState, [...events.slice(0, index), started, ...events.slice(index + 1)]);
    expect(withLabels.research.requirements).toEqual(["Valuation history", "Price performance"]);
    expect(JSON.stringify(withLabels)).not.toContain("reasoning");
    expect(applyEvents(initialAnalysisState, events).research.requirements).toEqual([]);
  });
});
