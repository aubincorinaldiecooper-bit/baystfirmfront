"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed. */

import { Liveline, type LivelinePoint, type LivelineSeries } from "liveline";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * INSIGHT CARDS
 * Embedded mini-visualizations in an "Insights N ‹ ›"
 * carousel. Every page, series, label and value comes from
 * the caller; an empty page list renders nothing.
 *
 * Charts plot only the values given: no resampling or
 * smoothing, and the hover readout snaps to a real data
 * point, so a tooltip never shows an interpolated number.
 * ───────────────────────────────────────────────────────── */

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export const formatPercent = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/* Liveline plots against time. Values are spaced evenly and the snapshot is
 * anchored to *call* time (inside each card's mount-time memo): a module-load
 * constant goes stale, and once the points age past the chart window the
 * canvas renders empty. Positions are layout only; readouts use the values. */
function makePoints(values: number[], gap = 6): LivelinePoint[] {
  const end = Math.floor(Date.now() / 1000);
  return values.map((value, index) => ({
    time: end - (values.length - 1 - index) * gap,
    value,
  }));
}

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

/** inline @entity mention for page prose */
export function InsightEntity({ name, tone }: { name: string; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-baseline font-medium text-ink">
      <span className={`inline-block size-2.5 rounded-full ${tone}`} />
      {name}
    </span>
  );
}

/** a signed figure in page prose */
export function InsightFigure({ children, tone }: { children: ReactNode; tone: "red" | "green" | "neutral" }) {
  return (
    <code className={`font-mono text-[11.5px] tabular-nums ${tone === "red" ? "text-red" : tone === "green" ? "text-green" : "text-ink"}`}>
      {children}
    </code>
  );
}

function chartIndexFromPointer(event: React.PointerEvent<HTMLDivElement>, pointCount: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(progress * (pointCount - 1));
}

function ChartTooltip({ rows }: { rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="insight-chart-tooltip">
      {rows.map((row) => (
        <span key={row.label} className="insight-chart-tooltip-item">
          <span className="insight-chart-tooltip-dot" style={{ background: row.color }} />
          {row.value}
        </span>
      ))}
    </div>
  );
}

