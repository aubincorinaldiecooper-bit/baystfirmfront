/**
 * Pure state for the Markets page: the snapshot and every streamed event or
 * classification folded into per-instrument rows, a bounded tick history per
 * instrument for the live chart, and the latest classification per
 * classifier and instrument. Every value comes from a backend record.
 */

import type { Classification, MarketEvent, MarketsSnapshot } from "./types";

/** Ticks kept per instrument for the live chart. */
export const MAX_TICKS = 900;

export interface Tick {
  /** Exchange time in epoch seconds. */
  time: number;
  value: number;
}

export interface InstrumentRow {
  key: string;
  venue: string;
  symbol: string;
  kind: string;
  last: MarketEvent;
  /** Exchange → backend receive delay of the last event. */
  latencyMs: number | null;
  /** Events received for this row since the page opened. */
  streamed: number;
}

export interface MarketsState {
  instruments: Record<string, InstrumentRow>;
  ticks: Record<string, Tick[]>;
  quotes: Record<string, MarketEvent>;
  derivatives: Record<string, DerivativeState>;
  liquidations: MarketEvent[];
  classifications: Record<string, Classification>;
  events: number;
  snapshotLoaded: boolean;
}

export type DerivativeField =
  | "funding_rate"
  | "next_funding_at"
  | "open_interest"
  | "open_interest_value"
  | "mark_price"
  | "index_price"
  | "contract_multiplier";

export interface DerivativeState {
  key: string;
  venue: string;
  symbol: string;
  kind: string;
  funding_rate: number | null;
  next_funding_at: string | null;
  open_interest: number | null;
  open_interest_value: number | null;
  mark_price: number | null;
  index_price: number | null;
  contract_multiplier: number | null;
  field_timestamps: Partial<Record<DerivativeField, string>>;
  field_event_ids: Partial<Record<DerivativeField, string>>;
}

export function initialMarketsState(): MarketsState {
  return {
    instruments: {},
    ticks: {},
    quotes: {},
    derivatives: {},
    liquidations: [],
    classifications: {},
    events: 0,
    snapshotLoaded: false,
  };
}

export const instrumentKey = (venue: string, symbol: string) => `${venue}|${symbol}`;
/** Classifiers that publish one state per horizon (backend `MULTI_HORIZON`). */
export const MULTI_HORIZON_CLASSIFIERS = new Set(["momentum_regime"]);
export const classificationKey = (classifier: string, symbol: string, horizonSeconds?: number) =>
  MULTI_HORIZON_CLASSIFIERS.has(classifier) ? `${classifier}|${symbol}|${horizonSeconds}` : `${classifier}|${symbol}`;

function epochMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function latencyMs(event: MarketEvent): number | null {
  const sent = epochMs(event.exchange_timestamp);
  const received = epochMs(event.received_timestamp);
  return sent === null || received === null ? null : Math.max(0, received - sent);
}

function isNewer(next: MarketEvent, current: MarketEvent | undefined): boolean {
  if (!current) return true;
  return (epochMs(next.exchange_timestamp) ?? 0) >= (epochMs(current.exchange_timestamp) ?? 0);
}

