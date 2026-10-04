/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import HeaderSearch from "@/components/finance/HeaderSearch";
import type { SolanaSearchResponse } from "@/lib/markets/types";
import type { MarketsSnapshot } from "@/lib/markets/types";
import { initialMarketsState } from "@/lib/markets/state";
import { capabilitiesFixture, jsonResponse } from "./fixtures/backend";
import { stubBackend } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const emptySnapshot: MarketsSnapshot = {
  generated_at: "2026-10-04T17:00:00Z",
  shadow_mode: true,
  enabled_venues: ["coinbase", "kraken"],
  symbols: ["BTC-USD"],
  latest_events: [],
  latest_classifications: [],
};

function backend() {
  return stubBackend({
    "GET /capabilities": () => jsonResponse(200, capabilitiesFixture),
    "GET /analyses": () => jsonResponse(200, { analyses: [], next_cursor: null }),
    "POST /analyses": () =>
      jsonResponse(202, { analysis_id: "an_created123456789", status: "queued", profile: "fast", resolved_horizon: "near_term" }),
  });
}

function setTokenSearch(body: SolanaSearchResponse) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  nav.push.mockReset();
});

describe("HeaderSearch", () => {
  it("debounces Solana search and keeps an ambiguous symbol match open on Enter", async () => {
    const fetchMock = setTokenSearch({
      query: "BONK",
      tokens: [
        {
          mint: MINT,
          symbol: "BONK",
          name: "Bonk",
          image: null,
          pool_count: 30,
          total_liquidity_usd: 1_600_000,
          volume_24h_usd: 1_000_000,
          main_pool_address: "pool",
          price_usd: 0.00002,
          symbol_match: true,
        },
      ],
      source: "dexscreener",
      fetched_at: "2026-10-04T17:00:00Z",
      note: "Search results only.",
    });
    renderWorkspace(<HeaderSearch />, { client: backend().client });

    const input = screen.getByRole("combobox", { name: /Search a coin/ });
    fireEvent.change(input, { target: { value: "BONK" } });
    await screen.findByText(/DEX Screener search results/);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("option", { name: /BONK · Bonk/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("This matches a Solana token and could also be a company — pick one")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("routes a mint directly and routes an exact crypto symbol after token search finds no symbol match", async () => {
    const fetchMock = setTokenSearch({
      query: "BTC",
      tokens: [],
      source: "dexscreener",
      fetched_at: "2026-10-04T17:00:00Z",
      note: "Search results only.",
    });
    const server = backend();
    renderWorkspace(<HeaderSearch />, { client: server.client }, {
      ...{
        state: initialMarketsState(),
        snapshot: emptySnapshot,
        snapshotError: null,
        gate: null,
        gateError: null,
        trackRecord: null,
        trackRecordError: null,
        backtest: null,
        backtestError: null,
        stream: "live" as const,
        reload: vi.fn<() => void>(),
      },
    });
    const input = screen.getByRole("combobox", { name: /Search a coin/ });

    fireEvent.change(input, { target: { value: MINT } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.push).toHaveBeenLastCalledWith(`/tokens/${MINT}`);

    fireEvent.change(input, { target: { value: "BTC" } });
    await screen.findByRole("option", { name: /BTC · crypto/ });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(nav.push).toHaveBeenLastCalledWith("/crypto/BTC");
  });

  it("submits research using the available profile and auto horizon", async () => {
    const server = backend();
    renderWorkspace(<HeaderSearch />, { client: server.client });
    const input = screen.getByRole("combobox", { name: /Search a coin/ });
    fireEvent.change(input, { target: { value: "Apple outlook next quarter" } });
    await screen.findByRole("option", { name: /Research “Apple outlook next quarter”/ });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(server.callsTo("POST", "/analyses")).toHaveLength(1));
    expect(server.callsTo("POST", "/analyses")[0].body).toMatchObject({
      query: "Apple outlook next quarter",
      profile: "fast",
      horizon: "auto",
    });
    await waitFor(() => expect(nav.push).toHaveBeenLastCalledWith("/analyses/an_created123456789"));
  });

  it("supports active descendants with arrows and closes with Escape", async () => {
    const server = backend();
    renderWorkspace(<HeaderSearch />, { client: server.client }, {
      state: initialMarketsState(),
      snapshot: emptySnapshot,
      snapshotError: null,
      gate: null,
      gateError: null,
      trackRecord: null,
      trackRecordError: null,
      backtest: null,
      backtestError: null,
      stream: "live",
      reload: vi.fn<() => void>(),
    });
    const input = screen.getByRole("combobox", { name: /Search a coin/ });
    fireEvent.change(input, { target: { value: "BTC" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe("header-search-option-crypto:BTC");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});
