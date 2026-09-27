/**
 * The progress trace maps 1:1 from received phase events: one step per
 * milestone event, in seq order, nothing added by time, nothing estimated,
 * and no Laya internals (questions, answers, probabilities) in any label.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MILESTONE_EVENTS, applyEvents, initialAnalysisState } from "@/lib/analysis/reducer";
import { THINKING, layaStageLabel, phaseLabel, progressSteps } from "@/lib/analysis/progress";
import type { AnalysisEvent, AnalysisEventOf } from "@/lib/api/types";
import { cancelledRun, completedRun, failedRun } from "./fixtures/backend";

afterEach(() => vi.useRealTimers());

const isMilestone = (e: AnalysisEvent) => (MILESTONE_EVENTS as readonly string[]).includes(e.event);
const upTo = (events: AnalysisEvent[], predicate: (e: AnalysisEvent) => boolean) => events.slice(0, events.findIndex(predicate) + 1);

describe("progress steps from the completed run", () => {
  const { events, result } = completedRun;
  const state = applyEvents(initialAnalysisState, events);
  const steps = progressSteps(state);

  it("has exactly one step per received milestone event, in seq order", () => {
    const milestones = events.filter(isMilestone);
    expect(steps.map((s) => [s.seq, s.event])).toEqual(milestones.map((e) => [e.seq, e.event]));
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("uses the backend's own query labels and counts", () => {
    const queries = events.filter((e): e is AnalysisEventOf<"research.query"> => e.event === "research.query");
    for (const query of queries) {
      expect(steps.find((s) => s.seq === query.seq)?.label).toBe(query.label);
    }
    const stats = events.find((e): e is AnalysisEventOf<"research.completed"> => e.event === "research.completed")!;
    expect(steps.find((s) => s.event === "research.completed")?.detail).toBe(
      `${stats.sources_fetched} sources · ${stats.sources_rejected} rejected`,
    );
    expect(steps.find((s) => s.event === "calculation.started")?.detail).toBe(
      `${events.filter((e) => e.event === "calculation.completed").length} recorded`,
    );
  });

  it("shows Laya only as product-level stage labels", () => {
    const laya = steps.filter((s) => s.event === "laya.started");
    expect(laya.map((s) => s.label)).toEqual([layaStageLabel("research_plan"), layaStageLabel("evidence_scan"), layaStageLabel("horizon")]);
    expect(layaStageLabel("some_future_stage")).toBe("Evaluating the evidence");
    const text = JSON.stringify(steps);
    for (const decision of result.laya_decisions) {
      expect(text).not.toContain(decision.question.instructions);
      expect(text).not.toContain(decision.decision_id);
      expect(text).not.toContain(decision.state_digest);
    }
    const decisions = events.filter((e): e is AnalysisEventOf<"laya.decision"> => e.event === "laya.decision");
    for (const d of decisions) expect(text).not.toContain(d.decision_type);
  });

  it("is all done once the analysis completed", () => {
    expect(steps.every((s) => s.status === "done")).toBe(true);
    expect(phaseLabel(state)).toBe("Analysis complete");
  });
});

describe("progress while running", () => {
  const { events } = completedRun;

  it("marks only the latest open step active", () => {
    const state = applyEvents(initialAnalysisState, upTo(events, (e) => e.event === "research.query"));
    const steps = progressSteps(state);
    expect(steps[steps.length - 1]).toMatchObject({ event: "research.query", status: "active" });
    expect(steps.slice(0, -1).every((s) => s.status === "done")).toBe(true);
    expect(phaseLabel(state)).toBe("Researching");
  });

  it("finishes a Laya stage on laya.completed without a later event", () => {
    const completedIndex = events.findIndex((e) => e.event === "laya.completed" && e.stage === "evidence_scan");
    const state = applyEvents(initialAnalysisState, events.slice(0, completedIndex + 1));
    const steps = progressSteps(state);
    expect(steps[steps.length - 1]).toMatchObject({ event: "laya.started", status: "done" });
    const running = progressSteps(applyEvents(initialAnalysisState, events.slice(0, completedIndex)));
    expect(running[running.length - 1]).toMatchObject({ event: "laya.started", status: "active" });
  });

  it("follows Spark's recorded phases", () => {
    const loading = applyEvents(initialAnalysisState, upTo(events, (e) => e.event === "spark.loading"));
    expect(phaseLabel(loading)).toBe("Loading the synthesis model");
    const writing = applyEvents(initialAnalysisState, upTo(events, (e) => e.event === "spark.token"));
    expect(phaseLabel(writing)).toBe("Writing the assessment");
    const steps = progressSteps(writing);
    expect(steps[steps.length - 1]).toMatchObject({ event: "spark.started", status: "active", label: "Writing the assessment" });
  });

  it("shows a synthesis wait as the ordinary thinking state, with no step of its own", () => {
    /* a spark.queued event built from the schema (the doubles' single run never queues) */
    const loadingIndex = events.findIndex((e) => e.event === "spark.loading");
    const queued = {
      event: "spark.queued",
      analysis_id: events[0].analysis_id,
      seq: events[loadingIndex].seq /* takes the place of spark.loading */,
      ts: events[loadingIndex].ts,
      profile: "fast",
      stage: "synthesis",
      active_analyses: 2,
    } as AnalysisEvent;
    const before = applyEvents(initialAnalysisState, events.slice(0, loadingIndex));
    const state = applyEvents(before, [queued]);
    expect(state.status).toBe("synthesizing");
    expect(phaseLabel(state)).toBe(THINKING);
    expect(progressSteps(state)).toEqual(progressSteps(before)); // no extra step, no churn
  });

  it("does not change as time passes", () => {
    vi.useFakeTimers();
    const state = applyEvents(initialAnalysisState, upTo(events, (e) => e.event === "research.query"));
    const before = progressSteps(state);
    vi.advanceTimersByTime(60_000);
    expect(progressSteps(state)).toEqual(before);
  });
});

