/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import CryptoAssetView from "@/components/markets/CryptoAssetView";
import MarketsProvider, { useMarketsContext as useProviderMarkets } from "@/components/markets/MarketsProvider";
import HistorySidebar from "@/components/finance/HistorySidebar";
import { WorkspaceContext, type WorkspaceValue } from "@/components/finance/workspace";
import type { UseAnalysisHistoryResult } from "@/lib/api/history";
import { initialHistoryState } from "@/lib/api/history";
import type { UseCapabilitiesResult } from "@/lib/api/capabilities";
import { initialMarketsState, marketsReducer, type MarketsState } from "@/lib/markets/state";
import type { MarketEvent, MarketsSnapshot } from "@/lib/markets/types";
import type { UseMarketsResult } from "@/lib/markets/useMarkets";

const navigation = vi.hoisted(() => ({ search: "", pathname: "/crypto/BTC", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/components/finance/PageHeader", () => ({
  default: ({ title }: { title: string }) => <header>{title}</header>,
}));
vi.mock("@/components/markets/LiveChart", () => ({ default: () => <div data-testid="live-chart" /> }));

const emptyHistory: UseAnalysisHistoryResult = {
  ...initialHistoryState,
  loadMore: vi.fn(),
  refresh: vi.fn(),
  refreshHead: vi.fn(),
  upsert: vi.fn(),
};

const snapshot: MarketsSnapshot = {
  generated_at: "2026-10-02T16:00:00Z",
  shadow_mode: true,
  enabled_venues: ["coinbase", "kraken"],
  symbols: ["BTC-USD", "ETH-USD"],
  latest_events: [],
  latest_classifications: [],
};

function trade(venue: string, symbol: string, price: number, second: number, eventId?: string): MarketEvent {
  const at = new Date(Date.UTC(2026, 9, 2, 16, 0, second)).toISOString();
  return {
    event_id: eventId ?? `${venue}-${symbol}-trade-${second}`,
    venue,
    symbol,
    native_symbol: symbol,
    base_asset: symbol.split("-")[0],
    quote_asset: symbol.split("-")[1] ?? "",
    instrument_kind: "spot",
    event_type: "trade",
    exchange_timestamp: at,
    received_timestamp: new Date(Date.parse(at) + 45).toISOString(),
    sequence: second,
    price,
    size: 1,
    side: "buy",
    bid: null,
    ask: null,
    payload_hash: "fixture",
    metadata: {},
  };
}

function snapshotState(events: MarketEvent[]): MarketsState {
  return marketsReducer(initialMarketsState(), {
    type: "snapshot",
    snapshot: { ...snapshot, latest_events: events },
  });
}

let setMarketState: ((update: (state: MarketsState) => MarketsState) => void) | null = null;

