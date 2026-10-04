/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeView from "@/components/finance/HomeView";
import type { AnalysisSummary } from "@/lib/api/types";
import { initialMarketsState, marketsReducer } from "@/lib/markets/state";
import type { MarketEvent, MarketsSnapshot } from "@/lib/markets/types";
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

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  nav.push.mockReset();
  vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "false");
});

const AT = "2026-10-04T17:00:00Z";

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

function setup(fetchImpl: typeof fetch, analyses: AnalysisSummary[] = []) {
  const snapshot: MarketsSnapshot = {
    generated_at: AT,
    shadow_mode: true,
    enabled_venues: ["coinbase", "kraken"],
    symbols: ["BTC-USD"],
    latest_events: [trade("coinbase", "BTC-USD", 100), trade("kraken", "BTC-USD", 99)],
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
    "GET /analyses": () => jsonResponse(200, { analyses, next_cursor: null }),
  });
  vi.stubGlobal("fetch", fetchImpl);
  renderWorkspace(<HomeView />, { client: backend.client }, markets);
}

describe("HomeView", () => {
  it("shows grouped crypto markets and the exact fresh-research empty state without a stock price", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candles: [] }), { status: 200 }));
    setup(fetchImpl as unknown as typeof fetch);
    const stocks = screen.getByRole("region", { name: /Stocks/ });
    expect(await within(stocks).findByText("Search a company to research it. Each search pulls fresh web data at that moment.")).toBeTruthy();
    const crypto = screen.getByRole("region", { name: /Crypto/ });
    expect(within(crypto).getByRole("link", { name: "BTC" })).toBeTruthy();
    expect(within(crypto).getByText("2 · coinbase")).toBeTruthy();
    expect(within(stocks).queryByText(/price/i)).toBeNull();
    expect(screen.getByRole("region", { name: /New Solana tokens/ })).toBeTruthy();
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
