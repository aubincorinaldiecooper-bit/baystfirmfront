/** Display names for Baystfirm values. Names only; numbers are shown as received. */

import type { Tone } from "@/lib/analysis/labels";

export const CLASSIFIER_NAMES: Record<string, string> = {
  stablecoin_peg: "Stablecoin peg",
  short_horizon_momentum: "Short-horizon momentum",
};

const VENUE_NAMES: Record<string, string> = {
  binanceus: "Binance.US",
};

export const venueLabel = (venue: string) => VENUE_NAMES[venue] ?? venue;

const STATE_LABELS: Record<string, { label: string; tone: Tone }> = {
  pegged: { label: "Pegged", tone: "green" },
  peg_watch: { label: "Peg watch", tone: "orange" },
  depegged: { label: "Depegged", tone: "red" },
  insufficient_cross_venue_data: { label: "Abstained — fewer than 2 fresh venues", tone: "neutral" },
  upward_momentum: { label: "Upward momentum", tone: "green" },
  downward_momentum: { label: "Downward momentum", tone: "red" },
  range_bound: { label: "Range-bound", tone: "neutral" },
};

export function stateLabel(label: string): { label: string; tone: Tone } {
  return STATE_LABELS[label] ?? { label: label.replace(/_/g, " "), tone: "neutral" };
}

const METRIC_LABELS: Record<string, string> = {
  cross_venue_median_usd_price: "Cross-venue median (USD)",
  peg_deviation_bps: "Peg deviation (bps)",
  fresh_venue_count: "Fresh venues",
  quote_converted_observations: "Stablecoin-quoted observations",
  thirty_second_return_bps: "30s return (bps)",
  window_trade_count: "Trades in window",
};

export const metricLabel = (metric: string) => METRIC_LABELS[metric] ?? metric.replace(/_/g, " ");

const FAILURE_LABELS: Record<string, string> = {
  insufficient_samples: "Too few samples",
  coverage_below_threshold: "Coverage too low",
  accuracy_below_threshold: "Accuracy too low",
  false_alert_rate_above_threshold: "Too many false alerts",
  brier_score_above_threshold: "Brier score too high",
  calibration_error_above_threshold: "Confidence not calibrated",
  latency_above_threshold: "Too slow",
  macro_recall_below_threshold: "Misses too many moves",
};

export const failureLabel = (failure: string) => FAILURE_LABELS[failure] ?? failure.replace(/_/g, " ");

/** Crypto quotes span 1.0001 (stablecoins) to 100,000 (BTC): keep the digits that matter. */
export function formatQuote(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const digits = value < 10 ? 5 : value < 1000 ? 3 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatMs(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
}

export function formatCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

/** "16:59:28.254 UTC" from an ISO timestamp, as sent. */
export function formatClock(iso: string | null | undefined): string {
  const match = /T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?/.exec(iso ?? "");
  return match ? `${match[1]}${match[2] ?? ""} UTC` : "";
}
