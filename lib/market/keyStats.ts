/**
 * The Symbol panel's key stats: the backend's own calculations, each shown
 * with its `display` string, plus two figures computed here from the daily
 * rows when a price series exists (52-week range, 30-day average volume).
 */

import { averageVolume, fiftyTwoWeekRange, type Bar } from "./series";
import { formatCompact, formatPrice } from "./format";

/** Calculation name → label, in display order (contract v1). */
export const KEY_STAT_CALCULATIONS: readonly (readonly [string, string])[] = [
  ["market_cap", "Market cap"],
  ["pe_ttm", "P/E (TTM)"],
  ["beta_1y_vs_market", "Beta vs market (1Y)"],
  ["max_drawdown_1y", "Max drawdown (1Y)"],
  ["volatility_1y_annualized", "Volatility (1Y)"],
  ["revenue_growth_yoy", "Revenue growth (YoY)"],
  ["fcf_margin", "FCF margin"],
  ["ev_ebitda_ttm", "EV/EBITDA (TTM)"],
];

export interface KeyStat {
  key: string;
  label: string;
  value: string;
  /** Computed in the browser from the price rows rather than by the backend. */
  derived: boolean;
}

export interface CalculationLike {
  name: string;
  status: string;
  display: string;
}

/** The backend reports "computed"; the contract calls it "ok". Anything else is skipped. */
function isOk(status: string): boolean {
  return status === "computed" || status === "ok";
}

/**
 * Key stats from the calculations (later entries with the same name win, so
 * the durable result can override the streamed ones) and, when `bars` has
 * rows, the 52-week range and the 30-day average volume.
 */
export function keyStats(calculations: readonly CalculationLike[], bars: readonly Bar[] | null): KeyStat[] {
  const byName = new Map<string, CalculationLike>();
  for (const calc of calculations) byName.set(calc.name, calc);
  const stats: KeyStat[] = [];
  for (const [name, label] of KEY_STAT_CALCULATIONS) {
    const calc = byName.get(name);
    if (!calc || !isOk(calc.status) || !calc.display) continue;
    stats.push({ key: name, label, value: calc.display, derived: false });
  }
  if (bars && bars.length > 0) {
    const range = fiftyTwoWeekRange(bars);
    if (range) {
      stats.push({ key: "range_52w", label: "52-week range", value: `${formatPrice(range.low)} – ${formatPrice(range.high)}`, derived: true });
    }
    const volume = averageVolume(bars, 30);
    if (volume !== null) stats.push({ key: "avg_volume_30d", label: "Average volume (30D)", value: formatCompact(volume), derived: true });
  }
  return stats;
}
