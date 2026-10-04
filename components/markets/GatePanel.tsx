"use client";

/* The promotion gate: each classifier's latest recorded evaluation run
 * against the backend's thresholds. A classifier reaches users as a trusted
 * signal only after an eligible run and a manual promotion. */

import { Badge } from "@/components/finance/ui";
import { CLASSIFIER_NAMES, failureLabel } from "@/lib/markets/labels";
import type { EvaluationGate, EvaluationRun } from "@/lib/markets/types";

type Row = {
  label: string;
  value: number | null;
  threshold: number | null | undefined;
  atLeast: boolean;
  count?: boolean;
};

function rows(run: EvaluationRun, thresholds: Partial<Record<string, number | null>>): Row[] {
  const m = run.metrics;
  return [
    { label: "Samples", value: m.sample_count, threshold: thresholds.minimum_samples, atLeast: true, count: true },
    { label: "Coverage", value: m.coverage, threshold: thresholds.minimum_coverage, atLeast: true },
    { label: "Accuracy", value: m.accuracy, threshold: thresholds.minimum_accuracy, atLeast: true },
    { label: "Macro recall", value: m.macro_recall ?? null, threshold: thresholds.minimum_macro_recall, atLeast: true },
    { label: "False-alert rate", value: m.false_alert_rate, threshold: thresholds.maximum_false_alert_rate, atLeast: false },
    { label: "Brier score", value: m.brier_score, threshold: thresholds.maximum_brier_score, atLeast: false },
    { label: "Calibration error (ECE)", value: m.expected_calibration_error, threshold: thresholds.maximum_expected_calibration_error, atLeast: false },
    { label: "p95 latency (ms)", value: m.p95_latency_ms, threshold: thresholds.maximum_p95_latency_ms, atLeast: false },
  ];
}

const show = (value: number | null, count?: boolean) =>
  value === null ? "—" : count ? String(value) : value.toFixed(4);

function RunCard({ run, thresholds }: { run: EvaluationRun; thresholds: Partial<Record<string, number | null>> }) {
  return (
    <div className="rounded-[10px] bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="text-[13.5px] font-medium text-ink">{CLASSIFIER_NAMES[run.classifier] ?? run.classifier}</span>
        <Badge tone={run.promotion_eligible ? "green" : "orange"} dot>
          {run.promotion_eligible ? "Eligible for manual promotion" : "Not eligible — stays in shadow"}
        </Badge>
      </div>
      <table className="w-full text-left text-[12.5px]">
        <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-2 py-2 font-medium">Measured</th>
            <th className="px-2 py-2 font-medium">Gate</th>
            <th className="px-4 py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows(run, thresholds).map((row) => {
            const passes =
              row.value === null || row.threshold == null
                ? null
                : row.atLeast
                  ? row.value >= row.threshold
                  : row.value <= row.threshold;
            return (
              <tr key={row.label} className="border-b border-line last:border-0">
                <td className="px-4 py-2 text-ink">{row.label}</td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-2">{show(row.value, row.count)}</td>
                <td className="px-2 py-2 font-mono tabular-nums text-ink-3">
                  {row.threshold == null ? "—" : `${row.atLeast ? "≥" : "≤"} ${show(row.threshold, row.count)}`}
                </td>
                <td className={`px-4 py-2 ${passes === null ? "text-ink-3" : passes ? "text-green" : "text-red"}`}>
                  {passes === null ? "—" : passes ? "Pass" : "Fail"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-3 text-[12px] leading-[1.5] text-ink-2">
        {run.failures.length > 0 && <p>Blocking: {run.failures.map(failureLabel).join(", ")}.</p>}
        <p className="text-ink-3">
          Run {run.run_id.slice(0, 8)} · recorded {run.created_at}
          {typeof run.dataset?.events === "number" ? ` · ${run.dataset.events} replayed events` : ""}
        </p>
      </div>
    </div>
  );
}

export default function GatePanel({ gate }: { gate: EvaluationGate }) {
  if (gate.runs.length === 0) {
    return (
      <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] leading-[1.5] text-ink-3 shadow-card">
        No evaluation run is recorded yet. Every classifier stays in shadow until a replay evaluation passes the gate.
      </p>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {gate.runs.map((run) => (
        <RunCard key={run.run_id} run={run} thresholds={gate.thresholds} />
      ))}
    </div>
  );
}
