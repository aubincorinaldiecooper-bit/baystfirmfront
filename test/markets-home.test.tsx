/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeView from "@/components/finance/HomeView";
import CryptoAssetView from "@/components/markets/CryptoAssetView";
import type { AnalysisSummary } from "@/lib/api/types";
import * as marketsClient from "@/lib/markets/client";
import { initialMarketsState, marketsReducer } from "@/lib/markets/state";
import type { FilingsFeed, MarketEvent, MarketsSnapshot, NewsFeed, NewsItem } from "@/lib/markets/types";
import { RECENT_SEARCHES_KEY } from "@/lib/search/recents";
import type { UseMarketsResult } from "@/lib/markets/useMarkets";
import { capabilitiesFixture, jsonResponse } from "./fixtures/backend";
import { stubBackend } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/markets/TokensView", () => ({ default: () => <section aria-label="New Solana tokens" /> }));
vi.mock("@/components/markets/LiveChart", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  nav.push.mockReset();
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_FULL_HOME", "true");
  vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "false");
  vi.spyOn(marketsClient, "getNews").mockResolvedValue(EMPTY_NEWS);
  vi.spyOn(marketsClient, "getFilings").mockResolvedValue(EMPTY_FILINGS);
});

const AT = "2026-10-04T17:00:00Z";
const NOTE = "Headlines link to the original publisher. Market and token events are measured by Baystfirm from exchange and on-chain data. Facts, not investment advice.";
const EMPTY_NEWS: NewsFeed = { generated_at: AT, items: [], sources: [], note: NOTE };
const EMPTY_FILINGS: FilingsFeed = {
  generated_at: AT,
  items: [],
  notes: [],
  source: { source: "sec_edgar", label: "SEC EDGAR", url: "https://www.sec.gov/files/company_tickers.json", last_success_at: null, last_error: null },
  note: NOTE,
};

function newsItem(id: string, title: string, kind: NewsItem["kind"], published_at: string): NewsItem {
  const ownEvent = kind === "market_event" || kind === "token_event";
  return {
    id,
    kind,
    source: kind === "filing" ? "sec_edgar" : ownEvent ? "baystfirm" : "sec",
    source_label: kind === "filing" ? "SEC EDGAR" : ownEvent ? "Baystfirm (measured)" : "U.S. SEC",
    title,
    url: `https://example.test/${id}`,
    published_at,
    symbols: kind === "filing" ? ["AAPL"] : [],
    details: {},
  };
}

function trade(venue: string, symbol: string, price: number): MarketEvent {
  return {
    event_id: `${venue}-${symbol}`,
    venue,
    symbol,
    native_symbol: symbol,
    base_asset: symbol.split("-")[0],
    quote_asset: symbol.split("-")[1],
    instrument_kind: "spot",
    event_type: "trade",
    exchange_timestamp: AT,
    received_timestamp: AT,
    sequence: 1,
    price,
    size: 1,
    side: "buy",
    payload_hash: "fixture",
    metadata: {},
  };
}

function setup(
  fetchImpl: typeof fetch,
  analyses: AnalysisSummary[] = [],
  ui: ReactNode = <HomeView />,
  historyResponse?: () => Response,
  latestEvents?: MarketEvent[],
) {
  const events = latestEvents ?? [trade("coinbase", "BTC-USD", 100), trade("kraken", "BTC-USD", 99)];
  const snapshot: MarketsSnapshot = {
    generated_at: AT,
    shadow_mode: true,
    enabled_venues: ["coinbase", "kraken"],
    symbols: [...new Set(events.map((event) => event.symbol))],
    latest_events: events,
    latest_classifications: [],
  };
  const markets: UseMarketsResult = {
    state: marketsReducer(initialMarketsState(), { type: "snapshot", snapshot }),
    snapshot,
    snapshotError: null,
    gate: null,
    gateError: null,
    trackRecord: null,
    trackRecordError: null,
    backtest: null,
    backtestError: null,
    stream: "live",
    reload: vi.fn(),
  };
  const backend = stubBackend({
    "GET /capabilities": () => jsonResponse(200, capabilitiesFixture),
    "GET /analyses": () => historyResponse?.() ?? jsonResponse(200, { analyses, next_cursor: null }),
  });
  vi.stubGlobal("fetch", fetchImpl);
  renderWorkspace(ui, { client: backend.client }, markets);
}

