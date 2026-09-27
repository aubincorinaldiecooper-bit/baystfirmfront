/**
 * The progress trace maps 1:1 from received phase events: one step per
 * milestone event, in seq order, nothing added by time, nothing estimated,
 * and no Laya internals (questions, answers, probabilities) in any label.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MILESTONE_EVENTS, applyEvents, initialAnalysisState } from "@/lib/analysis/reducer";
import { layaStageLabel, phaseLabel, progressSteps } from "@/lib/analysis/progress";
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

  it("shows a wait for the single Spark lane from spark.queued, with the backend's count", () => {
    /* a spark.queued event built from the schema (the doubles' single run never queues) */
    const loadingIndex = events.findIndex((e) => e.event === "spark.loading");
    const queued = {
      event: "spark.queued",
      analysis_id: events[0].analysis_id,
      seq: events[loadingIndex].seq /* takes the place of spark.loading */,
      ts: events[loadingIndex].ts,
      profile: "fast",
      active_analyses: 2,
    } as AnalysisEvent;
    const state = applyEvents(initialAnalysisState, [...events.slice(0, loadingIndex), queued]);
    expect(phaseLabel(state)).toBe("Waiting for the synthesis model");
    const steps = progressSteps(state);
    expect(steps[steps.length - 1]).toMatchObject({ event: "spark.queued", status: "active", detail: "2 analyses active" });
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
