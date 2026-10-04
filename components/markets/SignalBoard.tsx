"use client";

/* One classifier's latest state per instrument, exactly as the backend
 * recorded it: label, probability, horizon, evidence, freshness, abstention
 * and the shadow / calibration status. */

import { Badge } from "@/components/finance/ui";
import { formatClock, formatMs, horizonLabel, metricLabel, stateLabel } from "@/lib/markets/labels";
import type { Classification, Evidence } from "@/lib/markets/types";

function evidenceText(item: Evidence): string {
  const value = typeof item.value === "number" ? String(item.value) : item.value;
  return item.threshold === null || item.threshold === undefined
    ? `${metricLabel(item.metric)}: ${value}`
    : `${metricLabel(item.metric)}: ${value} (threshold ${item.threshold})`;
}

export default function SignalBoard({ items, empty }: { items: Classification[]; empty: string }) {
  if (items.length === 0) return <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
      <table className="w-full min-w-[720px] text-left text-[12.5px]">
        <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Instrument</th>
            <th className="px-2 py-2 font-medium">State</th>
            <th className="px-2 py-2 font-medium">Probability</th>
            <th className="px-2 py-2 font-medium">Horizon</th>
            <th className="px-2 py-2 font-medium">Evidence</th>
            <th className="px-2 py-2 font-medium">Freshness</th>
            <th className="px-4 py-2 font-medium">Observed</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const state = stateLabel(item.label);
            return (
              <tr key={item.classification_id} className="border-b border-line align-top last:border-0">
                <td className="px-4 py-2.5 font-mono text-ink">{item.symbol}</td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={state.tone} dot>
                      {state.label}
                    </Badge>
                    {item.shadow && <Badge tone="neutral">Shadow</Badge>}
                    {item.calibration_status !== "validated" && <Badge tone="orange">Uncalibrated</Badge>}
                  </div>
                </td>
                <td className="px-2 py-2.5 font-mono tabular-nums text-ink-2">
                  {item.abstained ? "Abstained" : `${(item.probability * 100).toFixed(1)}%`}
                </td>
                <td className="px-2 py-2.5 tabular-nums text-ink-2">{horizonLabel(item.horizon_seconds)}</td>
                <td className="px-2 py-2.5 text-ink-2">
                  <ul className="space-y-0.5">
                    {item.evidence.map((evidence) => (
                      <li key={evidence.metric}>{evidenceText(evidence)}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-2 py-2.5 font-mono tabular-nums text-ink-2">{formatMs(item.freshness_ms)}</td>
                <td className="px-4 py-2.5 font-mono text-ink-3">{formatClock(item.observed_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
