import { describe, expect, it } from "vitest";
import {
  alertCondition,
  ALERTS_STORAGE_KEY,
  createAlertTracker,
  evaluateAlerts,
  parseAlertRules,
  thresholdValueFromInput,
  type AlertRule,
} from "@/lib/markets/alerts";
import { initialMarketsState, marketsReducer, type MarketsState } from "@/lib/markets/state";
import type { Classification, MarketEvent } from "@/lib/markets/types";

function event(
  venue: string,
  symbol: string,
  eventType: MarketEvent["event_type"],
  second: number,
  fields: Partial<MarketEvent> = {},
): MarketEvent {
  const at = new Date(Date.UTC(2026, 9, 2, 16, 0, second)).toISOString();
  return {
    event_id: `${venue}-${symbol}-${eventType}-${second}`,
    venue,
    symbol,
    native_symbol: symbol,
    base_asset: symbol.split("-")[0],
    quote_asset: symbol.split("-")[1],
    instrument_kind: symbol.endsWith("-PERP") ? "perpetual" : "spot",
    event_type: eventType,
    exchange_timestamp: at,
    received_timestamp: new Date(Date.parse(at) + 45).toISOString(),
    sequence: second,
    price: eventType === "trade" ? 100 : null,
    size: eventType === "trade" ? 1 : null,
    side: "buy",
    bid: null,
    ask: null,
    payload_hash: "fixture",
    metadata: {},
    ...fields,
  };
}

function addEvents(state: MarketsState, events: MarketEvent[], classifications: Classification[] = []): MarketsState {
  return marketsReducer(state, { type: "stream", events, classifications });
}

function peg(label: string, second: number, abstained = false, shadow = true): Classification {
  const at = new Date(Date.UTC(2026, 9, 2, 16, 0, second)).toISOString();
  return {
    classification_id: `USDC-peg-${second}`,
    classifier: "stablecoin_peg",
    classifier_version: "rules-0.2.0",
    symbol: "USDC",
    label,
    probability: 0.875,
    abstained,
    horizon_seconds: 30,
    observed_at: at,
    generated_at: at,
    evidence: [],
    shadow,
    calibration_status: "uncalibrated",
    freshness_ms: 40,
  };
}

const priceRule: AlertRule = {
  id: "price-above-100",
  kind: "threshold",
  metric: "last_price",
  venue: "coinbase",
  symbol: "BTC-USD",
  op: "above",
  value: 100,
  created_at: "2026-10-02T16:00:00.000Z",
};