describe("HomeView", () => {
  it("shows the stablecoin board and filtered news by default without mounting the full Home", async () => {
    vi.stubEnv("NEXT_PUBLIC_FULL_HOME", "false");
    const getNews = vi.spyOn(marketsClient, "getNews").mockResolvedValue({
      ...EMPTY_NEWS,
      items: [
        newsItem("release", "SEC release", "official", "2026-10-05T12:00:00Z"),
        newsItem("token", "Solana token event", "token_event", "2026-10-05T13:00:00Z"),
      ],
    });
    const now = new Date().toISOString();
    const stablecoinEvents = [
      { ...trade("coinbase", "USDC-USD", 0.9999), exchange_timestamp: now },
      { ...trade("kraken", "USDC-USD", 1.0001), exchange_timestamp: now },
      {
        ...trade("kraken", "PYUSD-USD", 0.9999),
        event_type: "book" as const,
        price: null,
        bid: 0.9998,
        ask: 1,
        bid_depth_10bps: 4_000_000,
        ask_depth_10bps: 4_800_000,
        exchange_timestamp: now,
      },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch, [], <HomeView />, undefined, stablecoinEvents);

    expect(screen.getByRole("heading", { name: "Stablecoins" })).toBeTruthy();
    expect(
      screen.getByText("Live stablecoin prices against $1 across exchanges. Measured prices only, not investment advice. No trading, wallets or custody."),
    ).toBeTruthy();
    const board = screen.getByRole("region", { name: /Stablecoins — live from exchanges/ });
    expect(within(board).getByRole("link", { name: "USDC" })).toBeTruthy();
    expect(within(board).getByText("$1.00000")).toBeTruthy();
    const pyusdLink = within(board).getByRole("link", { name: "PYUSD" });
    expect(pyusdLink.parentElement?.textContent).toContain("$0.99990");
    const pyusdReading = within(board).getByText("Kraken $0.99990").closest("[title]");
    expect(pyusdReading?.getAttribute("title")).toContain("order-book mid");
    expect(within(board).getByText("Order-book depth ±0.1%: $8.8M")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Stocks/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /Biggest moves/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /Crypto/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /New Solana tokens/ })).toBeNull();

    const newsPanel = screen.getByRole("region", { name: /News & events/ });
    expect(await within(newsPanel).findByText("SEC release")).toBeTruthy();
    expect(within(newsPanel).queryByText("Solana token event")).toBeNull();
    expect(getNews).toHaveBeenCalledWith({ limit: 30 }, fetchImpl, expect.any(AbortSignal));
    expect(marketsClient.getFilings).not.toHaveBeenCalled();
  });

  it("shows stale exchange coverage when a stablecoin has no fresh USD reading", () => {
    vi.stubEnv("NEXT_PUBLIC_FULL_HOME", "false");
    const staleTrade = {
      ...trade("coinbase", "DAI-USD", 1),
      exchange_timestamp: new Date(Date.now() - 11 * 60_000).toISOString(),
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch, [], <HomeView />, undefined, [staleTrade]);

    const board = screen.getByRole("region", { name: /Stablecoins — live from exchanges/ });
    expect(within(board).getByRole("link", { name: "DAI" })).toBeTruthy();
    expect(within(board).getByText("No fresh exchange price")).toBeTruthy();
    expect(within(board).queryByText("One exchange · can't cross-check")).toBeNull();
  });

  it("shows grouped crypto markets and the exact fresh-research empty state without a stock price", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch);
    const stocks = screen.getByRole("region", { name: /Stocks/ });
    expect(await within(stocks).findByText("Search a company to research it. Each search pulls fresh web data at that moment.")).toBeTruthy();
    const crypto = screen.getByRole("region", { name: /Crypto/ });
    expect(within(crypto).getByRole("link", { name: "BTC" })).toBeTruthy();
    expect(within(crypto).getByText("2 · Coinbase")).toBeTruthy();
    expect(within(stocks).queryByText(/price/i)).toBeNull();
    expect(screen.getByRole("region", { name: /New Solana tokens/ })).toBeTruthy();
  });

  it("shows a company-research unavailable state when history fails before loading rows", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(
      fetchImpl as unknown as typeof fetch,
      [],
      <HomeView />,
      () =>
        jsonResponse(503, {
          error: { code: "INTERNAL_ERROR", message: "History service is unavailable.", retryable: true },
        }),
    );

    const stocks = screen.getByRole("region", { name: /Stocks/ });
    expect(
      await within(stocks).findByText("Company research is unavailable right now: History service is unavailable."),
    ).toBeTruthy();
    expect(within(stocks).queryByText("Loading company research…")).toBeNull();
    expect(within(stocks).queryByText(/Research history could not be refreshed/)).toBeNull();
    expect(within(stocks).getByRole("status")).toBeTruthy();
  });

  it("shows the refresh error when older stock research rows remain after loading more fails", async () => {
    const apple: AnalysisSummary = {
      analysis_id: "apple",
      query: "Apple outlook",
      instrument: { symbol: "AAPL", exchange: "NASDAQ", name: "Apple", cik: null, sector: null, instrument_type: "stock" },
      profile: "fast",
      horizon: "next_cycle",
      status: "completed",
      created_at: AT,
      updated_at: AT,
      completed_at: AT,
      error_code: null,
    };
    const historyResponse = vi
      .fn<() => Response>()
      .mockReturnValueOnce(jsonResponse(200, { analyses: [apple], next_cursor: "next-page" }))
      .mockReturnValueOnce(
        jsonResponse(503, {
          error: { code: "INTERNAL_ERROR", message: "History page failed.", retryable: true },
        }),
      );
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch, [], <HomeView />, historyResponse);

    const stocks = screen.getByRole("region", { name: /Stocks/ });
    expect(await within(stocks).findByRole("link", { name: /AAPL · Apple/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(
      await within(stocks).findByText("Research history could not be refreshed: History page failed."),
    ).toBeTruthy();
    expect(within(stocks).getByRole("link", { name: /AAPL · Apple/ })).toBeTruthy();
  });

  it("merges recent news and filings newest-first using only recent stock tickers", async () => {
    const official = newsItem("official", "SEC press release", "official", "2026-10-05T12:00:00Z");
    const filing = newsItem("filing", "Apple Form 8-K", "filing", "2026-10-05T13:00:00Z");
    const getNews = vi.spyOn(marketsClient, "getNews").mockResolvedValue({ ...EMPTY_NEWS, items: [official] });
    const filings = vi.spyOn(marketsClient, "getFilings").mockResolvedValue({ ...EMPTY_FILINGS, items: [filing] });
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([
        { kind: "stock", id: "stock:AAPL", label: "AAPL", at: "2026-10-03T12:00:00Z" },
        { kind: "crypto", id: "crypto:BTC", label: "BTC", at: "2026-10-05T11:00:00Z" },
        { kind: "stock", id: "stock:GOOG", label: "GOOG", at: "2026-10-04T12:00:00Z" },
        { kind: "token", id: "token:mint", label: "Mint", at: "2026-10-05T10:00:00Z" },
        { kind: "stock", id: "stock:invalid", label: "AAPL!", at: "2026-10-05T14:00:00Z" },
      ]),
    );
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch);

    const panel = screen.getByRole("region", { name: /News & events/ });
    const list = await within(panel).findByRole("list", { name: "News and events" });
    await waitFor(() => expect(filings).toHaveBeenCalledWith(["GOOG", "AAPL"], 10, fetchImpl, expect.any(AbortSignal)));
    expect(getNews).toHaveBeenCalledWith({ limit: 30 }, fetchImpl, expect.any(AbortSignal));
    expect(within(list).getAllByRole("link").map((link) => link.textContent)).toEqual(["Apple Form 8-K", "SEC press release"]);
    expect(within(panel).getByText(NOTE)).toBeTruthy();
  });

  it("loads crypto events and regulator releases in the News tab", async () => {
    const marketEvent = newsItem("market", "BTC position liquidated on Bybit", "market_event", "2026-10-05T12:00:00Z");
    const official = newsItem("release", "SEC press release", "official", "2026-10-05T11:00:00Z");
    const news = vi.spyOn(marketsClient, "getNews").mockImplementation(async (query) => ({
      ...EMPTY_NEWS,
      items: query?.kinds?.includes("market_event") ? [marketEvent] : [official],
    }));
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch, [], <CryptoAssetView base="BTC" />);

    fireEvent.click(screen.getByRole("tab", { name: "News" }));
    const events = await screen.findByRole("region", { name: /^BTC events/ });
    const releases = await screen.findByRole("region", { name: /^Regulator releases/ });
    expect(await within(events).findByText(marketEvent.title)).toBeTruthy();
    expect(await within(releases).findByText(official.title)).toBeTruthy();
    expect(news).toHaveBeenCalledWith({ symbol: "BTC", kinds: ["market_event"], limit: 50 }, fetchImpl, expect.any(AbortSignal));
    expect(news).toHaveBeenCalledWith({ kinds: ["official"], limit: 10 }, fetchImpl, expect.any(AbortSignal));
  });

  it("deduplicates completed company research by symbol and keeps the newest search", async () => {
    const analyses: AnalysisSummary[] = [
      {
        analysis_id: "older",
        query: "Old Apple outlook",
        instrument: { symbol: "AAPL", exchange: "NASDAQ", name: "Apple", cik: null, sector: null, instrument_type: "stock" },
        profile: "fast",
        horizon: "next_cycle",
        status: "completed",
        created_at: "2026-10-03T17:00:00Z",
        updated_at: "2026-10-03T17:01:00Z",
        completed_at: "2026-10-03T17:01:00Z",
        error_code: null,
      },
      {
        analysis_id: "newer",
        query: "Latest Apple outlook",
        instrument: { symbol: "AAPL", exchange: "NASDAQ", name: "Apple", cik: null, sector: null, instrument_type: "stock" },
        profile: "fast",
        horizon: "next_cycle",
        status: "completed",
        created_at: "2026-10-04T17:00:00Z",
        updated_at: "2026-10-04T17:01:00Z",
        completed_at: "2026-10-04T17:01:00Z",
        error_code: null,
      },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch, analyses);
    const stocks = screen.getByRole("region", { name: /Stocks/ });
    const latest = await within(stocks).findByRole("link", { name: /AAPL · Apple/ });
    expect(latest.getAttribute("href")).toBe("/analyses/newer");
    expect(within(stocks).getByText("Latest Apple outlook")).toBeTruthy();
    expect(within(stocks).queryByText("Old Apple outlook")).toBeNull();
    expect(within(stocks).getAllByRole("link")).toHaveLength(1);
  });

  it("loads preferred crypto candles once and refreshes only on request", async () => {
    const candles = Array.from({ length: 25 }, (_, index) => ({
      open_time: 1_790_000_000_000 + index * 3_600_000,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 1,
    }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/markets/candles?venue=coinbase&symbol=BTC-USD&interval=1h&limit=25");
      return new Response(
        JSON.stringify({
          venue: "coinbase",
          symbol: "BTC-USD",
          interval: "1h",
          source_url_template: "https://example.test",
          fetched_at: AT,
          aggregated_from: null,
          candles,
          stale: false,
          truncated: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    setup(fetchImpl as unknown as typeof fetch);
    const move = await screen.findByRole("link", { name: /Crypto · 24h/ });
    expect(move.getAttribute("href")).toBe("/crypto/BTC");
    expect(move.textContent).toContain("+24.00%");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("/api/markets/candles?venue=coinbase&symbol=BTC-USD&interval=1h&limit=25");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});
