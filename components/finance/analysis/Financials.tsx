"use client";

/* Quarterly revenue (bars) and gross margin (line), from the optional
 * `market.fundamentals` block. Rendered only when the backend sent quarters;
 * the table view is the non-visual alternative. */

import type { MarketFundamentals } from "@/lib/api/types";
import { formatMoney } from "@/lib/market/format";

function latest<T>(values: readonly (T | null)[]): { value: T; index: number } | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value !== null) return { value, index: i };
  }
  return null;
}

function marginPath(values: readonly (number | null)[]): string {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return "";
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const span = hi - lo || 1;
  const n = values.length;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = n > 1 ? (i / (n - 1)) * 300 : 150;
    const y = 10 + ((hi - v) / span) * 100;
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

export default function Financials({ fundamentals, table }: { fundamentals: MarketFundamentals; table: boolean }) {
  const { quarters, currency } = fundamentals;
  const revenues = quarters.map((q) => q.revenue);
  const margins = quarters.map((q) => q.gross_margin_pct);
  const maxRevenue = Math.max(0, ...revenues.filter((v): v is number => v !== null));
  const lastRevenue = latest(revenues);
  const lastMargin = latest(margins);
  const first = quarters[0]?.label ?? "";
  const last = quarters[quarters.length - 1]?.label ?? "";

  if (table) {
    return (
      <section aria-label="Financials" className="min-w-0">
        <table className="w-full border-collapse text-[12.5px]">
          <caption className="pb-2 text-left text-[12px] font-semibold text-ink">Financials by quarter</caption>
          <thead>
            <tr>
              {["Quarter", "Revenue", "Gross margin"].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`border-b border-line px-2 py-1.5 font-medium text-ink-2 ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
              <tr key={`${q.label}-${q.end}`}>
                <th scope="row" className="border-b border-line px-2 py-1.5 text-left font-normal text-ink">
                  {q.label}
                </th>
                <td className="border-b border-line px-2 py-1.5 text-right font-mono text-ink">
                  {q.revenue === null ? "—" : formatMoney(q.revenue, currency)}
                </td>
                <td className="border-b border-line px-2 py-1.5 text-right font-mono text-ink">
                  {q.gross_margin_pct === null ? "—" : `${q.gross_margin_pct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section aria-label="Financials" className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 @min-[520px]:flex-row">
        <div className="flex min-h-[80px] min-w-0 flex-1 flex-col gap-2 rounded-[8px] bg-inset p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[12.5px] font-normal text-ink-2">Revenue by quarter</h3>
            <span className="text-[13px] font-semibold text-ink">
              {lastRevenue ? `${formatMoney(lastRevenue.value, currency)} · ${quarters[lastRevenue.index].label}` : "—"}
            </span>
          </div>
          <div
            role="img"
            aria-label={
              lastRevenue
                ? `Revenue by quarter from ${first} to ${last}, latest ${formatMoney(lastRevenue.value, currency)} in ${quarters[lastRevenue.index].label}`
                : "No revenue figures"
            }
            className="flex min-h-[48px] flex-1 items-end gap-0.5"
          >
            {quarters.map((q) => (
              <div
                key={`${q.label}-${q.end}`}
                title={q.revenue === null ? `${q.label}: not reported` : `${q.label}: ${formatMoney(q.revenue, currency)}`}
                className="flex-1 rounded-t-[4px] bg-series-company"
                style={{
                  height: q.revenue === null || maxRevenue <= 0 ? 0 : `${Math.max(2, (q.revenue / maxRevenue) * 100)}%`,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10.5px] text-ink-2">
            <span>{first}</span>
            <span>{last}</span>
          </div>
        </div>
        <div className="flex min-h-[80px] min-w-0 flex-1 flex-col gap-2 rounded-[8px] bg-inset p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[12.5px] font-normal text-ink-2">Gross margin</h3>
            <span className="text-[13px] font-semibold text-ink">
              {lastMargin ? `${lastMargin.value.toFixed(1)}% · ${quarters[lastMargin.index].label}` : "—"}
            </span>
          </div>
          <svg
            viewBox="0 0 300 120"
            preserveAspectRatio="none"
            role="img"
            aria-label={
              lastMargin
                ? `Gross margin by quarter from ${first} to ${last}, latest ${lastMargin.value.toFixed(1)}%`
                : "No gross margin figures"
            }
            className="block min-h-[48px] w-full flex-1"
          >
            <path
              d={marginPath(margins) || "M0 0"}
              fill="none"
              stroke="var(--series-company)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex justify-between text-[10.5px] text-ink-2">
            <span>{first}</span>
            <span>{last}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
