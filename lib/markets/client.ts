/**
 * Browser client for the Markets page. Everything goes through the same-origin
 * `/api/markets` proxy; the Baystfirm URL and key stay on the server.
 */

import type {
  CandleInterval,
  CandleResponse,
  Classification,
  EvaluationGate,
  FilingsFeed,
  MarketEvent,
  MarketsSnapshot,
  NewTokensFeed,
  NewsFeed,
  NewsKind,
  SignalBacktest,
  SolanaCandleInterval,
  SolanaSearchResponse,
  TokenCard,
  TokenCandleResponse,
  TokenPriceResponse,
  TrackRecord,
} from "./types";

export const MARKETS_API_BASE = "/api/markets";

export class MarketsError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "MarketsError";
  }
}

async function errorFrom(response: Response): Promise<MarketsError> {
  let message = `The crypto backend answered ${response.status}.`;
  let code = `HTTP_${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string }; detail?: unknown };
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
    else if (typeof body.detail === "string") message = body.detail;
  } catch {
    /* non-JSON error body: keep the status message */
  }
  return new MarketsError(message, response.status, code);
}

export async function getMarketsJson<T>(path: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${MARKETS_API_BASE}/${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new MarketsError("The crypto backend could not be reached.", 0, "NETWORK_ERROR");
  }
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export const fetchSnapshot = (fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<MarketsSnapshot>("snapshot", fetchImpl, signal);

export const fetchGate = (fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<EvaluationGate>("evaluation/gate", fetchImpl, signal);

export const fetchTrackRecord = (windowHours: number, fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<TrackRecord>(`track-record?window_hours=${windowHours}`, fetchImpl, signal);

export const fetchSignalBacktest = (fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<SignalBacktest>("track-record/backtest", fetchImpl, signal);

export const fetchNewTokens = (limit: number, fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<NewTokensFeed>(`solana/tokens/new?limit=${limit}`, fetchImpl, signal);

export const fetchTokenCard = (mint: string, fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<TokenCard>(`solana/tokens/${encodeURIComponent(mint)}`, fetchImpl, signal);

export const fetchTokenPrice = (mint: string, fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<TokenPriceResponse>(
    `solana/tokens/${encodeURIComponent(mint)}/price`,
    fetchImpl,
    signal,
  );

export const fetchTokenCandles = (
  mint: string,
  interval: SolanaCandleInterval,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  indicators: readonly string[] = [],
  limit = 300,
) => {
  const query = new URLSearchParams({ interval, limit: String(limit) });
  for (const spec of indicators) query.append("indicator", spec);
  return getMarketsJson<TokenCandleResponse>(
    `solana/tokens/${encodeURIComponent(mint)}/candles?${query}`,
    fetchImpl,
    signal,
  );
};

export const fetchSolanaTokenSearch = (query: string, fetchImpl?: typeof fetch, signal?: AbortSignal) =>
  getMarketsJson<SolanaSearchResponse>(`solana/search?${new URLSearchParams({ q: query })}`, fetchImpl, signal);

export function getNews(
  { symbol, kinds, limit }: { symbol?: string; kinds?: readonly NewsKind[]; limit?: number } = {},
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<NewsFeed> {
  const query = new URLSearchParams();
  if (symbol) query.set("symbol", symbol);
  for (const kind of kinds ?? []) query.append("kind", kind);
  if (limit !== undefined) query.set("limit", String(limit));
  return getMarketsJson<NewsFeed>(`news${query.size ? `?${query}` : ""}`, fetchImpl, signal);
}

export function getFilings(
  tickers: readonly string[],
  limit = 20,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<FilingsFeed> {
  const query = new URLSearchParams({ tickers: tickers.join(","), limit: String(limit) });
  return getMarketsJson<FilingsFeed>(`news/filings?${query}`, fetchImpl, signal);
}

export const fetchCandles = (
  venue: string,
  symbol: string,
  interval: CandleInterval,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  indicators: readonly string[] = [],
  limit = 300,
) => {
  const query = new URLSearchParams({ venue, symbol, interval, limit: String(limit) });
  for (const spec of indicators) query.append("indicator", spec);
  return getMarketsJson<CandleResponse>(`candles?${query}`, fetchImpl, signal);
};

export type StreamStatus = "connecting" | "live" | "reconnecting" | "closed";

export interface MarketsStreamHandlers {
  onEvent: (event: MarketEvent) => void;
  onClassification: (item: Classification) => void;
  onStatus: (status: StreamStatus) => void;
}

/** The live stream through `/api/markets/stream`; the browser reconnects on its own. */
export function openMarketsStream(handlers: MarketsStreamHandlers, EventSourceImpl: typeof EventSource = EventSource): () => void {
  const source = new EventSourceImpl(`${MARKETS_API_BASE}/stream`);
  handlers.onStatus("connecting");
  const parse = <T,>(raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  source.onopen = () => handlers.onStatus("live");
  source.onerror = () => handlers.onStatus(source.readyState === EventSourceImpl.CLOSED ? "closed" : "reconnecting");
  source.addEventListener("market_event", (message) => {
    const event = parse<MarketEvent>((message as MessageEvent<string>).data);
    if (event) handlers.onEvent(event);
  });
  source.addEventListener("classification", (message) => {
    const item = parse<Classification>((message as MessageEvent<string>).data);
    if (item) handlers.onClassification(item);
  });
  return () => source.close();
}
