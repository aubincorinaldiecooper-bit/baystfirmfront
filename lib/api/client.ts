/**
 * The one typed client for the BayAnalytics API.
 *
 * Every call goes to the same-origin proxy (`/api/bay/...` by default), which
 * adds the backend credential server-side. Components never construct backend
 * URLs or duplicate fetch logic; they call this module. It parses the
 * structured error envelope into `ApiError`, exposes typed results and
 * honours `AbortSignal` for cancellation. It does no orchestration.
 */

import type {
  AnalysisListResponse,
  AnalysisResult,
  CancelAnalysisResponse,
  Capabilities,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  ErrorCode,
  ErrorEnvelope,
  ErrorPayload,
  Health,
  InstrumentCandidate,
  Transcription,
} from "./types";
import { isErrorCode } from "./types";

export const DEFAULT_API_BASE = "/api/bay";

/**
 * Contract codes plus two client-side-only codes: `NETWORK_ERROR` when no
 * response arrived at all and `BAD_RESPONSE` when a 2xx body was not the
 * JSON the contract promises. Neither ever comes from the backend.
 */
export type ApiErrorCode = ErrorCode | "NETWORK_ERROR" | "BAD_RESPONSE";

export interface ApiErrorInit {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown> | null;
  httpStatus: number;
  retryAfterSeconds?: number | null;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | null;
  /** 0 when no HTTP response was received. */
  readonly httpStatus: number;
  /** Parsed from `Retry-After` when the response carried one. */
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "ApiError";
    this.code = init.code;
    this.retryable = init.retryable;
    this.details = init.details ?? null;
    this.httpStatus = init.httpStatus;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** The contract-shaped payload, for reducers and error views. */
  toPayload(): ErrorPayload {
    const code: ErrorCode = isErrorCode(this.code) ? this.code : "INTERNAL_ERROR";
    return { code, message: this.message, retryable: this.retryable, details: this.details };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isAbortError(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    (value as { name?: unknown }).name === "AbortError"
  );
}

export type AmbiguousInstrumentError = ApiError & {
  code: "AMBIGUOUS_INSTRUMENT";
  details: { candidates: InstrumentCandidate[]; reason?: string; symbol?: string };
};

/** Narrow to the synchronous 422 from `POST /analyses` (and its stream twin). */
export function isAmbiguousInstrument(value: unknown): value is AmbiguousInstrumentError {
  if (!isApiError(value) || value.code !== "AMBIGUOUS_INSTRUMENT") return false;
  return Array.isArray(value.details?.candidates);
}

export function ambiguityCandidates(error: AmbiguousInstrumentError): InstrumentCandidate[] {
  return normalizeCandidates(error.details.candidates);
}

/**
 * The backend's candidates as given, symbol-only ones included: a missing
 * name stays empty (the UI shows the symbol), a missing exchange or CIK null.
 * Entries without a symbol are dropped.
 */
export function normalizeCandidates(raw: unknown): InstrumentCandidate[] {
  if (!Array.isArray(raw)) return [];
  const candidates: InstrumentCandidate[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.symbol !== "string" || !c.symbol.trim()) continue;
    candidates.push({
      symbol: c.symbol,
      exchange: typeof c.exchange === "string" && c.exchange ? c.exchange : null,
      name: typeof c.name === "string" ? c.name.trim() : "",
      cik: typeof c.cik === "string" && c.cik ? c.cik : null,
      ...(typeof c.score === "number" ? { score: c.score } : {}),
    });
  }
  return candidates;
}

/** The backend could not tell the company because the question names no ticker. */
export function isTickerRequired(error: { code: string; details?: Record<string, unknown> | null } | null | undefined): boolean {
  return error?.code === "AMBIGUOUS_INSTRUMENT" && error.details?.reason === "ticker_required";
}

/** The prompt shown when the question needs a ticker. */
export const TICKER_PROMPT = "Include the company's ticker, e.g. $AAPL";

/* ── error normalisation ─────────────────────────────────── */

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "TOO_MANY_ANALYSES";
  if (status >= 500) return "INTERNAL_ERROR";
  return "INVALID_REQUEST";
}

