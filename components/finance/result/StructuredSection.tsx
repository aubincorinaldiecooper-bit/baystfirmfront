"use client";

/* One of the assessment's structured sections (fundamentals, valuation,
 * benchmark, historical and market context), rendered from the backend's
 * dict as given (pipeline/assemble.py):
 *
 *   - `narrative`: Spark's text for the section, with its citations;
 *   - calculation views ({value, unit, display, period, calc_id, source_ids}):
 *     the backend's `display` string and period label, verbatim;
 *   - classification views ({decision, confidence, decision_id, label?}): only
 *     the category label (e.g. "unchanged"); numeric scores, probabilities and
 *     confidences of these internal decisions are not shown;
 *   - `benchmarks`, `price`, `periods`, `unusual_periods`: their fields as given.
 *
 * Unknown structured values are skipped rather than dumped. */

import RecordsTable, { type RecordsColumn } from "@/components/primitives/RecordsTable";
import { humanizeName, verbatim } from "@/lib/analysis/labels";
import { Section } from "../ui";
import { CitedText, SourceRefs, type SourceIndex } from "./sources";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalcView(value: unknown): value is Json & { display: string; calc_id: string } {
  return isObject(value) && typeof value.display === "string" && typeof value.calc_id === "string";
}

/** A category label from a classification view, or null for numeric/internal answers. */
function classificationLabel(value: unknown): string | null {
  if (!isObject(value) || typeof value.decision_id !== "string") return null;
  if (typeof value.label === "string") return value.label;
  if (typeof value.decision === "string") return humanizeName(value.decision);
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface Row {
  key: string;
  label: string;
  value: string;
  detail: string | null;
  sourceIds: string[];
  anchor: string | null;
}

function rowsOf(data: Json): Row[] {
  const rows: Row[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "narrative" || key === "benchmarks" || key === "periods" || key === "unusual_periods" || key === "price") continue;
    if (isCalcView(value)) {
      rows.push({
        key,
        label: humanizeName(key),
        value: value.display || verbatim(value.value),
        detail: typeof value.period === "string" ? value.period : null,
        sourceIds: stringList(value.source_ids),
        anchor: `calc-${value.calc_id}`,
      });
      continue;
    }
    const label = classificationLabel(value);
    if (label !== null) {
      rows.push({ key, label: humanizeName(key), value: label, detail: "classification", sourceIds: [], anchor: null });
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      rows.push({ key, label: humanizeName(key), value: verbatim(value), detail: null, sourceIds: [], anchor: null });
    }
  }
  return rows;
}

function MetricRows({ rows, sources }: { rows: Row[]; sources: SourceIndex }) {
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-line rounded-[10px] bg-surface shadow-card">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5">
          <dt className="min-w-[10rem] flex-1 text-[13px] text-ink-2" title={row.key}>
            {row.label}
          </dt>
          <dd className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-right">
            {row.anchor ? (
              <a href={`#${row.anchor}`} className="font-mono text-[13px] font-medium text-ink hover:underline">
                {row.value}
              </a>
            ) : (
              <span className="text-[13px] font-medium text-ink">{row.value}</span>
            )}
            {row.detail && <span className="text-[12px] text-ink-3">{row.detail}</span>}
            <SourceRefs ids={row.sourceIds} sources={sources} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Narrative({ value, sources }: { value: unknown; sources: SourceIndex }) {
  if (!isObject(value)) return null;
  const text = typeof value.text === "string" ? value.text : "";
  const items = stringList(value.items).filter((item) => item !== text);
  if (!text && items.length === 0) return null;
  return (
    <div className="mb-3 text-[13.5px] leading-[1.65] text-ink">
      {text && (
        <p className="whitespace-pre-wrap">
          <CitedText text={text} sources={sources} />
        </p>
      )}
      {items.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {items.map((item, index) => (
            <li key={index}>
              <CitedText text={item} sources={sources} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Benchmarks({ value }: { value: unknown }) {
  const items = Array.isArray(value) ? value.filter(isObject) : [];
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">Benchmarks</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((b, index) => (
          <li key={index} className="text-[13px] text-ink">
            <span className="font-medium">{verbatim(b.name)}</span>{" "}
            <span className="font-mono text-[12px] text-ink-2">{verbatim(b.symbol)}</span>
            {typeof b.role === "string" && <span className="text-ink-3"> · {humanizeName(b.role)}</span>}
            {typeof b.reason === "string" && b.reason && <span className="block text-[12px] text-ink-3">{b.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Price({ value, sources }: { value: unknown; sources: SourceIndex }) {
  if (!isObject(value) || value.value === null || value.value === undefined) return null;
  const details = [
    typeof value.price_type === "string" ? humanizeName(value.price_type) : null,
    typeof value.session_date === "string" ? `session ${value.session_date}` : null,
    typeof value.exchange_timezone === "string" ? value.exchange_timezone : null,
  ].filter(Boolean);
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
      <span className="text-ink-2">Price</span>
      <span className="font-mono font-medium text-ink">{verbatim(value.value)}</span>
      <span className="text-[12px] text-ink-3">{details.join(" · ")}</span>
      {typeof value.source_id === "string" && <SourceRefs ids={[value.source_id]} sources={sources} />}
    </div>
  );
}

function Periods({ value }: { value: unknown }) {
  const rows = Array.isArray(value) ? value.filter(isObject) : [];
  if (rows.length === 0) return null;
  const keys: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  const columns: RecordsColumn<Json>[] = keys.map((key) => ({
    key,
    header: key === "period" ? "Period" : humanizeName(key),
    cell: (row) => verbatim(row[key]) || "—",
    numeric: key !== "period",
    align: key === "period" ? "start" : "end",
    minWidth: key === "period" ? 110 : 120,
  }));
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">Reported periods (as recorded)</p>
      <RecordsTable label="Reported periods" columns={columns} rows={rows} rowKey={(row) => verbatim(row.period) || JSON.stringify(row)} />
    </div>
  );
}

function UnusualPeriods({ value }: { value: unknown }) {
  const periods = Array.isArray(value)
    ? value.filter(isObject).map((p) => p.period).filter((p): p is string => typeof p === "string")
    : [];
  if (periods.length === 0) return null;
  return (
    <p className="mt-3 text-[13px] text-ink-2">
      Periods flagged as historically unusual: <span className="text-ink">{periods.join(", ")}</span>
    </p>
  );
}

export default function StructuredSection({
  id,
  title,
  data,
  sources,
}: {
  id: string;
  title: string;
  data: Record<string, unknown>;
  sources: SourceIndex;
}) {
  const rows = rowsOf(data);
  const hasNarrative = isObject(data.narrative);
  const hasExtras = ["benchmarks", "periods", "unusual_periods", "price"].some((key) => {
    const v = data[key];
    return Array.isArray(v) ? v.length > 0 : isObject(v);
  });
  if (rows.length === 0 && !hasNarrative && !hasExtras) return null;
  return (
    <Section id={id} title={title}>
      <Narrative value={data.narrative} sources={sources} />
      <MetricRows rows={rows} sources={sources} />
      <Price value={data.price} sources={sources} />
      <Benchmarks value={data.benchmarks} />
      <UnusualPeriods value={data.unusual_periods} />
      <Periods value={data.periods} />
    </Section>
  );
}

