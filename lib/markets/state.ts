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
  classifications: Record<string, Classification>;
  events: number;
}

export function initialMarketsState(): MarketsState {
  return { instruments: {}, ticks: {}, classifications: {}, events: 0 };
}

export const instrumentKey = (venue: string, symbol: string) => `${venue}|${symbol}`;
export const classificationKey = (classifier: string, symbol: string) => `${classifier}|${symbol}`;

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
  const current = state.instruments[key];
  const instruments = isNewer(event, current?.last)
    ? {
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
      }
    : state.instruments;

  let ticks = state.ticks;
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
  return { ...state, instruments, ticks, events: state.events + (streamed ? 1 : 0) };
}

function withClassification(state: MarketsState, item: Classification): MarketsState {
  const key = classificationKey(item.classifier, item.symbol);
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
    return next;
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

export function classificationsFor(state: MarketsState, classifier: string): Classification[] {
  return Object.values(state.classifications)
    .filter((item) => item.classifier === classifier)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}
