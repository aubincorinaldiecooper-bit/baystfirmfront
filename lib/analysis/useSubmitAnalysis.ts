"use client";

/**
 * `POST /analyses` and its synchronous outcomes.
 *
 * - 202: the analysis exists; `onCreated` navigates to it.
 * - 422 AMBIGUOUS_INSTRUMENT: no analysis was created. The backend's own
 *   candidates are offered; choosing one resubmits the same question with
 *   `instrument: {symbol, exchange}` (schemas/requests.py `InstrumentRef`).
 *   `ticker_required` has nothing to choose from: it is shown as an error that
 *   asks for the ticker once.
 * - anything else: the structured error, with the request kept for a retry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ambiguityCandidates, isAbortError, isAmbiguousInstrument, isApiError, isTickerRequired } from "@/lib/api/client";
import { useApiDeps } from "@/lib/api/deps";
import type { CreateAnalysisRequest, CreateAnalysisResponse, InstrumentCandidate } from "@/lib/api/types";

export type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; request: CreateAnalysisRequest }
  | {
      status: "ambiguous";
      request: CreateAnalysisRequest;
      message: string;
      candidates: InstrumentCandidate[];
    }
  | { status: "error"; request: CreateAnalysisRequest; error: ApiError };

export interface SubmitAnalysis {
  state: SubmitState;
  submit: (request: CreateAnalysisRequest) => void;
  /** Resubmit the pending question for one of the backend's candidates. */
  choose: (candidate: InstrumentCandidate) => void;
  dismiss: () => void;
}

export function instrumentRefFor(candidate: InstrumentCandidate): NonNullable<CreateAnalysisRequest["instrument"]> {
  return candidate.exchange ? { symbol: candidate.symbol, exchange: candidate.exchange } : { symbol: candidate.symbol };
}

export function useSubmitAnalysis(
  onCreated: (response: CreateAnalysisResponse, request: CreateAnalysisRequest) => void,
): SubmitAnalysis {
  const { client } = useApiDeps();
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const submit = useCallback(
    (request: CreateAnalysisRequest) => {
      if (stateRef.current.status === "submitting") return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: "submitting", request });
      client
        .createAnalysis(request, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          setState({ status: "idle" });
          onCreatedRef.current(response, request);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          if (isAmbiguousInstrument(cause) && !isTickerRequired(cause)) {
            setState({ status: "ambiguous", request, message: cause.message, candidates: ambiguityCandidates(cause) });
            return;
          }
          const error = isApiError(cause)
            ? cause
            : new ApiError({ code: "NETWORK_ERROR", message: "The request could not be sent.", retryable: true, httpStatus: 0, cause });
          setState({ status: "error", request, error });
        });
    },
    [client],
  );

  const choose = useCallback(
    (candidate: InstrumentCandidate) => {
      const current = stateRef.current;
      if (current.status !== "ambiguous") return;
      submit({ ...current.request, instrument: instrumentRefFor(candidate) });
    },
    [submit],
  );

  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  return { state, submit, choose, dismiss };
}
