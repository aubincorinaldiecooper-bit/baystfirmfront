"use client";

/**
 * The Markets page lifecycle: read the snapshot and the evaluation gate once,
 * then fold the live stream in. Stream records are batched per animation
 * frame so a busy tape renders once per frame, not once per trade.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchGate, fetchSnapshot, MarketsError, openMarketsStream, type StreamStatus } from "./client";
import { initialMarketsState, marketsReducer, type MarketsState } from "./state";
import type { Classification, EvaluationGate, MarketEvent, MarketsSnapshot } from "./types";

export interface UseMarketsResult {
  state: MarketsState;
  snapshot: MarketsSnapshot | null;
  snapshotError: MarketsError | null;
  gate: EvaluationGate | null;
  gateError: MarketsError | null;
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
  const [stream, setStream] = useState<StreamStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const pending = useRef<{ events: MarketEvent[]; classifications: Classification[] }>({ events: [], classifications: [] });
  const frame = useRef<number | null>(null);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshotError(null);
    setGateError(null);
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

  return { state, snapshot, snapshotError, gate, gateError, stream, reload };
}