export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Turn any non-2xx response into an `ApiError`, reading the envelope when present. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  let body: unknown = null;
  let text = "";
  try {
    text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (isErrorEnvelope(body)) {
    const { error } = body;
    const code: ApiErrorCode = isErrorCode(error.code) ? error.code : fallbackCode(response.status);
    return new ApiError({
      code,
      message: error.message,
      retryable: Boolean(error.retryable),
      details: error.details ?? null,
      httpStatus: response.status,
      retryAfterSeconds,
    });
  }
  const code = fallbackCode(response.status);
  return new ApiError({
    code,
    message: `The API responded with HTTP ${response.status}.`,
    retryable: response.status >= 500 || response.status === 429,
    details: text ? { body: text.slice(0, 200) } : null,
    httpStatus: response.status,
    retryAfterSeconds,
  });
}

/* ── the client ──────────────────────────────────────────── */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BayApiClientOptions {
  /** Proxy base, default `/api/bay`. An absolute URL works too (tests, tooling). */
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch, bound lazily. */
  fetch?: FetchLike;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ListAnalysesParams {
  /** 1..100; the backend default is 50. */
  limit?: number;
  cursor?: string | null;
}

export interface TranscribeOptions extends RequestOptions {
  filename?: string;
}

export class BayApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: BayApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** `POST /analyses` → 202. Throws `ApiError` (422 AMBIGUOUS_INSTRUMENT carries candidates). */
  createAnalysis(body: CreateAnalysisRequest, options: RequestOptions = {}): Promise<CreateAnalysisResponse> {
    return this.json<CreateAnalysisResponse>("POST", "/analyses", { body, signal: options.signal });
  }

  /** `GET /analyses?limit=&cursor=` — history, newest first. */
  listAnalyses(params: ListAnalysesParams = {}, options: RequestOptions = {}): Promise<AnalysisListResponse> {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.cursor) search.set("cursor", params.cursor);
    const query = search.toString();
    return this.json<AnalysisListResponse>("GET", `/analyses${query ? `?${query}` : ""}`, { signal: options.signal });
  }

  /** `GET /analyses/{id}` — the structured result, or the artifacts so far. */
  getAnalysis(analysisId: string, options: RequestOptions = {}): Promise<AnalysisResult> {
    return this.json<AnalysisResult>("GET", `/analyses/${encodeURIComponent(analysisId)}`, { signal: options.signal });
  }

  /** `POST /analyses/{id}/cancel` — best effort; the terminal event is authoritative. */
  cancelAnalysis(analysisId: string, options: RequestOptions = {}): Promise<CancelAnalysisResponse> {
    return this.json<CancelAnalysisResponse>("POST", `/analyses/${encodeURIComponent(analysisId)}/cancel`, {
      signal: options.signal,
    });
  }

  getCapabilities(options: RequestOptions = {}): Promise<Capabilities> {
    return this.json<Capabilities>("GET", "/capabilities", { signal: options.signal });
  }

  getHealth(options: RequestOptions = {}): Promise<Health> {
    return this.json<Health>("GET", "/health", { signal: options.signal });
  }

  /** `POST /transcriptions` with multipart field `audio`. Never starts an analysis. */
  async transcribeAudio(audio: Blob, options: TranscribeOptions = {}): Promise<Transcription> {
    const form = new FormData();
    form.append("audio", audio, options.filename ?? "audio.webm");
    const response = await this.send("/transcriptions", {
      method: "POST",
      body: form,
      headers: { accept: "application/json" },
      signal: options.signal,
    });
    return this.parse<Transcription>(response);
  }

  /** URL of the SSE stream for an analysis, for the SSE client. */
  eventsUrl(analysisId: string, after?: number | null): string {
    const base = `${this.baseUrl}/analyses/${encodeURIComponent(analysisId)}/events`;
    return after !== undefined && after !== null && after > 0 ? `${base}?after=${after}` : base;
  }

  /* ── internals ───────────────────────────────────────── */

  private async json<T>(method: "GET" | "POST", path: string, init: { body?: unknown; signal?: AbortSignal }): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const response = await this.send(path, { method, headers, body, signal: init.signal });
    return this.parse<T>(response);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, credentials: "same-origin" });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new ApiError({
        code: "NETWORK_ERROR",
        message: "The request could not reach the server.",
        retryable: true,
        httpStatus: 0,
        cause,
      });
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (!response.ok) throw await errorFromResponse(response);
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ApiError({
        code: "BAD_RESPONSE",
        message: "The server returned a response that was not valid JSON.",
        retryable: false,
        httpStatus: response.status,
        cause,
      });
    }
  }
}

/** The shared client for the app. Tests construct their own with a stub fetch. */
export const bayApi = new BayApiClient();
