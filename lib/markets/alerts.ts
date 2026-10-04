import { venueLabel, formatQuote } from "./labels";
import { liquidationNotionalUsd } from "./notional";
import { spreadBps } from "./metrics";
import { classificationKey, instrumentKey, type MarketsState } from "./state";
import type { Classification, MarketEvent } from "./types";

export const ALERTS_STORAGE_KEY = "baystfirm.markets.alerts.v1";

export type AlertMetric = "last_price" | "spread_bps" | "funding_rate";

export type AlertRule =
  | {
      id: string;
      kind: "threshold";
      metric: AlertMetric;
      venue: string;
      symbol: string;
      op: "above" | "below";
      value: number;
      created_at: string;
    }
  | { id: string; kind: "peg"; symbol: string; created_at: string }
  | {
      id: string;
      kind: "liquidation";
      venue: string;
      symbol: string;
      min_notional_usd: number;
      created_at: string;
    };

export interface AlertFiring {
  rule_id: string;
  at: string;
  message: string;
  observed: number | string;
  source_id: string;
  shadow: boolean;
}

export interface AlertTracker {
  conditions: Record<string, boolean>;
  liquidation_baselined: Record<string, boolean>;
  seen_liquidations: Record<string, string[]>;
}

interface AlertObservation {
  condition: boolean | null;
  observed: number | string | null;
  at: string | null;
  source_id: string | null;
  classification?: Classification;
}

export function createAlertTracker(): AlertTracker {
  return { conditions: {}, liquidation_baselined: {}, seen_liquidations: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCreatedAt(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function isAlertRule(value: unknown): value is AlertRule {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isValidCreatedAt(value.created_at)) return false;
  if (value.kind === "peg") return isNonEmptyString(value.symbol);
  if (value.kind === "threshold") {
    return (
      (value.metric === "last_price" || value.metric === "spread_bps" || value.metric === "funding_rate") &&
      isNonEmptyString(value.venue) &&
      isNonEmptyString(value.symbol) &&
      (value.op === "above" || value.op === "below") &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)
    );
  }
  return (
    value.kind === "liquidation" &&
    isNonEmptyString(value.venue) &&
    isNonEmptyString(value.symbol) &&
    typeof value.min_notional_usd === "number" &&
    Number.isFinite(value.min_notional_usd) &&
    value.min_notional_usd >= 0
  );
}

export function parseAlertRules(raw: string | null): AlertRule[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed.filter((candidate): candidate is AlertRule => {
      if (!isAlertRule(candidate) || ids.has(candidate.id)) return false;
      ids.add(candidate.id);
      return true;
    });
  } catch {
    return [];
  }
}

export function thresholdValueFromInput(metric: AlertMetric, value: number): number {
  return metric === "funding_rate" ? value / 100 : value;
}

function missingObservation(): AlertObservation {
  return { condition: null, observed: null, at: null, source_id: null };
}

function conditionFor(value: number, op: "above" | "below", threshold: number): boolean {
  return op === "above" ? value > threshold : value < threshold;
}

function thresholdObservation(rule: Extract<AlertRule, { kind: "threshold" }>, state: MarketsState): AlertObservation {
  const key = instrumentKey(rule.venue, rule.symbol);
  let value: number | null = null;
  let at: string | null = null;
  let sourceId: string | null = null;

  if (rule.metric === "last_price") {
    const event = state.instruments[key]?.last;
    if (typeof event?.price === "number" && Number.isFinite(event.price)) {
      value = event.price;
      at = event.exchange_timestamp;
      sourceId = event.event_id;
    }
  } else if (rule.metric === "spread_bps") {
    const event = state.quotes[key];
    const spread = event ? spreadBps(event.bid, event.ask) : null;
    if (spread !== null && Number.isFinite(spread)) {
      value = spread;
      at = event.exchange_timestamp;
      sourceId = event.event_id;
    }
  } else {
    const derivative = state.derivatives[key];
    const rate = derivative?.funding_rate;
    const timestamp = derivative?.field_timestamps.funding_rate;
    const eventId = derivative?.field_event_ids.funding_rate;
    if (typeof rate === "number" && Number.isFinite(rate) && timestamp && eventId) {
      value = rate;
      at = timestamp;
      sourceId = eventId;
    }
  }

  if (value === null || at === null || sourceId === null) return missingObservation();
  return {
    condition: conditionFor(value, rule.op, rule.value),
    observed: value,
    at,
    source_id: sourceId,
  };
}

function pegObservation(rule: Extract<AlertRule, { kind: "peg" }>, state: MarketsState): AlertObservation {
  const classification = state.classifications[classificationKey("stablecoin_peg", rule.symbol)];
  if (!classification) return missingObservation();
  const probability = Number.isFinite(classification.probability) ? `${(classification.probability * 100).toFixed(1)}%` : "unknown";
  return {
    condition: !classification.abstained && (classification.label === "peg_watch" || classification.label === "depegged"),
    observed: `${classification.label} · ${probability}`,
    at: classification.observed_at,
    source_id: classification.classification_id,
    classification,
  };
}

