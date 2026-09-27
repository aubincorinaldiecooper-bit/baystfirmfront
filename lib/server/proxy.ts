import "server-only";

/**
 * The proxy boundary: Browser → Next.js route handler → BayAnalytics API.
 *
 * The browser only ever talks to `/api/bay/*`. This module forwards allowed
 * requests to `BAY_API_URL`, attaching `Authorization: Bearer <BAY_API_KEY>`
 * server-side when a key is configured, and passes the upstream status,
 * headers and body back untouched. Nothing is re-serialised: JSON bodies and
 * the SSE stream are relayed as the byte streams the backend produced.
 *
 * The session seam (`getServerSession`) is consulted on every request. Today
 * every session is anonymous and nothing is gated; see docs/AUTH.md.
 */

import { getServerSession, type Session } from "@/lib/auth/session";
import type { ErrorEnvelope, ErrorPayload } from "@/lib/api/types";
import { readBayServerConfig, type BayServerConfig } from "./env";

/** Backend limits (api/limits.py): JSON bodies and audio uploads. */
export const JSON_BODY_LIMIT = 64 * 1024;
export const AUDIO_BODY_LIMIT = 25 * 1024 * 1024;

type Method = "GET" | "POST";

interface UpstreamRoute {
  method: Method;
  pattern: RegExp;
  bodyLimit: number | null;
}

/** The contract routes the proxy relays. Anything else is 404, never forwarded. */
const ROUTES: readonly UpstreamRoute[] = [
  { method: "GET", pattern: /^health$/, bodyLimit: null },
  { method: "GET", pattern: /^capabilities$/, bodyLimit: null },
  { method: "GET", pattern: /^analyses$/, bodyLimit: null },
  { method: "POST", pattern: /^analyses$/, bodyLimit: JSON_BODY_LIMIT },
  { method: "GET", pattern: /^analyses\/[A-Za-z0-9_-]+$/, bodyLimit: null },
  { method: "POST", pattern: /^analyses\/[A-Za-z0-9_-]+\/cancel$/, bodyLimit: JSON_BODY_LIMIT },
  { method: "POST", pattern: /^transcriptions$/, bodyLimit: AUDIO_BODY_LIMIT },
];

const ANALYSIS_ID = /^[A-Za-z0-9_-]+$/;

/** Request headers relayed upstream. Cookies and browser credentials are never forwarded. */
const FORWARD_REQUEST_HEADERS = ["accept", "content-type", "accept-language"] as const;
/** Response headers relayed to the browser. */
const FORWARD_RESPONSE_HEADERS = ["content-type", "retry-after", "cache-control"] as const;

export interface ProxyDeps {
  fetch?: typeof fetch;
  config?: BayServerConfig;
  session?: () => Promise<Session>;
}

/* ── error envelope (same shape as the backend's) ────────── */

export function errorResponse(
  status: number,
  code: ErrorPayload["code"],
  message: string,
  extra: { retryable?: boolean; details?: Record<string, unknown> | null; headers?: Record<string, string> } = {},
): Response {
  const body: ErrorEnvelope = {
    error: { code, message, retryable: extra.retryable ?? false, details: extra.details ?? null },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(extra.headers ?? {}) },
  });
}

function upstreamUnreachable(cause: unknown): Response {
  const reason = cause instanceof Error ? cause.name : "unknown";
  return errorResponse(502, "INTERNAL_ERROR", "The BayAnalytics API could not be reached.", {
    retryable: true,
    details: { reason: "upstream_unreachable", cause: reason },
  });
}

/* ── shared pieces ───────────────────────────────────────── */

function upstreamHeaders(request: Request, config: BayServerConfig, overrides: Record<string, string> = {}): Headers {
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(overrides)) headers.set(name, value);
  if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
  return headers;
}

function responseHeaders(upstream: Response, extra: Record<string, string> = {}): Headers {
  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function joinUrl(base: string, path: string, search: string): string {
  return `${base}/${path}${search}`;
}

/**
 * Read a request body within `limit` bytes. Rejects by Content-Length before
 * reading (as the backend does) and again on the bytes actually received, so a
 * mis-declared length cannot get an oversized body upstream. The body is
 * buffered on purpose: the backend requires Content-Length (411 for chunked
 * uploads), which a streamed relay could not provide.
 */
async function readBody(request: Request, limit: number): Promise<ArrayBuffer | Response> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isInteger(size) || size < 0) {
      return errorResponse(400, "INVALID_REQUEST", "Invalid Content-Length.");
    }
    if (size > limit) return tooLarge(limit);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) return tooLarge(limit);
  return bytes;
}

