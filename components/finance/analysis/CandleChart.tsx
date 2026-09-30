"use client";

/* Candlesticks for the company series (daily, weekly or monthly candles,
 * aggregated in the browser from the daily rows). Plain SVG sized from its
 * box: a right price axis with gridline labels, a dashed last-price line with
 * a colored tag on the axis, and a crosshair on hover with a price tag on the
 * axis and a date tag on the time axis. Up is the gain token, down the loss
 * token. Rendered only when a price series exists; the OHLC table is its
 * non-visual alternative. */

import { useState } from "react";
import { formatDay, formatDayShort, formatMonth, formatMonthYear, formatPrice, formatYear } from "@/lib/market/format";
import { INTERVAL_LABEL, niceTicks, paddedExtent, RANGE_PHRASE, type Candle, type CandleInterval, type RangeKey } from "@/lib/market/series";
import { labelIndices } from "./CompareChart";
import { useElementSize } from "./controls";

const LEFT = 8;
const TOP = 12;
const AXIS = 72;
const BOTTOM = 36;

/** A candle's period as the OHLC readout shows it. */
export function candlePeriod(candle: Candle, interval: CandleInterval): string {
  if (interval === "daily" || candle.start === candle.end) return formatDay(candle.end);
  if (interval === "monthly") return formatMonth(candle.start);
  return `${formatDayShort(candle.start)} – ${formatDay(candle.end)}`;
}

function tagLabel(candle: Candle, interval: CandleInterval): string {
  if (interval === "monthly") return formatMonthYear(candle.start);
  return formatDay(interval === "weekly" ? candle.start : candle.end);
}

function axisLabel(candle: Candle, range: RangeKey): string {
  if (range === "1M") return formatDayShort(candle.end);
  if (range === "5Y") return formatYear(candle.end);
  return formatMonthYear(candle.end);
}

