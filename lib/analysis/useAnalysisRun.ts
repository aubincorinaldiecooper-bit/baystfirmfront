"use client";

/**
 * One analysis page's lifecycle, driven by the backend only.
 *
 * Opening `/analyses/{id}` (first visit, history link or a reload mid-run)
 * always takes the same path:
 *
 *   1. `GET /analyses/{id}`. A terminal job is rendered from its durable
 *      result; nothing is streamed.
 *   2. Otherwise the page attaches to the job and opens the event stream from
 *      the beginning. The backend replays every recorded event and then
 *      follows live ones, so a reload rebuilds exactly the state the page had
 *      (the reducer drops duplicates by seq).
 *   3. On the terminal event the structured result is read once more with
 *      `GET /analyses/{id}` (the backend persists it before the event).
 *
 * A dropped connection is retried by the transport with `Last-Event-ID`. If
 * it cannot be recovered the page reads the durable state, marks the stream
 * as lost and reconnects from the last seq on demand or when the browser
 * reports it is back online. No timer drives anything here.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError, isAbortError, isApiError } from "@/lib/api/client";
import { useApiDeps } from "@/lib/api/deps";
import type { AnalysisStreamHandle } from "@/lib/api/sse";
import type { AnalysisResult } from "@/lib/api/types";
import { isTerminalStatus } from "@/lib/api/types";
import { analysisReducer, initialAnalysisState, isTerminalUiStatus, type AnalysisViewState } from "./reducer";

export type LoadStatus = "loading" | "ready" | "not_found" | "error";
export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "lost" | "closed";
export type ResultStatus = "idle" | "loading" | "ready" | "error";

export interface AnalysisRun {
  state: AnalysisViewState;
  load: LoadStatus;
  loadError: ApiError | null;
  connection: ConnectionStatus;
  resultStatus: ResultStatus;
  resultError: ApiError | null;
  cancelling: boolean;
  cancelError: ApiError | null;
  cancel: () => void;
  /** Reopen the stream from the last applied seq. */
  reconnect: () => void;
  /** Start over: read the job again and re-attach. */
  retryLoad: () => void;
  /** Read the structured result again. */
  reloadResult: () => void;
}

export interface AnalysisRunOptions {
  /**
   * Called once when the analysis reaches a terminal state. `live` is true when
   * it happened while this page watched (stream or fallback), false when the
   * page opened an analysis that had already finished.
   */
  onSettled?: (analysisId: string, live: boolean) => void;
}

function toApiError(cause: unknown, message: string): ApiError {
  return isApiError(cause)
    ? cause
    : new ApiError({ code: "NETWORK_ERROR", message, retryable: true, httpStatus: 0, cause });
}

export function useAnalysisRun(analysisId: string, options: AnalysisRunOptions = {}): AnalysisRun {
  const { client, openStream } = useApiDeps();
  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState);
  const [load, setLoad] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("idle");
  const [resultStatus, setResultStatus] = useState<ResultStatus>("idle");
  const [resultError, setResultError] = useState<ApiError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<ApiError | null>(null);
  const [generation, setGeneration] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const handleRef = useRef<AnalysisStreamHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onSettledRef = useRef(options.onSettled);
  onSettledRef.current = options.onSettled;
  const settledRef = useRef(false);

  const settle = useCallback(
    (live: boolean) => {
      if (settledRef.current) return;
      settledRef.current = true;
      onSettledRef.current?.(analysisId, live);
    },
    [analysisId],
  );

  const fetchResult = useCallback(
    async (signal: AbortSignal): Promise<AnalysisResult | null> => {
      setResultStatus("loading");
      setResultError(null);
      try {
        const result = await client.getAnalysis(analysisId, { signal });
        if (signal.aborted) return null;
        dispatch({ type: "result", result });
        if (isTerminalStatus(result.status)) {
          setResultStatus("ready");
          settle(true);
        } else {
          setResultStatus("idle");
        }
        return result;
      } catch (cause) {
        if (signal.aborted || isAbortError(cause)) return null;
        setResultError(toApiError(cause, "Could not load the analysis result."));
        setResultStatus("error");
        return null;
      }
    },
    [analysisId, client, settle],
  );

  const openFrom = useCallback(
    (after: number | null, signal: AbortSignal) => {
      handleRef.current?.close();
      setConnection("connecting");
      handleRef.current = openStream(
        analysisId,
        {
          onOpen: () => {
            setConnection("open");
            dispatch({ type: "stream_resumed" });
          },
          onEvent: (event) => dispatch({ type: "event", event }),
          onReconnecting: () => setConnection("reconnecting"),
          onTerminal: () => {
            setConnection("closed");
            void fetchResult(signal);
          },
          onFallback: () => {
            setConnection("lost");
            dispatch({ type: "stream_fallback" });
            void fetchResult(signal).then((result) => {
              if (result && isTerminalStatus(result.status)) setConnection("closed");
            });
          },
        },
        { after, signal },
      );
    },
    [analysisId, fetchResult, openStream],
  );

  /* 1–2: read the job, then either render its result or attach to its stream */
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    settledRef.current = false;
    dispatch({ type: "reset" });
    setLoad("loading");
    setLoadError(null);
    setConnection("idle");
    setResultStatus("idle");
    setResultError(null);
    setCancelling(false);
    setCancelError(null);

    client
      .getAnalysis(analysisId, { signal: controller.signal })
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "attach", snapshot });
        setLoad("ready");
        if (isTerminalStatus(snapshot.status)) {
          dispatch({ type: "result", result: snapshot });
          setResultStatus("ready");
          settle(false);
          return;
        }
        openFrom(null, controller.signal);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) return;
        const error = toApiError(cause, "Could not load the analysis.");
        setLoadError(error);
        setLoad(error.code === "NOT_FOUND" ? "not_found" : "error");
      });

    return () => {
      controller.abort();
      handleRef.current?.close();
      handleRef.current = null;
    };
  }, [analysisId, client, generation, openFrom, settle]);

  const reconnect = useCallback(() => {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    if (isTerminalUiStatus(stateRef.current.status)) return;
    const after = stateRef.current.lastSeq > 0 ? stateRef.current.lastSeq : null;
    openFrom(after, controller.signal);
  }, [openFrom]);

  /* the browser says the network is back: resume a stream that gave up */
  useEffect(() => {
    const onOnline = () => {
      if (connectionRef.current === "lost") reconnect();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [reconnect]);

  const cancel = useCallback(() => {
    const current = stateRef.current;
    if (!current.analysisId || isTerminalUiStatus(current.status) || current.cancelRequested) return;
    setCancelling(true);
    setCancelError(null);
    client
      .cancelAnalysis(analysisId)
      .then((response) => {
        if (response.cancel_requested) dispatch({ type: "cancel_requested" });
        /* the terminal event decides; a stream that gave up is reopened to receive it */
        if (connectionRef.current === "lost") reconnect();
      })
      .catch((cause: unknown) => setCancelError(toApiError(cause, "Could not cancel the analysis.")))
      .finally(() => setCancelling(false));
  }, [analysisId, client, reconnect]);

  const retryLoad = useCallback(() => setGeneration((n) => n + 1), []);

  const reloadResult = useCallback(() => {
    const controller = abortRef.current;
    if (controller && !controller.signal.aborted) void fetchResult(controller.signal);
  }, [fetchResult]);

  return {
    state,
    load,
    loadError,
    connection,
    resultStatus,
    resultError,
    cancelling,
    cancelError,
    cancel,
    reconnect,
    retryLoad,
    reloadResult,
  };
}
