/**
 * What the market views have to show for one analysis: the company's identity
 * and, when the backend sent any, its price rows and quarterly fundamentals.
 * The current backend uses web search only and sends neither, so the views
 * show honest empty states; the charts render only for data that is present.
 */

import type { AnalysisViewState } from "@/lib/analysis/reducer";
import type { MarketFundamentals, MarketSeries } from "@/lib/api/types";
import { seriesFor, toBars, type Bar } from "./series";

export const NO_PRICE_HISTORY = "No price history — web search didn't return a page with this company's daily prices.";
export const NO_QUARTERLY_FIGURES = "No quarterly figures — web search didn't return a page with this company's quarterly results.";

export interface SymbolIdentity {
  symbol: string;
  /** The company name, or the symbol when the backend sent no name (never invented). */
  name: string;
  exchange: string | null;
  sector: string | null;
}

export function symbolIdentity(state: AnalysisViewState): SymbolIdentity | null {
  const instrument = state.instrument ?? state.result?.instrument ?? null;
  if (instrument?.symbol) {
    return {
      symbol: instrument.symbol,
      name: instrument.name?.trim() || instrument.symbol,
      exchange: instrument.exchange ?? null,
      sector: instrument.sector ?? null,
    };
  }
  const company = seriesFor(state.market.series, "company");
  return company ? { symbol: company.symbol, name: company.name?.trim() || company.symbol, exchange: null, sector: null } : null;
}

export interface MarketData {
  series: MarketSeries[];
  company: MarketSeries | null;
  /** The company's daily rows; [] when no price series was sent. */
  bars: Bar[];
  fundamentals: MarketFundamentals | null;
}

export function marketData(state: AnalysisViewState): MarketData {
  const series = state.market.series.filter((s) => toBars(s.points).length > 0);
  const company = seriesFor(series, "company");
  const fundamentals = state.market.fundamentals && state.market.fundamentals.quarters.length > 0 ? state.market.fundamentals : null;
  return { series, company, bars: company ? toBars(company.points) : [], fundamentals };
}
