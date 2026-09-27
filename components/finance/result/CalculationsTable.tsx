"use client";

/* Every deterministic calculation the backend recorded: its formula, each
 * operand with value, unit, period and source, the result's display string
 * and period label, the computed / unavailable status and the missing inputs.
 * Values are shown as recorded; nothing is recalculated here. */

import RecordsTable, { RecordsStatus, type RecordsColumn } from "@/components/primitives/RecordsTable";
import type { CalculationInput, CalculationResult } from "@/lib/api/types";
import { humanizeName, verbatim } from "@/lib/analysis/labels";
import { Section } from "../ui";
import { SourceChip, type SourceIndex } from "./sources";

function Wrap({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <div className={`whitespace-normal break-words py-1.5 leading-snug ${mono ? "font-mono text-[11.5px]" : ""}`}>{children}</div>;
}

function Operand({ input, sources }: { input: CalculationInput; sources: SourceIndex }) {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5">
      <span className="font-mono text-[11.5px] text-ink-2">{input.name}</span>
      <span className="font-mono text-[11.5px] text-ink">
        {input.value === null ? "missing" : verbatim(input.value)}
        {input.unit ? ` ${input.unit}` : ""}
      </span>
      {input.period_label && <span className="text-[11.5px] text-ink-3">{input.period_label}</span>}
      {input.source_id && <SourceChip id={input.source_id} sources={sources} />}
    </li>
  );
}

export function calculationColumns(sources: SourceIndex): RecordsColumn<CalculationResult>[] {
  return [
    {
      key: "name",
      header: "Calculation",
      width: 200,
      sortValue: (c) => c.name,
      cell: (c) => (
        <Wrap>
          <span id={`calc-${c.calc_id}`} title={c.name} className="scroll-mt-16">
            {humanizeName(c.name)}
          </span>
        </Wrap>
      ),
    },
    {
      key: "value",
      header: "Value",
      width: 120,
      align: "end",
      numeric: true,
      cell: (c) => <span className="font-mono">{c.display || verbatim(c.value) || "—"}</span>,
    },
    {
      key: "period",
      header: "Period",
      width: 190,
      cell: (c) => <Wrap>{c.period_label ?? "—"}</Wrap>,
    },
    {
      key: "status",
      header: "Status",
      width: 120,
      sortValue: (c) => c.status,
      cell: (c) =>
        c.status === "computed" ? (
          <RecordsStatus label="Computed" color="var(--green)" />
        ) : (
          <RecordsStatus label="Unavailable" color="var(--orange)" />
        ),
    },
    {
      key: "missing",
      header: "Missing inputs",
      width: 180,
      cell: (c) => (c.missing_inputs.length > 0 ? <Wrap mono>{c.missing_inputs.join(", ")}</Wrap> : "—"),
    },
    {
      key: "formula",
      header: "Formula",
      width: 300,
      cell: (c) => <Wrap mono>{c.formula}</Wrap>,
    },
    {
      key: "operands",
      header: "Operands",
      width: 360,
      cell: (c) =>
        c.inputs.length > 0 ? (
          <Wrap>
            <ul className="flex flex-col gap-0.5">
              {c.inputs.map((input, index) => (
                <Operand key={`${input.name}-${index}`} input={input} sources={sources} />
              ))}
            </ul>
          </Wrap>
        ) : (
          "—"
        ),
    },
    {
      key: "notes",
      header: "Notes",
      width: 320,
      cell: (c) => (c.notes.length > 0 ? <Wrap>{c.notes.join(" · ")}</Wrap> : "—"),
    },
  ];
}

export default function CalculationsTable({
  calculations,
  sources,
}: {
  calculations: CalculationResult[];
  sources: SourceIndex;
}) {
  if (calculations.length === 0) return null;
  const unavailable = calculations.filter((c) => c.status === "unavailable").length;
  return (
    <Section
      id="calculations"
      title="Calculations"
      count={calculations.length}
      aside={unavailable > 0 ? <span className="text-[12px] text-ink-3">{unavailable} unavailable</span> : undefined}
    >
      <RecordsTable label="Deterministic calculations" columns={calculationColumns(sources)} rows={calculations} rowKey={(c) => c.calc_id} />
    </Section>
  );
}
