import "server-only";

/**
 * The Markets proxy: Browser → /api/markets/* → Baystfirm crypto backend.
 *
 * Only the read routes the Markets page uses are relayed (GET only); the key
 * is attached here on the server. JSON bodies pass through untouched and the
 * live stream is piped chunk by chunk, aborted when the browser goes away.
 */

import { getServerSession, type Session } from "@/lib/auth/session";
import { errorResponse } from "./proxy";
import { readBaystServerConfig, type BaystServerConfig } from "./baystEnv";

/** Browser path → upstream path. Anything else is 404, never forwarded. */
export const MARKETS_ROUTES: Readonly<Record<string, string>> = {
  health: "health",
  snapshot: "v1/snapshot",
  candles: "v1/candles",
  classifications: "v1/classifications",
  events: "v1/events",
  "evaluation/gate": "v1/evaluation/gate",
  "track-record": "v1/track-record",
  "track-record/backtest": "v1/track-record/backtest",
};

const FORWARDED_QUERY = new Set(["symbol", "classifier", "limit", "venue", "interval", "window_hours"]);
/* Forwarded as given, repeats included (`/v1/candles?indicator=sma:20&indicator=rsi:14`). */
const REPEATED_QUERY = new Set(["indicator"]);
const SYMBOLS = /^[A-Za-z0-9,_-]{1,512}$/;

export interface MarketsProxyDeps {
  fetch?: typeof fetch;
  config?: BaystServerConfig;
  session?: () => Promise<Session>;
}

function unreachable(cause: unknown): Response {
  return errorResponse(502, "INTERNAL_ERROR", "The crypto backend could not be reached.", {
    retryable: true,
    details: { reason: "upstream_unreachable", cause: cause instanceof Error ? cause.name : "unknown" },
  });
}

function configOf(deps: MarketsProxyDeps): BaystServerConfig | Response {
  try {
    return deps.config ?? readBaystServerConfig();
  } catch (cause) {
    return errorResponse(500, "INTERNAL_ERROR", cause instanceof Error ? cause.message : "Markets proxy misconfigured.");
  }
}

function headersFor(config: BaystServerConfig, accept: string): Headers {
  const headers = new Headers({ accept });
  if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
  return headers;
}

export async function proxyMarketsRequest(request: Request, pathSegments: string[], deps: MarketsProxyDeps = {}): Promise<Response> {
  const upstreamPath = MARKETS_ROUTES[pathSegments.join("/")];
  if (request.method.toUpperCase() !== "GET" || !upstreamPath) {
    return errorResponse(404, "NOT_FOUND", "No such API route.");
  }
  await (deps.session ?? getServerSession)();
  const config = configOf(deps);
  if (config instanceof Response) return config;

  const search = new URLSearchParams();
  for (const [name, value] of new URL(request.url).searchParams) {
    if (FORWARDED_QUERY.has(name)) search.set(name, value);
    else if (REPEATED_QUERY.has(name)) search.append(name, value);
  }
  const query = search.toString();
  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(`${config.apiUrl}/${upstreamPath}${query ? `?${query}` : ""}`, {
      method: "GET",
      headers: headersFor(config, "application/json"),
      signal: request.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (cause) {
    return unreachable(cause);
  }
  const headers = new Headers({ "cache-control": "no-store" });
  const type = upstream.headers.get("content-type");
  if (type) headers.set("content-type", type);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function proxyMarketsStream(request: Request, deps: MarketsProxyDeps = {}): Promise<Response> {
  await (deps.session ?? getServerSession)();
  const config = configOf(deps);
  if (config instanceof Response) return config;

  const symbols = new URL(request.url).searchParams.get("symbols");
  const query = symbols && SYMBOLS.test(symbols) ? `?symbols=${encodeURIComponent(symbols)}` : "";
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });

  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(`${config.apiUrl}/v1/stream/sse${query}`, {
      method: "GET",
      headers: headersFor(config, "text/event-stream"),
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (cause) {
    request.signal.removeEventListener("abort", abort);
    return unreachable(cause);
  }
  if (!upstream.ok || !upstream.body) {
    request.signal.removeEventListener("abort", abort);
    const headers = new Headers({ "cache-control": "no-store" });
    const type = upstream.headers.get("content-type");
    if (type) headers.set("content-type", type);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          request.signal.removeEventListener("abort", abort);
          ctrl.close();
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
      request.signal.removeEventListener("abort", abort);
      controller.abort();
      reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
