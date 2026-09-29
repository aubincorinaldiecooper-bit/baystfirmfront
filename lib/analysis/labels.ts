/**
 * Display labels for backend values. These only name things: numbers are
 * shown as the backend sent them (its `display` strings, or the value as
 * given), never rounded, rescaled or derived here.
 */

import type { AnalysisStatus, Freshness, SourceType, Stance } from "@/lib/api/types";

export type Tone = "green" | "orange" | "red" | "accent" | "neutral";

/** The date part of an ISO 8601 timestamp, as sent (no time-zone conversion). */
export function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : value;
}

/** A number exactly as the backend sent it; `null` stays missing. */
export function verbatim(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const ACRONYMS: Record<string, string> = {
  yoy: "YoY",
  qoq: "QoQ",
  ttm: "TTM",
  ytd: "YTD",
  pe: "P/E",
  ps: "P/S",
  ev: "EV",
  ebitda: "EBITDA",
  fcf: "FCF",
  eps: "EPS",
  cagr: "CAGR",
  ma: "MA",
  bp: "bp",
  pct: "%",
  vs: "vs",
};

/** `revenue_growth_yoy` → "Revenue growth YoY". The raw name stays available as a title. */
export function humanizeName(name: string): string {
  const words = name.split(/[_\s]+/).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (/^\d+[a-z]$/.test(lower)) return lower; /* 1y, 3m, 30d */
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  regulatory_filing: "Regulatory filing",
  exchange_data: "Exchange data",
  investor_relations: "Investor relations",
  financial_statement: "Financial statement",
  earnings_release: "Earnings release",
  earnings_transcript: "Earnings transcript",
  market_data: "Market data",
  financial_journalism: "Financial journalism",
  secondary_commentary: "Secondary commentary",
  unverified_web: "Unverified web",
};

export function sourceTypeLabel(type: string): string {
  return SOURCE_TYPE_LABELS[type as SourceType] ?? humanizeName(type);
}

export function freshnessTone(freshness: Freshness | string): Tone {
  switch (freshness) {
    case "current":
      return "green";
    case "stale":
      return "orange";
    default:
      return "neutral";
  }
}

export function freshnessLabel(freshness: Freshness | string): string {
  switch (freshness) {
    case "current":
      return "Current";
    case "recent":
      return "Recent";
    case "stale":
      return "Stale";
    case "unknown":
      return "Freshness unknown";
    default:
      return freshness;
  }
}

export function stanceTone(stance: Stance | string | null): Tone {
  switch (stance) {
    case "bullish":
      return "green";
    case "bearish":
      return "red";
    case "mixed":
      return "orange";
    default:
      return "neutral";
  }
}

export function stanceLabel(stance: Stance | string | null): string {
  if (!stance) return "Not assessed";
  return stance.charAt(0).toUpperCase() + stance.slice(1);
}

export function statusTone(status: AnalysisStatus | string): Tone {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "cancelled":
      return "orange";
    default:
      return "accent";
  }
}

export function statusLabel(status: AnalysisStatus | string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "resolving_instrument":
    case "resolving":
      return "Identifying";
    case "researching":
      return "Researching";
    case "normalizing":
      return "Normalizing";
    case "scoring":
      return "Scoring";
    case "calculating":
      return "Calculating";
    case "synthesizing":
      return "Synthesizing";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "submitting":
      return "Submitting";
    default:
      return humanizeName(status);
  }
}

const REDISTRIBUTION_LABELS: Record<string, string> = {
  allowed: "Redistribution allowed",
  metadata_only: "Metadata only",
  unknown: "Redistribution terms unknown",
};

export function redistributionLabel(value: string): string {
  return REDISTRIBUTION_LABELS[value] ?? value;
}
