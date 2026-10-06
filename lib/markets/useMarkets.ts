"use client";

/**
 * The Markets page lifecycle: read the snapshot, the evaluation gate and the
 * live and backtest track records once,
 * then fold the live stream in. Stream records are batched per animation
 * frame so a busy tape renders once per frame, not once per trade.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchGate, fetchSignalBacktest, fetchSnapshot, fetchTrackRecord, MarketsError, openMarketsStream, type StreamStatus } from "./client";
import { initialMarketsState, marketsReducer, type MarketsState } from "./state";
import type { Classification, EvaluationGate, MarketEvent, MarketsSnapshot, SignalBacktest, TrackRecord } from "./types";

/** The backend retains a 48-hour window for live scores. */
export const TRACK_RECORD_WINDOW_HOURS = 48;

export interface UseMarketsResult {
  state: MarketsState;
  snapshot: MarketsSnapshot | null;
  snapshotError: MarketsError | null;
  gate: EvaluationGate | null;
  gateError: MarketsError | null;
  trackRecord: TrackRecord | null;
  trackRecordError: MarketsError | null;
  backtest: SignalBacktest | null;
  backtestError: MarketsError | null;
  stream: StreamStatus;
  reload: () => void;
}

function asMarketsError(cause: unknown): MarketsError {
  return cause instanceof MarketsError ? cause : new MarketsError("The crypto backend could not be read.", 0, "BAD_RESPONSE");
}

export function useMarkets(): UseMarketsResult {
  const [state, dispatch] = useReducer(marketsReducer, undefined, initialMarketsState);
  const [snapshot, setSnapshot] = useState<MarketsSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<MarketsError | null>(null);
  const [gate, setGate] = useState<EvaluationGate | null>(null);
  const [gateError, setGateError] = useState<MarketsError | null>(null);
  const [trackRecord, setTrackRecord] = useState<TrackRecord | null>(null);
  const [trackRecordError, setTrackRecordError] = useState<MarketsError | null>(null);
  const [backtest, setBacktest] = useState<SignalBacktest | null>(null);
  const [backtestError, setBacktestError] = useState<MarketsError | null>(null);
  const [stream, setStream] = useState<StreamStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const pending = useRef<{ events: MarketEvent[]; classifications: Classification[] }>({ events: [], classifications: [] });
  const frame = useRef<number | null>(null);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshotError(null);
    setGateError(null);
    setTrackRecordError(null);
    setBacktestError(null);
    fetchSnapshot(undefined, controller.signal)
      .then((value) => {
        setSnapshot(value);
        dispatch({ type: "snapshot", snapshot: value });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setSnapshotError(asMarketsError(cause));
      });
    fetchGate(undefined, controller.signal)
      .then(setGate)
      .catch((cause) => {
        if (!controller.signal.aborted) setGateError(asMarketsError(cause));
      });
    fetchTrackRecord(TRACK_RECORD_WINDOW_HOURS, undefined, controller.signal)
      .then(setTrackRecord)
      .catch((cause) => {
        if (!controller.signal.aborted) setTrackRecordError(asMarketsError(cause));
      });
    fetchSignalBacktest(undefined, controller.signal)
      .then(setBacktest)
      .catch((cause) => {
        if (!controller.signal.aborted) setBacktestError(asMarketsError(cause));
      });

    const flush = () => {
      frame.current = null;
      const batch = pending.current;
      pending.current = { events: [], classifications: [] };
      if (batch.events.length || batch.classifications.length) dispatch({ type: "stream", ...batch });
    };
    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };
    const close = openMarketsStream({
      onEvent: (event) => {
        pending.current.events.push(event);
        schedule();
      },
      onClassification: (item) => {
        pending.current.classifications.push(item);
        schedule();
      },
      onStatus: setStream,
    });
    return () => {
      controller.abort();
      close();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [generation]);

  return { state, snapshot, snapshotError, gate, gateError, trackRecord, trackRecordError, backtest, backtestError, stream, reload };
}
