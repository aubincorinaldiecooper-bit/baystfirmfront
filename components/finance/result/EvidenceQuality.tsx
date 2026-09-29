"use client";

/* How current and how consistent the evidence is: the backend's freshness
 * summary (counts, latest periods and their ages as reported), the research
 * counts, the conflicts it preserved and the uncertainties it recorded. */

import type { Conflict, ResearchStats } from "@/lib/api/types";
import { freshnessLabel, freshnessTone, humanizeName, verbatim } from "@/lib/analysis/labels";
import { Badge, Field, Section } from "../ui";
import { SourceRefs, type SourceIndex } from "./sources";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): string | null => (typeof v === "number" ? verbatim(v) : null);

function age(days: unknown): string | null {
  return typeof days === "number" ? `${verbatim(days)} days old` : null;
}

export function FreshnessSummary({ summary, research }: { summary: Record<string, unknown>; research: ResearchStats | null }) {
  const facts = isObject(summary.facts) ? summary.facts : null;
  const prices = isObject(summary.prices) ? summary.prices : null;
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.filter((w): w is string => typeof w === "string") : [];
  if (!facts && !prices && warnings.length === 0 && !research) return null;
  const buckets = facts
    ? (["current", "recent", "stale", "unknown"] as const)
        .map((bucket) => (typeof facts[bucket] === "number" ? { bucket, count: facts[bucket] as number } : null))
        .filter((b): b is { bucket: "current" | "recent" | "stale" | "unknown"; count: number } => b !== null)
    : [];
  return (
    <Section id="freshness" title="Evidence freshness">
      <div className="rounded-[10px] bg-surface p-3.5 shadow-card">
        {buckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12.5px] text-ink-2">
              Facts{num(facts?.total) !== null ? ` (${num(facts?.total)})` : ""}
            </span>
            {buckets.map(({ bucket, count }) => (
              <Badge key={bucket} tone={freshnessTone(bucket)}>
                {freshnessLabel(bucket)} {count}
              </Badge>
            ))}
          </div>
        )}
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Latest quarter">
            {facts && str(facts.latest_quarter_end)
              ? [str(facts.latest_quarter_end), str(facts.latest_quarter_freshness) && freshnessLabel(String(facts.latest_quarter_freshness)), age(facts.latest_quarter_age_days)]
                  .filter(Boolean)
                  .join(" · ")
              : null}
          </Field>
          <Field label="Latest fiscal year">
            {facts && str(facts.latest_annual_end)
              ? [str(facts.latest_annual_end), str(facts.latest_annual_freshness) && freshnessLabel(String(facts.latest_annual_freshness)), age(facts.latest_annual_age_days)]
                  .filter(Boolean)
                  .join(" · ")
              : null}
          </Field>
          <Field label="Prices">
            {prices
              ? [str(prices.latest_date) ? `to ${prices.latest_date}` : null, str(prices.freshness) && freshnessLabel(String(prices.freshness)), age(prices.age_days), str(prices.price_type) && humanizeName(String(prices.price_type))]
                  .filter(Boolean)
                  .join(" · ") || null
              : null}
          </Field>
          <Field label="Research">
            {research
              ? `${research.queries_issued} queries · ${research.sources_fetched} sources fetched · ${research.sources_rejected} rejected${
                  research.termination_reason ? ` · ${humanizeName(research.termination_reason)}` : ""
                }`
              : null}
          </Field>
        </dl>
        {warnings.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-[12.5px] text-orange">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

const CONFLICT_STATUS: Record<Conflict["status"], string> = {
  conflict: "Conflict",
  resolved_by_primary: "Resolved by the primary source",
  unresolved: "Unresolved",
};

export function Conflicts({ conflicts, sources }: { conflicts: Conflict[]; sources: SourceIndex }) {
  if (conflicts.length === 0) return null;
  return (
    <Section id="conflicts" title="Conflicting sources" count={conflicts.length}>
      <ul className="flex flex-col gap-2">
        {conflicts.map((conflict, index) => (
          <li key={index} className="rounded-[10px] bg-surface p-3.5 shadow-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-[13.5px] font-medium text-ink" title={conflict.metric}>
                {humanizeName(conflict.metric)}
                {conflict.period_label ? <span className="font-normal text-ink-2"> · {conflict.period_label}</span> : null}
              </span>
              {conflict.material && <Badge tone="red">Material</Badge>}
              <Badge tone={conflict.status === "resolved_by_primary" ? "green" : "orange"}>{CONFLICT_STATUS[conflict.status] ?? conflict.status}</Badge>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-2">Reason: {humanizeName(conflict.reason)}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {conflict.values.map((value, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
                  <span className="font-mono text-ink">
                    {verbatim(value.value)}
                    {value.unit ? ` ${value.unit}` : ""}
                  </span>
                  <span className="text-ink-3">{[value.basis !== "unknown" ? value.basis.toUpperCase() : null, value.period_label].filter(Boolean).join(" · ")}</span>
                  <SourceRefs ids={[value.source_id]} sources={sources} />
                </li>
              ))}
            </ul>
            {conflict.note && <p className="mt-2 text-[12.5px] text-ink-2">{conflict.note}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function TextList({ id, title, items }: { id: string; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Section id={id} title={title} count={items.length}>
      <ul className="flex flex-col gap-1.5 rounded-[10px] bg-surface p-3.5 text-[13px] leading-[1.55] text-ink shadow-card">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-ink-3" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