function WorkspaceBridge({ history, children }: { history: UseAnalysisHistoryResult; children: ReactNode }) {
  const markets = useProviderMarkets();
  const workspace: WorkspaceValue = {
    history,
    capabilities: { status: "loading", capabilities: null, error: null, reload: vi.fn() } satisfies UseCapabilitiesResult,
    markets,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    focusSearch: vi.fn(),
    searchInputRef: { current: null } as WorkspaceValue["searchInputRef"],
    openSidebar: vi.fn(),
  };
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

function MarketHarness({
  initialState,
  children,
  history = emptyHistory,
}: {
  initialState: MarketsState;
  children: ReactNode;
  history?: UseAnalysisHistoryResult;
}) {
  const [state, setState] = useState(initialState);
  useEffect(() => {
    setMarketState = setState;
    return () => {
      setMarketState = null;
    };
  }, []);
  const result: UseMarketsResult = {
    state,
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
  return (
    <MarketsProvider value={result}>
      <WorkspaceBridge history={history}>{children}</WorkspaceBridge>
    </MarketsProvider>
  );
}

function asset() {
  const instrumentParam = new URLSearchParams(navigation.search).get("instrument") ?? undefined;
  return <CryptoAssetView base="BTC" instrumentParam={instrumentParam} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
  localStorage.clear();
  navigation.search = "";
  navigation.pathname = "/crypto/BTC";
  navigation.push.mockReset();
  setMarketState = null;
});

describe("CryptoAssetView browser-only watchlist and alerts", () => {
  it("persists a star for the selected instrument", () => {
    render(
      <MarketHarness
        initialState={snapshotState([
          trade("coinbase", "BTC-USD", 100, 1),
          trade("kraken", "BTC-USD", 99, 1),
        ])}
      >
        {asset()}
      </MarketHarness>,
    );
    const section = screen.getByRole("region", { name: /Venues/ });
    const krakenRow = within(section).getByRole("row", { name: /kraken/ });
    expect(within(section).getByRole("row", { name: /coinbase/ }).getAttribute("aria-selected")).toBe("true");
    expect(krakenRow.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "kraken · BTC-USD" }));
    fireEvent.click(screen.getByRole("button", { name: "Add BTC-USD on kraken to watchlist" }));
    expect(screen.getByRole("button", { name: "Remove BTC-USD on kraken from watchlist" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("baystfirm.markets.watchlist.v1")).toBe(JSON.stringify(["kraken|BTC-USD"]));
    expect(krakenRow.getAttribute("aria-selected")).toBe("true");
  });

  it("honors the instrument query and still allows choosing another venue", () => {
    navigation.search = "?instrument=kraken%7CBTC-USD";
    render(
      <MarketHarness
        initialState={snapshotState([
          trade("coinbase", "BTC-USD", 100, 1),
          trade("kraken", "BTC-USD", 99, 1),
        ])}
      >
        {asset()}
      </MarketHarness>,
    );
    const section = screen.getByRole("region", { name: /Venues/ });
    expect(within(section).getByRole("row", { name: /kraken/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(section).getByRole("row", { name: /coinbase/ }));
    expect(within(section).getByRole("row", { name: /coinbase/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("filters venues to the selected base and switches market tabs", () => {
    render(
      <MarketHarness
        initialState={snapshotState([
          trade("coinbase", "BTC-USD", 100, 1),
          trade("kraken", "ETH-USD", 20, 1),
        ])}
      >
        {asset()}
      </MarketHarness>,
    );
    const section = screen.getByRole("region", { name: /Venues/ });
    expect(within(section).getByRole("row", { name: /BTC-USD/ })).toBeTruthy();
    expect(within(section).queryByRole("row", { name: /ETH-USD/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Derivatives" }));
    expect(screen.getByRole("tab", { name: "Derivatives" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Derivatives");
  });

  it("explains when a base is absent from loaded exchange feeds", () => {
    render(
      <MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])}>
        <CryptoAssetView base="UNKNOWN" />
      </MarketHarness>,
    );
    expect(screen.getByText("UNKNOWN isn’t on our exchange feeds yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search for UNKNOWN" })).toBeTruthy();
  });

  it("navigates from the sidebar watchlist to the matching crypto detail", () => {
    localStorage.setItem("baystfirm.markets.watchlist.v1", JSON.stringify(["coinbase|BTC-USD"]));
    navigation.search = `?instrument=${encodeURIComponent("coinbase|BTC-USD")}`;
    const onNavigate = vi.fn();
    render(
      <MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])}>
        <HistorySidebar history={emptyHistory} onNavigate={onNavigate} />
      </MarketHarness>,
    );
    fireEvent.click(screen.getByRole("button", { name: "BTC-USD · coinbase" }));
    expect(navigation.push).toHaveBeenCalledWith("/crypto/BTC?instrument=coinbase%7CBTC-USD");
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("updates the sidebar watchlist immediately when starring an instrument", async () => {
    render(
      <MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])}>
        <>
          {asset()}
          <HistorySidebar history={emptyHistory} />
        </>
      </MarketHarness>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add BTC-USD on coinbase to watchlist" }));
    expect(await screen.findByRole("button", { name: "BTC-USD · coinbase" })).toBeTruthy();
  });

  it("adds a price rule and shows its firing after streamed prices cross the threshold", async () => {
    render(<MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 90, 1)])}>{asset()}</MarketHarness>);
    fireEvent.click(screen.getByRole("tab", { name: "Alerts" }));
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add alert" }));
    expect(screen.getByText("Watching")).toBeTruthy();

    act(() => {
      setMarketState!((current) =>
        marketsReducer(current, {
          type: "stream",
          events: [trade("coinbase", "BTC-USD", 101, 2, "price-cross-event")],
          classifications: [],
        }),
      );
    });

    expect(await screen.findByText("BTC-USD on coinbase last price crossed above 100.000.")).toBeTruthy();
    expect(screen.getByText(/Observed 101\.000 · Source price-cross-event/)).toBeTruthy();
  });

  it("hides watchlist and alerts controls when the feature flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", undefined);
    render(<MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])}>{asset()}</MarketHarness>);
    const section = screen.getByRole("region", { name: /Venues/ });
    expect(within(section).queryByRole("button", { name: /watchlist/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Alerts" })).toBeNull();
  });

  it("keeps sidebar watchlist rows hidden when the feature flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", undefined);
    localStorage.setItem("baystfirm.markets.watchlist.v1", JSON.stringify(["coinbase|BTC-USD"]));
    render(
      <MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])}>
        <HistorySidebar history={emptyHistory} />
      </MarketHarness>,
    );
    expect(screen.queryByRole("button", { name: "BTC-USD · coinbase" })).toBeNull();
  });
});