describe("evaluateAlerts", () => {
  it("drops invalid and duplicate persisted alert rules", () => {
    const invalid = { ...priceRule, id: "invalid", value: Number.NaN };
    expect(parseAlertRules("not json")).toEqual([]);
    expect(parseAlertRules(JSON.stringify([priceRule, invalid, priceRule]))).toEqual([priceRule]);
    expect(ALERTS_STORAGE_KEY).toBe("baystfirm.markets.alerts.v1");
  });

  it("baselines the first observation, fires once on a crossing, then re-arms", () => {
    let state = addEvents(initialMarketsState(), [event("coinbase", "BTC-USD", "trade", 1, { price: 99 })]);
    let result = evaluateAlerts([priceRule], state, createAlertTracker());
    expect(result.firings).toEqual([]);
    let tracker = result.tracker;

    const crossing = event("coinbase", "BTC-USD", "trade", 2, { event_id: "price-cross-1", price: 101 });
    state = addEvents(state, [crossing]);
    result = evaluateAlerts([priceRule], state, tracker);
    expect(result.firings).toMatchObject([
      { rule_id: priceRule.id, at: crossing.exchange_timestamp, observed: 101, source_id: "price-cross-1", shadow: false },
    ]);
    tracker = result.tracker;

    state = addEvents(state, [event("coinbase", "BTC-USD", "trade", 3, { price: 102 })]);
    result = evaluateAlerts([priceRule], state, tracker);
    expect(result.firings).toEqual([]);
    tracker = result.tracker;

    state = addEvents(state, [event("coinbase", "BTC-USD", "trade", 4, { price: 99 })]);
    result = evaluateAlerts([priceRule], state, tracker);
    expect(result.firings).toEqual([]);
    tracker = result.tracker;

    state = addEvents(state, [event("coinbase", "BTC-USD", "trade", 5, { price: 101 })]);
    expect(evaluateAlerts([priceRule], state, tracker).firings).toHaveLength(1);
  });

  it("does not fire without data, and a null observation does not erase a baseline", () => {
    const missing = evaluateAlerts([priceRule], initialMarketsState(), createAlertTracker());
    expect(missing.firings).toEqual([]);
    expect(missing.tracker.conditions).toEqual({});

    const lowState = addEvents(initialMarketsState(), [event("coinbase", "BTC-USD", "trade", 1, { price: 99 })]);
    const baseline = evaluateAlerts([priceRule], lowState, missing.tracker);
    const absent = evaluateAlerts([priceRule], initialMarketsState(), baseline.tracker);
    expect(absent.firings).toEqual([]);
    expect(absent.tracker.conditions[priceRule.id]).toBe(false);

    const highState = addEvents(lowState, [event("coinbase", "BTC-USD", "trade", 2, { price: 101 })]);
    expect(evaluateAlerts([priceRule], highState, absent.tracker).firings).toHaveLength(1);
  });

  it("reads funding from the derivative record and converts entered percentages to fractions", () => {
    expect(thresholdValueFromInput("funding_rate", 0.0125)).toBeCloseTo(0.000125);
    const symbol = "BTC-USDT-PERP";
    const state = addEvents(initialMarketsState(), [
      event("bybit", symbol, "funding", 3, { funding_rate: 0.0002 }),
    ]);
    const rule: AlertRule = {
      ...priceRule,
      id: "funding-above",
      metric: "funding_rate",
      venue: "bybit",
      symbol,
      value: thresholdValueFromInput("funding_rate", 0.01),
    };
    expect(alertCondition(rule, state)).toBe(true);
    const result = evaluateAlerts([rule], state, createAlertTracker());
    expect(result.firings).toEqual([]);
    expect(result.tracker.conditions[rule.id]).toBe(true);
  });

  it("fires on a peg-state crossing, ignores abstained classifications, and includes shadow wording", () => {
    const rule: AlertRule = { id: "usdc-peg", kind: "peg", symbol: "USDC", created_at: "2026-10-02T16:00:00Z" };
    let state = addEvents(initialMarketsState(), [], [peg("pegged", 1)]);
    let result = evaluateAlerts([rule], state, createAlertTracker());
    expect(result.firings).toEqual([]);
    let tracker = result.tracker;

    state = addEvents(state, [], [peg("peg_watch", 2, true)]);
    result = evaluateAlerts([rule], state, tracker);
    expect(result.firings).toEqual([]);
    tracker = result.tracker;

    const crossing = peg("peg_watch", 3, false, true);
    state = addEvents(state, [], [crossing]);
    result = evaluateAlerts([rule], state, tracker);
    expect(result.firings).toHaveLength(1);
    expect(result.firings[0]).toMatchObject({
      at: crossing.observed_at,
      source_id: crossing.classification_id,
      observed: "peg_watch · 87.5%",
      shadow: true,
    });
    expect(result.firings[0].message).toContain("peg_watch");
    expect(result.firings[0].message).toContain("87.5%");
    expect(result.firings[0].message).toContain("Shadow, not validated");
  });

  it("baselines existing liquidations, deduplicates new events, and applies the OKX multiplier", () => {
    const symbol = "BTC-USDT-PERP";
    const multiplier = event("okx", symbol, "open_interest", 1, {
      open_interest: 10,
      metadata: { contract_multiplier: 0.1 },
    });
    const existing = event("okx", symbol, "liquidation", 2, {
      event_id: "existing-liquidation",
      price: 100,
      size: 5,
    });
    let state = addEvents(initialMarketsState(), [multiplier, existing]);
    const rule: AlertRule = {
      id: "okx-liquidation",
      kind: "liquidation",
      venue: "okx",
      symbol,
      min_notional_usd: 10,
      created_at: "2026-10-02T16:00:00Z",
    };
    let result = evaluateAlerts([rule], state, createAlertTracker());
    expect(result.firings).toEqual([]);
    let tracker = result.tracker;

    const next = event("okx", symbol, "liquidation", 3, {
      event_id: "new-liquidation",
      price: 100,
      size: 3,
    });
    state = addEvents(state, [next]);
    result = evaluateAlerts([rule], state, tracker);
    expect(result.firings).toMatchObject([
      { source_id: "new-liquidation", observed: 30, at: next.exchange_timestamp },
    ]);
    tracker = result.tracker;

    expect(evaluateAlerts([rule], state, tracker).firings).toEqual([]);
  });
});
