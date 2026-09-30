"use client";

/* Company vs benchmarks, as percent change from the start of the range, on
 * one axis of the company's trading dates. Plain SVG sized from its box:
 * gridlines with labels, a dashed zero line, direct end labels, a legend with
 * each series' change, a hover crosshair with a tooltip, and numbered markers
 * for 10-K / 10-Q filing dates among the kept sources. Rendered only when
 * price series exist; the table view is its non-visual alternative. */

import { useState } from "react";
import type { FilingMarker } from "@/lib/analysis/activity";
import { formatDay, formatDayShort, formatMonthYear, formatPct, formatPctTick, formatPrice, formatYear } from "@/lib/market/format";
import { niceTicks, paddedExtent, RANGE_PHRASE, type Comparison, type RangeKey } from "@/lib/market/series";
import { SERIES_COLOR, signClass, useElementSize } from "./controls";

const M = { left: 44, right: 112, top: 12, bottom: 28 };

export function axisDateLabel(date: string, range: RangeKey): string {
  if (range === "1M") return formatDayShort(date);
  if (range === "5Y") return formatYear(date);
  return formatMonthYear(date);
}

/** Up to `count` evenly spaced indices over [0, n-1], first and last included. */
export function labelIndices(n: number, count = 5): number[] {
  const out: number[] = [];
  if (n <= 0) return out;
  for (let j = 0; j < count; j += 1) {
    const k = count === 1 ? n - 1 : Math.round((j * (n - 1)) / (count - 1));
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

function linePath(values: readonly (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export interface PlacedMarker extends FilingMarker {
  n: number;
  index: number;
}

/** Filing markers inside the axis, numbered in date order, at the first trading date on or after the filing. */
export function placeMarkers(dates: readonly string[], markers: readonly FilingMarker[]): PlacedMarker[] {
  if (dates.length === 0) return [];
  const first = dates[0];
  const last = dates[dates.length - 1];
  return markers
    .filter((m) => m.date >= first && m.date <= last)
    .map((m, i) => ({ ...m, n: i + 1, index: Math.max(0, dates.findIndex((d) => d >= m.date)) }));
}

export default function CompareChart({
  comparison,
  range,
  markers,
  onPickSource,
}: {
  comparison: Comparison;
  range: RangeKey;
  markers: readonly FilingMarker[];
  onPickSource: (sourceId: string) => void;
}) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const [hoverIndex, setHover] = useState<number | null>(null);
  const { dates, lines } = comparison;
  const n = dates.length;
  const hover = hoverIndex !== null && hoverIndex < n ? hoverIndex : null;
  const company = lines.find((l) => l.role === "company") ?? lines[0];
  const placed = placeMarkers(dates, markers);

  const aria = `Percent change over ${RANGE_PHRASE[range]}: ${lines
    .map((l) => `${l.symbol} ${l.end === null ? "no data" : formatPct(l.end)}`)
    .join(", ")}`;

  const x0 = M.left;
  const x1 = Math.max(M.left + 10, width - M.right);
  const y0 = M.top;
  const y1 = Math.max(M.top + 10, height - M.bottom);
  const extent = paddedExtent([0, ...lines.flatMap((l) => l.changes.filter((v): v is number => v !== null))]) ?? [-1, 1];
  const [lo, hi] = extent;
  const x = (i: number) => x0 + (n > 1 ? i / (n - 1) : 0.5) * (x1 - x0);
  const y = (v: number) => y0 + ((hi - v) / (hi - lo)) * (y1 - y0);
  const ticks = niceTicks(lo, hi, 5);

  /* direct end labels, pushed apart so they never overlap */
  const ends = lines
    .filter((l) => l.end !== null)
    .map((l) => ({ line: l, raw: y(l.end as number) }))
    .sort((a, b) => a.raw - b.raw);
  let previous = -Infinity;
  const labelY = new Map<string, number>();
  for (const end of ends) {
    const at = Math.min(Math.max(end.raw, previous + 16, y0 + 8), height - 4);
    previous = at;
    labelY.set(end.line.role, at);
  }

  const tipLeft = hover === null ? 0 : x(hover) + 206 < width ? x(hover) + 12 : x(hover) - 200;
  const ready = width > 0 && height > 0 && n > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <ul aria-label="Change over the range" className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-ink-2">
        {lines.map((line) => (
          <li key={line.role} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ background: SERIES_COLOR[line.role] }} />
            <span className="text-ink">{line.symbol}</span>
            <span className="sr-only">{line.name}</span>
            <strong className={`font-semibold ${signClass(line.end)}`}>{line.end === null ? "—" : formatPct(line.end)}</strong>
          </li>
        ))}
      </ul>

      <div ref={ref} className="relative min-h-[180px] flex-1 overflow-hidden rounded-[8px] bg-inset">
        {ready && (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aria} className="absolute inset-0 block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke="var(--line-strong)" strokeWidth={1} />
                <text x={x0 - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--ink-2)">
                  {formatPctTick(t)}
                </text>
              </g>
            ))}
            <line x1={x0} x2={x1} y1={y(0)} y2={y(0)} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
            {labelIndices(n).map((k, j, all) => (
              <text
                key={k}
                x={x(k)}
                y={height - 9}
                textAnchor={j === 0 ? "start" : j === all.length - 1 ? "end" : "middle"}
                fontSize={10.5}
                fill="var(--ink-2)"
              >
                {axisDateLabel(dates[k], range)}
              </text>
            ))}
            {[...lines].reverse().map((line) => (
              <path
                key={line.role}
                d={linePath(line.changes, x, y)}
                fill="none"
                stroke={SERIES_COLOR[line.role]}
                strokeWidth={line.role === "company" ? 2.25 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {company &&
              placed.map((marker) => {
                const value = company.changes[marker.index];
                if (value === null || value === undefined) return null;
                return (
                  <g key={marker.sourceId}>
                    <line x1={x(marker.index)} x2={x(marker.index)} y1={y(value)} y2={y1} stroke="var(--line-strong)" strokeDasharray="2 3" />
                    <circle cx={x(marker.index)} cy={y(value)} r={8} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={1.5} />
                    <text x={x(marker.index)} y={y(value) + 3.4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">
                      {marker.n}
                    </text>
                  </g>
                );
              })}
            {lines.map((line) =>
              line.end === null ? null : (
                <g key={line.role}>
                  <circle cx={x(n - 1)} cy={y(line.end)} r={4} fill={SERIES_COLOR[line.role]} stroke="var(--inset)" strokeWidth={2} />
                  <text
                    x={x1 + 12}
                    y={(labelY.get(line.role) ?? y(line.end)) + 4}
                    fontSize={11.5}
                    fontWeight={line.role === "company" ? 600 : 500}
                    fill={line.role === "company" ? "var(--ink)" : "var(--ink-2)"}
                  >
                    {line.symbol} {formatPct(line.end)}
                  </text>
                </g>
              ),
            )}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={y0} y2={y1} stroke="var(--ink-2)" strokeWidth={1} />
                {lines.map((line) => {
                  const v = line.changes[hover];
                  return v === null ? null : (
                    <circle key={line.role} cx={x(hover)} cy={y(v)} r={4.5} fill={SERIES_COLOR[line.role]} stroke="var(--inset)" strokeWidth={2} />
                  );
                })}
              </g>
            )}
          </svg>
        )}
        {ready && (
          <div
            aria-hidden
            className="absolute top-0 cursor-crosshair"
            style={{ left: x0, width: x1 - x0, height }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const f = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
              setHover(Math.round(f * (n - 1)));
            }}
            onPointerLeave={() => setHover(null)}
          />
        )}
        {ready && hover !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-2.5 flex w-[188px] flex-col gap-1 rounded-[8px] bg-surface px-2.5 py-2 shadow-raised"
            style={{ left: Math.max(4, tipLeft) }}
          >
            <div className="text-[11.5px] font-semibold text-ink">{formatDay(dates[hover])}</div>
            {lines.map((line) => {
              const v = line.changes[hover];
              const close = line.closes[hover];
              return (
                <div key={line.role} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                  <span className="size-2 rounded-full" style={{ background: SERIES_COLOR[line.role] }} />
                  <span className="min-w-0 flex-1 truncate">{line.symbol}</span>
                  <span className="font-mono text-ink">
                    {v === null ? "—" : formatPct(v)}
                    {close !== null ? ` · ${formatPrice(close)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {placed.length > 0 && (
        <ul aria-label="Filings on the chart" className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-ink-2">
          {placed.map((marker) => (
            <li key={marker.sourceId}>
              <button
                type="button"
                onClick={() => onPickSource(marker.sourceId)}
                className="inline-flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 transition-colors duration-150 hover:bg-hover hover:text-ink"
              >
                <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full border-[1.5px] border-ink-2 text-[9.5px] font-semibold text-ink">
                  {marker.n}
                </span>
                {marker.form} filed · {formatDay(marker.date)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The comparison as a table: sampled dates, each series' change and close. */
export function CompareTable({ comparison, range }: { comparison: Comparison; range: RangeKey }) {
  const { dates, lines } = comparison;
  const rows = labelIndices(dates.length, Math.min(12, dates.length)).reverse();
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <caption className="pb-2 text-left text-[12px] text-ink-2">
          Percent change from {formatDay(dates[0])} over {RANGE_PHRASE[range]}, with the close, at sampled dates (newest first).
        </caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-line px-2 py-1.5 text-left font-medium text-ink-2">
              Date
            </th>
            {lines.map((line) => (
              <th key={line.role} scope="col" className="border-b border-line px-2 py-1.5 text-right font-medium text-ink-2">
                {line.symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k}>
              <th scope="row" className="border-b border-line px-2 py-1.5 text-left font-normal text-ink">
                {formatDay(dates[k])}
              </th>
              {lines.map((line) => {
                const v = line.changes[k];
                const close = line.closes[k];
                return (
                  <td key={line.role} className="border-b border-line px-2 py-1.5 text-right font-mono text-ink">
                    {v === null ? "—" : formatPct(v)}
                    {close !== null ? <span className="text-ink-2"> · {formatPrice(close)}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