function withEvent(state: MarketsState, event: MarketEvent, streamed: boolean): MarketsState {
  const key = instrumentKey(event.venue, event.symbol);
  let instruments = state.instruments;
  let ticks = state.ticks;
  if (event.event_type === "trade") {
    const current = state.instruments[key];
    if (!current || isNewer(event, current.last)) {
      instruments = {
        ...state.instruments,
        [key]: {
          key,
          venue: event.venue,
          symbol: event.symbol,
          kind: event.instrument_kind,
          last: event,
          latencyMs: latencyMs(event),
          streamed: (current?.streamed ?? 0) + (streamed ? 1 : 0),
        },
      };
    } else if (streamed) {
      instruments = {
        ...state.instruments,
        [key]: { ...current, streamed: current.streamed + 1 },
      };
    }

    const sent = epochMs(event.exchange_timestamp);
    if (typeof event.price === "number" && Number.isFinite(event.price) && event.price > 0 && sent !== null) {
      const series = state.ticks[key] ?? [];
      const time = sent / 1000;
      const last = series[series.length - 1];
      if (!last || time >= last.time) {
        const next = [...series, { time, value: event.price }];
        ticks = { ...state.ticks, [key]: next.length > MAX_TICKS ? next.slice(next.length - MAX_TICKS) : next };
      }
    }
  }

  let quotes = state.quotes;
  if (event.event_type === "book" || event.event_type === "quote") {
    if (isNewer(event, state.quotes[key])) quotes = { ...state.quotes, [key]: event };
  }

  let derivatives = state.derivatives;
  if (event.event_type === "funding" || event.event_type === "open_interest") {
    const current = state.derivatives[key] ?? {
      key,
      venue: event.venue,
      symbol: event.symbol,
      kind: event.instrument_kind,
      funding_rate: null,
      next_funding_at: null,
      open_interest: null,
      open_interest_value: null,
      mark_price: null,
      index_price: null,
      contract_multiplier: null,
      field_timestamps: {},
      field_event_ids: {},
    };
    const updated: DerivativeState = {
      ...current,
      field_timestamps: { ...current.field_timestamps },
      field_event_ids: { ...current.field_event_ids },
    };
    const fields: DerivativeField[] =
      event.event_type === "funding"
        ? ["funding_rate", "next_funding_at", "mark_price", "index_price"]
        : ["open_interest", "open_interest_value", "contract_multiplier"];
    for (const field of fields) {
      const value =
        field === "contract_multiplier"
          ? event.metadata.contract_multiplier
          : event[field];
      if (typeof value !== "number" && typeof value !== "string") continue;
      const timestamp = updated.field_timestamps[field];
      if (timestamp && (epochMs(event.exchange_timestamp) ?? 0) < (epochMs(timestamp) ?? 0)) continue;
      if (field === "contract_multiplier" && typeof value !== "number") continue;
      if (field === "next_funding_at" && typeof value !== "string") continue;
      if (field !== "next_funding_at" && typeof value !== "number") continue;
      Object.assign(updated, { [field]: value });
      updated.field_timestamps[field] = event.exchange_timestamp;
      updated.field_event_ids[field] = event.event_id;
    }
    derivatives = { ...state.derivatives, [key]: updated };
  }

  let liquidations = state.liquidations;
  if (event.event_type === "liquidation") {
    liquidations = [...state.liquidations, event]
      .sort((a, b) => (epochMs(b.exchange_timestamp) ?? 0) - (epochMs(a.exchange_timestamp) ?? 0))
      .slice(0, 50);
  }

  return {
    ...state,
    instruments,
    ticks,
    quotes,
    derivatives,
    liquidations,
    events: state.events + (streamed ? 1 : 0),
  };
}

function withClassification(state: MarketsState, item: Classification): MarketsState {
  const key = classificationKey(item.classifier, item.symbol, item.horizon_seconds);
  const current = state.classifications[key];
  if (current && (epochMs(current.observed_at) ?? 0) > (epochMs(item.observed_at) ?? 0)) return state;
  return { ...state, classifications: { ...state.classifications, [key]: item } };
}

export type MarketsAction =
  | { type: "snapshot"; snapshot: MarketsSnapshot }
  | { type: "stream"; events: MarketEvent[]; classifications: Classification[] };

export function marketsReducer(state: MarketsState, action: MarketsAction): MarketsState {
  let next = state;
  if (action.type === "snapshot") {
    for (const event of action.snapshot.latest_events) next = withEvent(next, event, false);
    for (const item of action.snapshot.latest_classifications) next = withClassification(next, item);
    return { ...next, snapshotLoaded: true };
  }
  for (const event of action.events) next = withEvent(next, event, true);
  for (const item of action.classifications) next = withClassification(next, item);
  return next;
}

/** Rows ordered by instrument, then venue. */
export function instrumentRows(state: MarketsState): InstrumentRow[] {
  return Object.values(state.instruments).sort((a, b) =>
    a.symbol === b.symbol ? a.venue.localeCompare(b.venue) : a.symbol.localeCompare(b.symbol),
  );
}

export function classificationsFor(state: MarketsState, classifier: string, horizonSeconds?: number): Classification[] {
  return Object.values(state.classifications)
    .filter((item) => item.classifier === classifier && (horizonSeconds === undefined || item.horizon_seconds === horizonSeconds))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}