function tooLarge(limit: number): Response {
  return errorResponse(413, "INVALID_REQUEST", `Request body exceeds the ${limit} byte limit.`, {
    details: { limit },
  });
}

/* ── GET/POST passthrough ────────────────────────────────── */

export async function proxyRequest(request: Request, pathSegments: string[], deps: ProxyDeps = {}): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = pathSegments.join("/");
  const route = ROUTES.find((r) => r.method === method && r.pattern.test(path));
  if (!route) {
    return errorResponse(404, "NOT_FOUND", "No such API route.");
  }
  await (deps.session ?? getServerSession)();

  let config: BayServerConfig;
  try {
    config = deps.config ?? readBayServerConfig();
  } catch (cause) {
    return errorResponse(500, "INTERNAL_ERROR", cause instanceof Error ? cause.message : "Proxy misconfigured.");
  }

  let body: ArrayBuffer | undefined;
  if (route.bodyLimit !== null) {
    const read = await readBody(request, route.bodyLimit);
    if (read instanceof Response) return read;
    body = read;
  }

  const url = joinUrl(config.apiUrl, path, new URL(request.url).search);
  const fetchImpl = deps.fetch ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method,
      headers: upstreamHeaders(request, config),
      body,
      signal: request.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (cause) {
    return upstreamUnreachable(cause);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders(upstream, { "cache-control": upstream.headers.get("cache-control") ?? "no-store" }),
  });
}

/* ── SSE passthrough ─────────────────────────────────────── */

/**
 * Relay `GET /analyses/{id}/events` as a live stream: the upstream body is
 * handed to the response as a `ReadableStream` chunk by chunk (no buffering,
 * no re-serialisation), `Last-Event-ID` (preferred) or `?after=` is forwarded so the
 * backend replays only the tail, and the upstream request is aborted the
 * moment the browser goes away.
 */
export async function proxyEventStream(request: Request, analysisId: string, deps: ProxyDeps = {}): Promise<Response> {
  if (!ANALYSIS_ID.test(analysisId)) {
    return errorResponse(404, "NOT_FOUND", "No analysis exists with that id.");
  }
  await (deps.session ?? getServerSession)();

  let config: BayServerConfig;
  try {
    config = deps.config ?? readBayServerConfig();
  } catch (cause) {
    return errorResponse(500, "INTERNAL_ERROR", cause instanceof Error ? cause.message : "Proxy misconfigured.");
  }

  const incoming = new URL(request.url);
  const lastEventId = request.headers.get("last-event-id");
  const search = new URLSearchParams();
  const after = incoming.searchParams.get("after");
  /* A native EventSource reconnect keeps its original ?after= while sending a
   * newer Last-Event-ID, so a valid header wins: it is the latest delivered seq. */
  if (lastEventId && /^\d+$/.test(lastEventId.trim())) search.set("after", lastEventId.trim());
  else if (after !== null && /^\d+$/.test(after)) search.set("after", after);
  const query = search.toString();
  const url = `${config.apiUrl}/analyses/${encodeURIComponent(analysisId)}/events${query ? `?${query}` : ""}`;

  const overrides: Record<string, string> = { accept: "text/event-stream" };
  if (lastEventId) overrides["last-event-id"] = lastEventId;

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });

  const fetchImpl = deps.fetch ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method: "GET",
      headers: upstreamHeaders(request, config, overrides),
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (cause) {
    request.signal.removeEventListener("abort", abort);
    return upstreamUnreachable(cause);
  }

  if (!upstream.ok || !upstream.body) {
    /* the backend's JSON error envelope (404 NOT_FOUND, 401 ...) passes through as-is */
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream, { "cache-control": "no-store" }),
    });
  }

  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          ctrl.close();
          request.signal.removeEventListener("abort", abort);
          return;
        }
        ctrl.enqueue(value);
      } catch (cause) {
        request.signal.removeEventListener("abort", abort);
        if (controller.signal.aborted) ctrl.close();
        else ctrl.error(cause);
      }
    },
    cancel() {
      /* the browser disconnected: stop the upstream stream too */
      request.signal.removeEventListener("abort", abort);
      controller.abort();
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