describe("progress of runs that stop", () => {
  it("marks the interrupted stage as stopped on failure", () => {
    const state = applyEvents(initialAnalysisState, failedRun.events);
    const steps = progressSteps(state);
    expect(steps[steps.length - 1]).toMatchObject({ event: "laya.started", status: "stopped" });
    expect(steps.slice(0, -1).every((s) => s.status === "done")).toBe(true);
    expect(phaseLabel(state)).toBe("Analysis failed");
  });

  it("marks the synthesis as stopped on cancel", () => {
    const state = applyEvents(initialAnalysisState, cancelledRun.events);
    const steps = progressSteps(state);
    expect(steps[steps.length - 1]).toMatchObject({ event: "spark.started", status: "stopped" });
    expect(phaseLabel(state)).toBe("Analysis cancelled");
  });

  it("has no steps before any event arrived", () => {
    expect(progressSteps(initialAnalysisState)).toEqual([]);
  });
});

describe("question understanding before research (Bayanalytics#4)", () => {
  const { events } = completedRun;
  const resolvedAt = events.findIndex((e) => e.event === "instrument.resolved");
  const researchAt = events.findIndex((e) => e.event === "research.started");
  const base = { analysis_id: events[0].analysis_id, ts: events[resolvedAt].ts };
  const upToResolved = events.slice(0, resolvedAt + 1);
  /* pass-1 events built from the backend schema, renumbered after instrument.resolved */
  const lastSeq = events[resolvedAt].seq;
  const pass1 = (withStage: boolean) =>
    [
      { ...base, event: "spark.queued", seq: lastSeq + 0.1, profile: "fast", active_analyses: 2, ...(withStage ? { stage: "query_understanding" } : {}) },
      { ...base, event: "spark.loading", seq: lastSeq + 0.2, profile: "fast", context_ceiling: 32768, kv_cache_type: "q8_0" },
    ] as AnalysisEvent[];

  it("reads as thinking as soon as the company is known, with nothing added for an instant turn", () => {
    const resolved = applyEvents(initialAnalysisState, upToResolved);
    expect(resolved.status).toBe("resolving");
    expect(phaseLabel(resolved)).toBe(THINKING);
    expect(phaseLabel(applyEvents(initialAnalysisState, events.slice(0, resolvedAt)))).toBe("Identifying the company");
  });

  it.each([
    ["with the stage", true],
    ["from an older backend without it", false],
  ])("keeps a wait and a model load before research inside the thinking state (%s)", (_name, withStage) => {
    const resolved = applyEvents(initialAnalysisState, upToResolved);
    const waiting = applyEvents(resolved, pass1(withStage).slice(0, 1));
    expect(waiting.status).toBe("resolving");
    expect(waiting.understanding).toBe("waiting");
    expect(waiting.spark.phase).toBe("idle");
    expect(phaseLabel(waiting)).toBe(THINKING);
    const loading = applyEvents(waiting, pass1(withStage).slice(1));
    expect(loading.understanding).toBe("loading");
    expect(loading.status).toBe("resolving");
    expect(progressSteps(loading)).toEqual(progressSteps(resolved)); // no queue or model step
    const researching = applyEvents(loading, [events[researchAt]]);
    expect(researching.understanding).toBe("idle");
    expect(phaseLabel(researching)).toBe("Researching");
  });

  it("never names the queue, the scheduler or the model lane", () => {
    const states = [
      applyEvents(initialAnalysisState, [...upToResolved, ...pass1(true)]),
      applyEvents(initialAnalysisState, events),
    ];
    for (const state of states) {
      const texts = [phaseLabel(state), ...progressSteps(state).flatMap((s) => [s.label, s.detail ?? ""])];
      for (const text of texts) expect(text).not.toMatch(/wait|queue|scheduler|slot|lane|spark/i);
    }
  });
});