function HoverReadout({ index, count, children }: { index: number; count: number; children: ReactNode }) {
  const pct = count > 1 ? (index / (count - 1)) * 100 : 50;
  return (
    <>
      <span className="insight-chart-cursor" style={{ left: `${pct}%` }} />
      <span className="insight-chart-tooltip-anchor" style={{ left: `${Math.min(Math.max(pct, 28), 72)}%` }}>
        {children}
      </span>
    </>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-field px-2 py-0.5 text-[10.5px] font-medium text-ink-2">{children}</span>;
}

/* ── series comparison ─────────────────────────────────── */

export type CompareSeries = {
  name: string;
  values: number[];
  /** secondary figure under the headline value */
  sub?: string;
  tone: "red" | "green";
  /** Tailwind background class for the legend dot */
  dot: string;
  /** line colour on the canvas */
  color: string;
  /** tooltip dot colour, e.g. "var(--accent)" */
  tooltipColor: string;
};

/** two or more series on one line chart, each with its latest value */
export function CompareCard({
  series,
  caption,
  badge,
  formatValue = formatPercent,
}: {
  series: CompareSeries[];
  caption: string;
  badge?: string;
  formatValue?: (v: number) => string;
}) {
  const dark = useDarkMode();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const points = useMemo(() => series.map((s) => makePoints(s.values, 6)), [series]);
  const pointCount = Math.max(0, ...series.map((s) => s.values.length));
  const windowSecs = Math.max(6, (pointCount - 1) * 6);

  const chartSeries: LivelineSeries[] = useMemo(
    () =>
      series.map((s, i) => ({
        id: s.name,
        label: "",
        data: points[i],
        value: s.values.at(-1) ?? 0,
        color: s.color,
      })),
    [series, points],
  );

  if (series.length === 0 || pointCount === 0) return null;

  return (
    <div className="rounded-card bg-surface p-3 shadow-hairline">
      <div className="flex items-center gap-4">
        {series.map((s) => {
          const last = s.values.at(-1);
          return (
            <div key={s.name} className="flex-1">
              <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                <span className={`size-2 rounded-full ${s.dot}`} />
                {s.name}
              </span>
              {last !== undefined && (
                <span className={`block text-[17px] font-semibold tracking-[-0.01em] tabular-nums ${s.tone === "red" ? "text-red" : "text-green"}`}>
                  {formatValue(last)}
                </span>
              )}
              {s.sub && <InsightFigure tone={s.tone}>{s.sub}</InsightFigure>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 overflow-hidden rounded-control bg-inset shadow-hairline">
        <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
          <span className="text-[11px] text-ink-3 tabular-nums">{caption}</span>
          {badge && <Badge>{badge}</Badge>}
        </div>
        <div
          className="insight-chart-stage relative h-[166px]"
          onPointerDown={(event) => setHoverIndex(chartIndexFromPointer(event, pointCount))}
          onPointerMove={(event) => setHoverIndex(chartIndexFromPointer(event, pointCount))}
          onPointerLeave={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerUp={() => setHoverIndex(null)}
        >
          <Liveline
            data={[]}
            value={0}
            series={chartSeries}
            theme={dark ? "dark" : "light"}
            grid={false}
            pulse={false}
            window={windowSecs}
            paused
            scrub={false}
            cursor="default"
            lineWidth={2.25}
            padding={{ top: 40, right: 0, bottom: 22, left: 0 }}
            formatValue={formatValue}
          />
          {hoverIndex !== null && (
            <HoverReadout index={hoverIndex} count={pointCount}>
              <ChartTooltip
                rows={series
                  .filter((s) => s.values[hoverIndex] !== undefined)
                  .map((s) => ({ label: s.name, value: formatValue(s.values[hoverIndex]), color: s.tooltipColor }))}
              />
            </HoverReadout>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── single metric with optional toggle ────────────────── */

export type InsightMetric = {
  key: string;
  /** toggle label */
  label: string;
  values: number[];
  format: (v: number) => string;
  /** chart caption when not hovering, e.g. a reference level */
  caption?: string;
};

/** one metric at a time on a line chart; a toggle appears for two or more */
export function MetricCard({
  title,
  metrics,
  badge,
  color = "var(--accent)",
  lineColor = "#3d9aff",
  summary,
}: {
  title: string;
  metrics: InsightMetric[];
  badge?: string;
  /** tooltip dot colour */
  color?: string;
  /** line colour on the canvas */
  lineColor?: string;
  summary?: { value: string; delta?: string; deltaTone?: "red" | "green"; context?: string };
}) {
  const dark = useDarkMode();
  const [metricKey, setMetricKey] = useState(metrics[0]?.key);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const data = useMemo(() => (metric ? makePoints(metric.values, 7) : []), [metric]);

  if (!metric || metric.values.length === 0) return null;
  const count = metric.values.length;

  return (
    <div className="rounded-card bg-surface p-3 shadow-hairline">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ink">{title}</span>
        {badge && <Badge>{badge}</Badge>}
      </div>
      <div className="mt-2 overflow-hidden rounded-control bg-inset shadow-hairline">
        <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
          <span className="text-[11px] text-ink-3 tabular-nums">
            {hoverIndex !== null ? metric.format(metric.values[hoverIndex]) : metric.caption ?? ""}
          </span>
          {metrics.length > 1 && (
            <span className="flex rounded-full bg-field p-0.5" role="group" aria-label={`${title} metric`}>
              {metrics.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={metric.key === item.key}
                  onClick={() => setMetricKey(item.key)}
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
                    metric.key === item.key ? "bg-surface text-ink shadow-btn" : "text-ink-3 hover:text-ink-2"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </span>
          )}
        </div>
        <div
          className="insight-chart-stage relative h-[166px]"
          onPointerDown={(event) => setHoverIndex(chartIndexFromPointer(event, count))}
          onPointerMove={(event) => setHoverIndex(chartIndexFromPointer(event, count))}
          onPointerLeave={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerUp={() => setHoverIndex(null)}
        >
          <Liveline
            data={data}
            value={metric.values[count - 1]}
            theme={dark ? "dark" : "light"}
            color={lineColor}
            grid
            scrub={false}
            fill={false}
            pulse={false}
            momentum={false}
            paused
            window={Math.max(7, (count - 1) * 7)}
            lineWidth={2.25}
            cursor="crosshair"
            padding={{ top: 34, right: 0, bottom: 22, left: 0 }}
            formatValue={metric.format}
          />
          {hoverIndex !== null && (
            <HoverReadout index={hoverIndex} count={count}>
              <ChartTooltip rows={[{ label: metric.label, value: metric.format(metric.values[hoverIndex]), color }]} />
            </HoverReadout>
          )}
        </div>
      </div>
      {summary && (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink tabular-nums">{summary.value}</span>
          {summary.delta && <InsightFigure tone={summary.deltaTone ?? "neutral"}>{summary.delta}</InsightFigure>}
          {summary.context && <span className="text-[11px] text-ink-3">{summary.context}</span>}
        </div>
      )}
    </div>
  );
}

/* ── allocation ────────────────────────────────────────── */

export type AllocationSegment = {
  name: string;
  label: string;
  /** share of the whole, 0..100 */
  pct: number;
  amount: string;
  /** Tailwind background class for the bar segment */
  cls: string;
  /** Tailwind text class for the inspector label */
  tone: string;
};

/** a whole split into segments: hero amount + segmented bar + legend */
export function AllocationCard({
  title,
  segments,
  note,
}: {
  title: string;
  segments: AllocationSegment[];
  /** explanatory text under the inspector label */
  note?: string;
}) {
  const [selected, setSelected] = useState(segments[0]?.name);
  const active = segments.find((segment) => segment.name === selected) ?? segments[0];
  if (!active) return null;

  return (
    <div className="rounded-card bg-surface p-3 shadow-hairline">
      <span className="text-[12px] font-medium text-ink">{title}</span>
      <span className="mt-1 block text-[20px] font-semibold tracking-[-0.01em] text-ink tabular-nums">{active.amount}</span>
      <div className="mt-3 flex h-9 gap-0.5 overflow-hidden rounded-full bg-field p-0.5" role="group" aria-label={`${title} segments`}>
        {segments.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={active.name === s.name}
            aria-label={`${s.label}: ${s.pct}%`}
            onClick={() => setSelected(s.name)}
            className={`relative h-full overflow-hidden rounded-full ${s.cls} transition-[opacity,transform,box-shadow] duration-300 active:scale-[0.98]`}
            style={{
              width: `${s.pct}%`,
              opacity: active.name === s.name ? 1 : 0.58,
              boxShadow: active.name === s.name ? "inset 0 0 0 1px rgba(255,255,255,0.22)" : undefined,
              transitionTimingFunction: EASE,
            }}
          >
            <span
              className="absolute inset-y-1 left-1 rounded-full bg-white/20 transition-[width,opacity] duration-500"
              style={{
                width: active.name === s.name ? "calc(100% - 8px)" : "0%",
                opacity: active.name === s.name ? 1 : 0,
                transitionTimingFunction: EASE,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {segments.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={active.name === s.name}
            onClick={() => setSelected(s.name)}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
              active.name === s.name ? "bg-field text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            <span className={`size-1.5 rounded-full ${s.cls}`} />
            {s.name} <span className="tabular-nums">{s.pct}%</span>
          </button>
        ))}
      </div>
      <div className="mt-3 min-h-10 rounded-control bg-inset px-2.5 py-2 shadow-hairline">
        <span className={`block text-[11.5px] font-medium ${active.tone}`}>{active.label}</span>
        {note && <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">{note}</span>}
      </div>
    </div>
  );
}

/* ── carousel ──────────────────────────────────────────── */

export type InsightPage = {
  key: string;
  prose: ReactNode;
  card: ReactNode;
  /** optional follow-up action under the card */
  action?: { label: string; onClick: () => void };
};

export default function InsightCards({ title, pages }: { title: string; pages: InsightPage[] }) {
  const [page, setPage] = useState(0);
  if (pages.length === 0) return null;
  const index = Math.min(page, pages.length - 1);
  const { prose, card, action } = pages[index];

  const move = (direction: -1 | 1) => {
    setPage((current) => (Math.min(current, pages.length - 1) + direction + pages.length) % pages.length);
  };

  return (
    <div className="w-full max-w-86">
      {/* pager header */}
      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <span className="text-[13px] text-ink-3 tabular-nums">{pages.length}</span>
        </span>
        {pages.length > 1 && (
          <span className="flex items-center gap-0.5">
            {(["M15 18l-6-6 6-6", "M9 6l6 6-6 6"] as const).map((d, i) => (
              <button
                key={i}
                type="button"
                aria-label={i === 0 ? "Previous insight" : "Next insight"}
                onClick={() => move(i === 0 ? -1 : 1)}
                className="flex size-6 items-center justify-center rounded-[6px] text-ink-3
                  transition-[background-color,color,transform] duration-100 hover:bg-hover
                  hover:text-ink active:scale-[0.96]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={d} />
                </svg>
              </button>
            ))}
          </span>
        )}
      </div>

      <div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{prose}</p>
        <div className="mt-2">{card}</div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 rounded-full bg-surface px-3 py-1.5 text-left text-[12px] text-ink
              shadow-btn transition-colors duration-100 hover:bg-hover"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
