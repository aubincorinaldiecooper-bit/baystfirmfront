import "server-only";

/**
 * The Markets proxy: Browser → /api/markets/* → Baystfirm crypto backend.
 *
 * Only the read routes the Markets page uses are relayed (GET only); the key
 * is attached here on the server. JSON bodies pass through untouched and the
 * live stream is piped chunk by chunk, aborted when the browser goes away.
 */

import { getServerSession, type Session } from "@/lib/auth/session";
import { INDICATOR_OPTIONS } from "@/lib/markets/indicators";
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
  "solana/tokens/new": "v1/solana/tokens/new",
  "solana/search": "v1/solana/search",
};

/** A Solana mint address: base58, 32–44 characters. */
const SOLANA_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function upstreamPathFor(pathSegments: string[]): string | undefined {
  const fixed = MARKETS_ROUTES[pathSegments.join("/")];
  if (fixed) return fixed;
  const [chain, kind, mint, resource] = pathSegments;
  if (pathSegments.length === 3 && chain === "solana" && kind === "tokens" && SOLANA_MINT.test(mint)) {
    return `v1/solana/tokens/${mint}`;
  }
  if (
    pathSegments.length === 4 &&
    chain === "solana" &&
    kind === "tokens" &&
    SOLANA_MINT.test(mint) &&
    resource === "candles"
  ) {
    return `v1/solana/tokens/${mint}/candles`;
  }
  return undefined;
}

const FORWARDED_QUERY = new Set(["symbol", "classifier", "limit", "venue", "interval", "window_hours", "q"]);
/* Forwarded as given, repeats included (`/v1/candles?indicator=sma:20&indicator=rsi:14`). */
const REPEATED_QUERY = new Set(["indicator"]);
const SYMBOLS = /^[A-Za-z0-9,_-]{1,512}$/;
const SOLANA_CANDLE_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const SOLANA_CANDLE_INDICATORS = new Set(INDICATOR_OPTIONS.map((option) => option.spec));

function invalidMarketsRequest(message: string): Response {
  return errorResponse(422, "INVALID_REQUEST", message);
}

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
  const upstreamPath = upstreamPathFor(pathSegments);
  if (request.method.toUpperCase() !== "GET" || !upstreamPath) {
    return errorResponse(404, "NOT_FOUND", "No such API route.");
  }
  const requestUrl = new URL(request.url);
  let solanaSearchQuery: string | null = null;
  if (upstreamPath === "v1/solana/search") {
    const values = requestUrl.searchParams.getAll("q");
    solanaSearchQuery = values.length === 1 ? values[0].trim() : "";
    if (solanaSearchQuery.length < 1 || solanaSearchQuery.length > 32) {
      return invalidMarketsRequest("Search query must be 1–32 characters.");
    }
  }
  if (upstreamPath.startsWith("v1/solana/tokens/") && upstreamPath.endsWith("/candles")) {
    const intervals = requestUrl.searchParams.getAll("interval");
    if (intervals.length !== 1 || !SOLANA_CANDLE_INTERVALS.has(intervals[0])) {
      return invalidMarketsRequest("Candle interval must be one of 1m, 5m, 15m, 1h, 4h or 1d.");
    }
    const limits = requestUrl.searchParams.getAll("limit");
    if (
      limits.length > 1 ||
      (limits.length === 1 &&
        (!/^\d+$/.test(limits[0]) || !Number.isInteger(Number(limits[0])) || Number(limits[0]) < 1 || Number(limits[0]) > 500))
    ) {
      return invalidMarketsRequest("Candle limit must be an integer from 1 to 500.");
    }
    const indicators = requestUrl.searchParams.getAll("indicator");
    if (indicators.length > 6 || indicators.some((indicator) => !SOLANA_CANDLE_INDICATORS.has(indicator))) {
      return invalidMarketsRequest("Use at most six supported candle indicators.");
    }
  }
  await (deps.session ?? getServerSession)();
  const config = configOf(deps);
  if (config instanceof Response) return config;

  const search = new URLSearchParams();
  for (const [name, value] of requestUrl.searchParams) {
    if (name === "q" && upstreamPath === "v1/solana/search") continue;
    if (FORWARDED_QUERY.has(name)) search.set(name, value);
    else if (REPEATED_QUERY.has(name)) search.append(name, value);
  }
  if (solanaSearchQuery !== null) search.set("q", solanaSearchQuery);
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