export default function CandleChart({
  candles,
  interval,
  range,
  symbol,
  hover,
  onHover,
}: {
  candles: readonly Candle[];
  interval: CandleInterval;
  range: RangeKey;
  symbol: string;
  /** Index of the hovered candle, shared with the OHLC readout above the chart. */
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const [pointerY, setPointerY] = useState(0);
  const m = candles.length;
  const ready = width > 0 && height > 0 && m > 0;
  const last = candles[m - 1];
  const aria = last
    ? `${symbol} ${INTERVAL_LABEL[interval].toLowerCase()} candles over ${RANGE_PHRASE[range]}, last close ${formatPrice(last.close)}`
    : `${symbol} candles`;

  const px1 = Math.max(LEFT + 10, width - AXIS);
  const pw = px1 - LEFT;
  const ph = Math.max(10, height - TOP - BOTTOM);
  const extent = paddedExtent(candles.flatMap((c) => [c.low, c.high]), 0.06) ?? [0, 1];
  const [lo, hi] = extent;
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * ph;
  const slot = pw / Math.max(1, m);
  const bodyWidth = Math.max(1, Math.min(slot * 0.64, 22));
  const x = (i: number) => LEFT + slot * (i + 0.5);
  const ticks = niceTicks(lo, hi, 5);

  let wickUp = "";
  let wickDown = "";
  let bodyUp = "";
  let bodyDown = "";
  candles.forEach((c, i) => {
    const cx = x(i).toFixed(1);
    const wick = `M${cx} ${y(c.high).toFixed(1)}V${y(c.low).toFixed(1)}`;
    const top = y(Math.max(c.open, c.close));
    const bottom = y(Math.min(c.open, c.close));
    const body = `M${(x(i) - bodyWidth / 2).toFixed(1)} ${top.toFixed(1)}h${bodyWidth.toFixed(1)}v${Math.max(1, bottom - top).toFixed(1)}h${(-bodyWidth).toFixed(1)}Z`;
    if (c.close >= c.open) {
      wickUp += wick;
      bodyUp += body;
    } else {
      wickDown += wick;
      bodyDown += body;
    }
  });

  const lastUp = last ? last.close >= (m > 1 ? candles[m - 2].close : last.open) : true;
  const lastColor = lastUp ? "var(--gain)" : "var(--loss)";
  const hovered = hover !== null && hover < m ? candles[hover] : null;
  const hy = TOP + Math.min(ph, Math.max(0, pointerY * ph));
  const hPrice = hi - ((hy - TOP) / ph) * (hi - lo);
  const hx = hover !== null ? x(hover) : 0;
  const dateTagX = Math.min(px1 - 104, Math.max(LEFT, hx - 52));

  return (
    <div ref={ref} className="relative min-h-[220px] flex-1 overflow-hidden rounded-[8px] bg-inset">
      {ready && last && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aria} className="absolute inset-0 block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={px1} y1={y(t)} y2={y(t)} stroke="var(--line-strong)" />
              <text x={px1 + 10} y={y(t) + 3.5} fontSize={10.5} fill="var(--ink-2)">
                {formatPrice(t)}
              </text>
            </g>
          ))}
          {labelIndices(m).map((k, j, all) => (
            <text
              key={k}
              x={x(k)}
              y={height - 10}
              textAnchor={j === 0 && all.length > 1 ? "start" : j === all.length - 1 && all.length > 1 ? "end" : "middle"}
              fontSize={10.5}
              fill="var(--ink-2)"
            >
              {axisLabel(candles[k], range)}
            </text>
          ))}
          <path d={wickUp || "M0 0"} fill="none" stroke="var(--gain)" strokeWidth={1} />
          <path d={wickDown || "M0 0"} fill="none" stroke="var(--loss)" strokeWidth={1} />
          <path d={bodyUp || "M0 0"} fill="var(--gain)" />
          <path d={bodyDown || "M0 0"} fill="var(--loss)" />
          <line x1={LEFT} x2={px1} y1={y(last.close)} y2={y(last.close)} stroke={lastColor} strokeDasharray="2 3" opacity={0.85} />
          <rect x={px1 + 2} y={y(last.close) - 9} width={66} height={18} rx={4} fill={lastColor} />
          <text x={px1 + 35} y={y(last.close) + 3.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--tag-fg)">
            {formatPrice(last.close)}
          </text>
          {hovered && (
            <g>
              <line x1={hx} x2={hx} y1={TOP} y2={TOP + ph} stroke="var(--ink-2)" strokeDasharray="3 3" />
              <line x1={LEFT} x2={px1} y1={hy} y2={hy} stroke="var(--ink-2)" strokeDasharray="3 3" />
              <rect x={px1 + 2} y={hy - 9} width={66} height={18} rx={4} fill="var(--ink)" />
              <text x={px1 + 35} y={hy + 3.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--page)">
                {formatPrice(hPrice)}
              </text>
              <rect x={dateTagX} y={height - 23} width={104} height={18} rx={4} fill="var(--ink)" />
              <text x={dateTagX + 52} y={height - 10.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--page)">
                {tagLabel(hovered, interval)}
              </text>
            </g>
          )}
        </svg>
      )}
      {ready && (
        <div
          aria-hidden
          className="absolute cursor-crosshair"
          style={{ left: LEFT, top: TOP, width: pw, height: ph }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const fx = Math.min(0.9999, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
            setPointerY(Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))));
            onHover(Math.floor(fx * m));
          }}
          onPointerLeave={() => onHover(null)}
        />
      )}
    </div>
  );
}

/** The candles as a table, newest first. */
export function CandleTable({ candles, interval, symbol }: { candles: readonly Candle[]; interval: CandleInterval; symbol: string }) {
  const rows = [...candles].reverse();
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <caption className="pb-2 text-left text-[12px] text-ink-2">
          {symbol} {INTERVAL_LABEL[interval].toLowerCase()} open, high, low and close, newest first.
        </caption>
        <thead>
          <tr>
            {["Period", "Open", "High", "Low", "Close"].map((h, i) => (
              <th key={h} scope="col" className={`border-b border-line px-2 py-1.5 font-medium text-ink-2 ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.start}>
              <th scope="row" className="border-b border-line px-2 py-1.5 text-left font-normal text-ink">
                {candlePeriod(c, interval)}
              </th>
              {[c.open, c.high, c.low, c.close].map((v, i) => (
                <td key={i} className="border-b border-line px-2 py-1.5 text-right font-mono text-ink">
                  {formatPrice(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
