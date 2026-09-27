"use client";

/* Valuation vs fundamentals (backend PR #3, optional). Shown only when a
 * computed `valuation_reconciliation_Ny` calculation carries a
 * `meta.reconciliation` record with a verdict. The verdict, the rule that
 * produced it, the backend's own statement and the component records'
 * display strings are shown as recorded; nothing is decomposed here. */

import type { CalculationResult, ReconciliationRecord } from "@/lib/api/types";
import { humanizeName } from "@/lib/analysis/labels";
import { Section } from "../ui";

export function reconciliationOf(calc: CalculationResult): ReconciliationRecord | null {
  if (!calc.name.startsWith("valuation_reconciliation_") || calc.status !== "computed") return null;
  const record = calc.meta?.reconciliation;
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const verdict = (record as { verdict?: unknown }).verdict;
  return typeof verdict === "string" && verdict ? (record as ReconciliationRecord) : null;
}

export default function Reconciliation({ calculations }: { calculations: CalculationResult[] }) {
  const items = calculations
    .map((calc) => ({ calc, record: reconciliationOf(calc) }))
    .filter((item): item is { calc: CalculationResult; record: ReconciliationRecord } => item.record !== null);
  if (items.length === 0) return null;
  const byName = new Map(calculations.map((c) => [c.name, c]));
  return (
    <Section id="reconciliation" title="Valuation vs fundamentals">
      <div className="flex flex-col gap-3">
        {items.map(({ calc, record }) => {
          const components = Object.entries(record.component_calcs ?? {})
            .map(([component, name]) => ({ component, calc: typeof name === "string" ? byName.get(name) : undefined }))
            .filter((c): c is { component: string; calc: CalculationResult } => c.calc !== undefined);
          const statement = calc.notes.length > 0 ? calc.notes[calc.notes.length - 1] : null;
          return (
            <article key={calc.calc_id} aria-label={humanizeName(calc.name)} className="rounded-[12px] bg-surface p-3.5 shadow-card">
              <p className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">{calc.period_label ?? humanizeName(calc.name)}</p>
              <p className="mt-1 text-[16px] font-semibold text-ink">{record.verdict}</p>
              <p className="mt-1 text-[13px] text-ink-2">
                Implied change in the multiple{" "}
                <a href={`#calc-${calc.calc_id}`} className="font-mono font-medium text-ink hover:underline">
                  {calc.display}
                </a>
              </p>
              {components.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
                  {components.map(({ component, calc: part }) => (
                    <li key={component}>
                      {humanizeName(component)}{" "}
                      <a href={`#calc-${part.calc_id}`} className="font-mono text-ink hover:underline">
                        {part.status === "computed" ? part.display : "unavailable"}
                      </a>
                      {part.period_label ? <span className="text-ink-3"> ({part.period_label})</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {statement && <p className="mt-2 text-[13px] leading-[1.55] text-ink">{statement}</p>}
              {typeof record.verdict_rule === "string" && record.verdict_rule && (
                <p className="mt-2 font-mono text-[11.5px] text-ink-3">Rule: {record.verdict_rule}</p>
              )}
            </article>
          );
        })}
      </div>
    </Section>
  );
}