function observationFor(rule: Exclude<AlertRule, { kind: "liquidation" }>, state: MarketsState): AlertObservation {
  return rule.kind === "threshold" ? thresholdObservation(rule, state) : pegObservation(rule, state);
}

export function alertCondition(rule: AlertRule, state: MarketsState, ready = true): boolean | null {
  if (rule.kind === "liquidation") {
    return ready || state.events > 0 || state.liquidations.length > 0 ? false : null;
  }
  return observationFor(rule, state).condition;
}

function formatThreshold(metric: AlertMetric, value: number): string {
  if (metric === "funding_rate") return `${(value * 100).toFixed(4)}%`;
  if (metric === "spread_bps") return `${value.toFixed(2)} bps`;
  return formatQuote(value);
}

function thresholdFiring(
  rule: Extract<AlertRule, { kind: "threshold" }>,
  observation: AlertObservation,
): AlertFiring | null {
  if (observation.condition !== true || observation.observed === null || !observation.at || !observation.source_id) return null;
  const metricName =
    rule.metric === "last_price" ? "last price" : rule.metric === "spread_bps" ? "spread" : "funding rate";
  return {
    rule_id: rule.id,
    at: observation.at,
    message: `${rule.symbol} on ${venueLabel(rule.venue)} ${metricName} crossed ${rule.op} ${formatThreshold(rule.metric, rule.value)}.`,
    observed: observation.observed,
    source_id: observation.source_id,
    shadow: false,
  };
}

function pegFiring(rule: Extract<AlertRule, { kind: "peg" }>, observation: AlertObservation): AlertFiring | null {
  const classification = observation.classification;
  if (observation.condition !== true || !classification || !observation.at || !observation.source_id) return null;
  const probability = Number.isFinite(classification.probability) ? `${(classification.probability * 100).toFixed(1)}%` : "unknown";
  const shadowNote = classification.shadow ? " Shadow, not validated." : "";
  return {
    rule_id: rule.id,
    at: observation.at,
    message: `${rule.symbol} peg state: ${classification.label} at ${probability} probability.${shadowNote}`,
    observed: `${classification.label} · ${probability}`,
    source_id: observation.source_id,
    shadow: classification.shadow,
  };
}

function liquidationFiring(rule: Extract<AlertRule, { kind: "liquidation" }>, event: MarketEvent, notional: number): AlertFiring {
  return {
    rule_id: rule.id,
    at: event.exchange_timestamp,
    message: `${venueLabel(rule.venue)} ${rule.symbol} liquidation reached $${notional.toLocaleString("en-US", { maximumFractionDigits: 2 })} notional.`,
    observed: notional,
    source_id: event.event_id,
    shadow: false,
  };
}

export function evaluateAlerts(
  rules: AlertRule[],
  state: MarketsState,
  tracker: AlertTracker,
): { tracker: AlertTracker; firings: AlertFiring[] } {
  const nextTracker: AlertTracker = {
    conditions: { ...tracker.conditions },
    liquidation_baselined: { ...tracker.liquidation_baselined },
    seen_liquidations: { ...tracker.seen_liquidations },
  };
  const firings: AlertFiring[] = [];

  for (const rule of rules) {
    if (rule.kind !== "liquidation") {
      const observation = observationFor(rule, state);
      if (observation.condition === null) continue;
      const previous = nextTracker.conditions[rule.id];
      if (previous === false && observation.condition === true) {
        const firing =
          rule.kind === "threshold" ? thresholdFiring(rule, observation) : pegFiring(rule, observation);
        if (firing) firings.push(firing);
      }
      nextTracker.conditions[rule.id] = observation.condition;
      continue;
    }

    const seen = new Set(nextTracker.seen_liquidations[rule.id] ?? []);
    const matching = state.liquidations.filter((event) => event.venue === rule.venue && event.symbol === rule.symbol);
    if (!nextTracker.liquidation_baselined[rule.id]) {
      for (const event of matching) seen.add(event.event_id);
      nextTracker.liquidation_baselined[rule.id] = true;
      nextTracker.seen_liquidations[rule.id] = Array.from(seen);
      continue;
    }

    for (const event of matching) {
      if (seen.has(event.event_id)) continue;
      seen.add(event.event_id);
      const notional = liquidationNotionalUsd(event, state.derivatives);
      if (notional !== null && notional >= rule.min_notional_usd) {
        firings.push(liquidationFiring(rule, event, notional));
      }
    }
    nextTracker.seen_liquidations[rule.id] = Array.from(seen);
  }

  firings.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return { tracker: nextTracker, firings };
}
