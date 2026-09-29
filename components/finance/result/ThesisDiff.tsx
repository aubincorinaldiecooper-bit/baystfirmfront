"use client";

/* What changed since the prior assessment of the same company (backend PR #3,
 * optional `thesis_diff`). Stances, calculation displays, conflicts,
 * uncertainties and freshness are the backend's structured comparison; the
 * scope note explains when the two runs covered different horizons. */

import Link from "next/link";
import type { StanceChange, ThesisDiff as ThesisDiffData } from "@/lib/api/types";
import { humanizeName, isoDate, stanceLabel, stanceTone } from "@/lib/analysis/labels";
import { horizonLabel } from "@/lib/analysis/progress";
import { Badge, Section } from "../ui";

function StanceRow({ label, change }: { label: string; change: StanceChange }) {
  return (
    <tr className="border-t border-line first:border-t-0">
      <th scope="row" className="py-2 pr-3 text-left text-[12.5px] font-medium text-ink-2">
        {label}
      </th>
      <td className="py-2 pr-3">
        {change.previous ? <Badge tone={stanceTone(change.previous)}>{stanceLabel(change.previous)}</Badge> : <span className="text-[12px] text-ink-3">not assessed</span>}
      </td>
      <td className="py-2 pr-3">
        {change.current ? <Badge tone={stanceTone(change.current)}>{stanceLabel(change.current)}</Badge> : <span className="text-[12px] text-ink-3">not assessed</span>}
      </td>
      <td className="py-2 text-[12px]">{change.changed ? <span className="font-medium text-orange">Changed</span> : <span className="text-ink-3">—</span>}</td>
    </tr>
  );
}

function scopeNote(diff: ThesisDiffData): string | null {
  if (!diff.horizon_scope_changed) return null;
  if (diff.overall.compared_horizons.length === 0) {
    return "The two assessments covered different horizons and share none, so the overall stance is not compared.";
  }
  const shared = diff.overall.compared_horizons.map((h) => horizonLabel(h)).join(", ");
  return `The two assessments covered different horizons. The overall stance is compared only over the horizons both assessed: ${shared}.`;
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">{title}</p>
      <ul className="list-disc pl-5 text-[12.5px] leading-[1.55] text-ink">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ThesisDiff({ diff }: { diff: ThesisDiffData | null | undefined }) {
  if (!diff || typeof diff !== "object" || !diff.overall) return null;
  const note = scopeNote(diff);
  const f = diff.freshness;
  return (
    <Section
      id="thesis-diff"
      title="Since the prior assessment"
      aside={
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={diff.stance_changed ? "orange" : "neutral"}>{diff.stance_changed ? "Stance changed" : "Stance unchanged"}</Badge>
          {f?.new_quarter && <Badge tone="accent">New quarter</Badge>}
          {f?.newer_prices && <Badge tone="accent">Newer prices</Badge>}
        </span>
      }
    >
      <div className="rounded-[12px] bg-surface p-3.5 shadow-card">
        <p className="text-[12.5px] text-ink-2">
          Compared with{" "}
          <Link href={`/analyses/${encodeURIComponent(diff.previous_analysis_id)}`} className="font-mono text-ink hover:underline">
            {diff.previous_analysis_id}
          </Link>{" "}
          as of {isoDate(diff.previous_as_of)} ({horizonLabel(diff.previous_horizon)})
        </p>
        {note && (
          <p role="note" className="mt-2 rounded-[8px] bg-inset px-3 py-2 text-[12.5px] leading-[1.5] text-ink">
            {note}
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left">
            <thead>
              <tr className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
                <th scope="col" className="pb-1 pr-3 font-medium">Scope</th>
                <th scope="col" className="pb-1 pr-3 font-medium">Before</th>
                <th scope="col" className="pb-1 pr-3 font-medium">Now</th>
                <th scope="col" className="pb-1 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              <StanceRow label="Overall" change={diff.overall} />
              {diff.horizons.map((h) => (
                <StanceRow key={h.scope} label={horizonLabel(h.scope)} change={h} />
              ))}
            </tbody>
          </table>
        </div>
        {diff.metrics.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">Calculations</p>
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {diff.metrics.map((m) => (
                <li key={m.name} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-ink-2" title={m.name}>
                    {humanizeName(m.name)}
                  </span>
                  <span className="font-mono text-ink">
                    {m.previous_display || "—"} → {m.current_display || "—"}
                  </span>
                  {(m.previous_period || m.current_period) && (
                    <span className="text-[11.5px] text-ink-3">
                      {m.previous_period === m.current_period ? m.current_period : `${m.previous_period ?? "—"} → ${m.current_period ?? "—"}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <List title="New conflicts" items={diff.new_conflicts} />
        <List title="Conflicts no longer present" items={diff.resolved_conflicts} />
        <List title="New uncertainties" items={diff.new_uncertainties} />
        <List title="Uncertainties no longer present" items={diff.resolved_uncertainties} />
        {f && (f.previous_latest_quarter_end || f.current_latest_quarter_end) && (
          <p className="mt-3 text-[12.5px] text-ink-2">
            Latest quarter end {f.previous_latest_quarter_end ?? "—"} → {f.current_latest_quarter_end ?? "—"}
            {f.previous_price_date || f.current_price_date ? ` · prices to ${f.previous_price_date ?? "—"} → ${f.current_price_date ?? "—"}` : ""}
          </p>
        )}
        {diff.summary.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink-2">Backend summary</summary>
            <ul className="mt-1 list-disc pl-5 text-[12px] leading-[1.55] text-ink-2">
              {diff.summary.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Section>
  );
}
