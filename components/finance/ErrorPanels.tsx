"use client";

/* Structured errors, as the backend reports them: the code, the user-safe
 * message and whether a retry can help. Request errors come from the API
 * (ApiError); analysis errors come from `analysis.failed` / the result. */

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { isTickerRequired, normalizeCandidates, TICKER_PROMPT, type ApiError } from "@/lib/api/client";
import type { ErrorPayload, InstrumentCandidate } from "@/lib/api/types";
import CandidatePicker from "./CandidatePicker";
import { Notice } from "./ui";

function requestErrorTitle(error: ApiError): string {
  if (isTickerRequired(error)) return `${TICKER_PROMPT}.`;
  switch (error.code) {
    case "NETWORK_ERROR":
      return "The analysis backend can't be reached.";
    case "TOO_MANY_ANALYSES":
      return "The backend is busy with other analyses.";
    case "FAST_PROFILE_UNAVAILABLE":
    case "DEEP_PROFILE_UNAVAILABLE":
    case "MEMORY_PRESSURE":
    case "SPARK_START_FAILED":
      return "This analysis profile isn't available right now.";
    case "INVALID_REQUEST":
      return "The request was not accepted.";
    case "UNAUTHORIZED":
      return "The backend refused the request.";
    case "NOT_FOUND":
      return "Not found.";
    default:
      return error.details?.reason === "upstream_unreachable"
        ? "The analysis backend can't be reached."
        : "The backend reported an error.";
  }
}

function validationMessages(error: ApiError): string[] {
  const errors = error.details?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((item) => (typeof item === "object" && item !== null ? (item as { msg?: unknown }).msg : null))
    .filter((msg): msg is string => typeof msg === "string");
}

function ErrorCode({ code, httpStatus }: { code: string; httpStatus?: number }) {
  return (
    <p className="mt-1 font-mono text-[11.5px] text-ink-3">
      {code}
      {httpStatus ? ` · HTTP ${httpStatus}` : ""}
    </p>
  );
}

export function RequestErrorPanel({
  error,
  onRetry,
  busy = false,
}: {
  error: ApiError;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const messages = validationMessages(error);
  const reason =
    typeof error.details?.reason === "string" && error.details.reason !== "upstream_unreachable" && !isTickerRequired(error)
      ? error.details.reason
      : null;
  return (
    <Notice
      kind="error"
      role="alert"
      title={requestErrorTitle(error)}
      actions={
        error.retryable && onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy}>
            <RefreshCw size={12} aria-hidden />
            Try again
          </Button>
        ) : undefined
      }
    >
      {/* the title already asks for the ticker: the backend's message says the same */}
      {!isTickerRequired(error) && <p>{error.message}</p>}
      {reason && <p className="mt-0.5">{reason}</p>}
      {messages.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {messages.map((msg, index) => (
            <li key={index}>{msg}</li>
          ))}
        </ul>
      )}
      {error.retryAfterSeconds !== null && (
        <p className="mt-1">The backend asked to wait {error.retryAfterSeconds} s before trying again.</p>
      )}
      <ErrorCode code={error.code} httpStatus={error.httpStatus} />
    </Notice>
  );
}

function candidatesOf(error: ErrorPayload): InstrumentCandidate[] | null {
  const raw = error.details?.candidates;
  return Array.isArray(raw) ? normalizeCandidates(raw) : null;
}

export function AnalysisErrorPanel({
  error,
  status,
  preserved,
  onRetry,
  onChoose,
  busy = false,
}: {
  error: ErrorPayload;
  status: "failed" | "cancelled";
  /** The backend kept some content (partial) and there is something to show. */
  preserved: boolean;
  onRetry?: () => void;
  onChoose?: (candidate: InstrumentCandidate) => void;
  busy?: boolean;
}) {
  if (isTickerRequired(error)) {
    /* one sentence: the backend's message asks for the ticker too, so it is not repeated */
    return (
      <Notice kind="warn" role="alert" title={`${TICKER_PROMPT}.`}>
        <ErrorCode code={error.code} />
      </Notice>
    );
  }
  const candidates = error.code === "AMBIGUOUS_INSTRUMENT" ? candidatesOf(error) : null;
  if (candidates && onChoose) {
    return <CandidatePicker message={error.message} candidates={candidates} onChoose={onChoose} busy={busy} />;
  }
  const cancelled = status === "cancelled";
  return (
    <Notice
      kind={cancelled ? "warn" : "error"}
      role={cancelled ? "status" : "alert"}
      title={cancelled ? "Analysis cancelled" : "Analysis failed"}
      actions={
        error.retryable && onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy}>
            <RefreshCw size={12} aria-hidden />
            Run it again
          </Button>
        ) : undefined
      }
    >
      <p>{error.message}</p>
      {preserved && <p className="mt-1">What was recorded before it stopped is shown below. It is incomplete.</p>}
      <ErrorCode code={error.code} />
    </Notice>
  );
}
