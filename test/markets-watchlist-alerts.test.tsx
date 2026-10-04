/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import HistorySidebar from "@/components/finance/HistorySidebar";
import type { UseAnalysisHistoryResult } from "@/lib/api/history";
import MarketsView from "@/components/markets/MarketsView";
import { useMarkets, type UseMarketsResult } from "@/lib/markets/useMarkets";
import { initialMarketsState, marketsReducer, type MarketsState } from "@/lib/markets/state";
import type { MarketEvent, MarketsSnapshot } from "@/lib/markets/types";
import { initialHistoryState } from "@/lib/api/history";

const navigation = vi.hoisted(() => ({ search: "", pathname: "/markets", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/lib/markets/useMarkets", () => ({ useMarkets: vi.fn() }));
vi.mock("@/components/markets/LiveChart", () => ({ default: () => <div data-testid="live-chart" /> }));
vi.mock("@/components/finance/PageHeader", () => ({
  default: ({ title }: { title: string }) => <header>{title}</header>,
}));

const mockUseMarkets = vi.mocked(useMarkets);
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
    quote_asset: symbol.split("-")[1],
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

let setMarketState: Dispatch<SetStateAction<MarketsState>> | null = null;

function MarketHarness({ initialState }: { initialState: MarketsState }) {
  const [state, setState] = useState(initialState);
  useEffect(() => {
    setMarketState = setState;
  }, [setState]);
  const result: UseMarketsResult = {
    state,
    snapshot,
    snapshotError: null,
    gate: null,
    gateError: null,
    stream: "live",
    reload: vi.fn(),
  };
  mockUseMarkets.mockReturnValue(result);
  return <MarketsView />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
  localStorage.clear();
  navigation.search = "";
  navigation.pathname = "/markets";
  navigation.push.mockReset();
  setMarketState = null;
  mockUseMarkets.mockReset();
});

describe("MarketsView browser-only watchlist and alerts", () => {
  it("persists a star without selecting its row and filters to watched instruments", () => {
    render(
      <MarketHarness
        initialState={snapshotState([
          trade("coinbase", "BTC-USD", 100, 1),
          trade("kraken", "ETH-USD", 20, 1),
        ])}
      />,
    );
    const section = screen.getByRole("region", { name: /Instruments/ });
    const ethRow = within(section).getByRole("row", { name: /ETH-USD/ });
    expect(ethRow.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Add ETH-USD on kraken to watchlist" }));
    expect(screen.getByRole("button", { name: "Remove ETH-USD on kraken from watchlist" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("baystfirm.markets.watchlist.v1")).toBe(JSON.stringify(["kraken|ETH-USD"]));
    expect(within(section).getByRole("row", { name: /ETH-USD/ }).getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Watchlist (1)" }));
    const filteredTable = within(section).getByRole("table");
    expect(within(filteredTable).getByRole("row", { name: /ETH-USD/ })).toBeTruthy();
    expect(within(filteredTable).queryByRole("row", { name: /BTC-USD/ })).toBeNull();
  });

  it("shows the exact empty-watchlist message", () => {
    render(<MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])} />);
    fireEvent.click(screen.getByRole("button", { name: "Watchlist (0)" }));
    expect(
      screen.getByText("No instruments starred yet. Star a row to keep it here (saved in this browser only)."),
    ).toBeTruthy();
  });

  it("preselects the requested instrument and still allows selecting another row", () => {
    navigation.search = "?instrument=kraken%7CETH-USD";
    render(
      <MarketHarness
        initialState={snapshotState([
          trade("coinbase", "BTC-USD", 100, 1),
          trade("kraken", "ETH-USD", 20, 1),
        ])}
      />,
    );
    const section = screen.getByRole("region", { name: /Instruments/ });
    expect(within(section).getByRole("row", { name: /ETH-USD/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(section).getByRole("row", { name: /BTC-USD/ }).getAttribute("aria-selected")).toBe("false");

    fireEvent.click(within(section).getByRole("row", { name: /BTC-USD/ }));
    expect(within(section).getByRole("row", { name: /BTC-USD/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("lists local watchlist items in the sidebar and navigates with the encoded key", async () => {
    const key = "binanceus|BTC-USDT";
    localStorage.setItem("baystfirm.markets.watchlist.v1", JSON.stringify([key]));
    navigation.search = `?instrument=${encodeURIComponent(key)}`;
    const onNavigate = vi.fn();
    render(<HistorySidebar history={emptyHistory} onNavigate={onNavigate} />);

    const item = await screen.findByRole("button", { name: "BTC-USDT · Binance.US" });
    expect(item.getAttribute("aria-current")).toBe("true");
    fireEvent.click(item);
    expect(navigation.push).toHaveBeenCalledWith("/markets?instrument=binanceus%7CBTC-USDT");
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("shows the watchlist empty state in the sidebar", () => {
    render(<HistorySidebar history={emptyHistory} />);
    expect(screen.getByText("Star instruments on Markets to see them here")).toBeTruthy();
  });

  it("updates the sidebar watchlist immediately when starring an instrument", async () => {
    render(
      <>
        <MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 100, 1)])} />
        <HistorySidebar history={emptyHistory} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add BTC-USD on coinbase to watchlist" }));
    expect(await screen.findByRole("button", { name: "BTC-USD · coinbase" })).toBeTruthy();
  });

  it("adds a price rule and shows its firing after streamed prices cross the threshold", async () => {
    render(<MarketHarness initialState={snapshotState([trade("coinbase", "BTC-USD", 90, 1)])} />);
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

  it("hides watchlist and alerts UI when the feature flag is unset without disabling selection", () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", undefined);
    navigation.search = "?instrument=kraken%7CETH-USD";
    render(
      <MarketHarness
        initialState={snapshotState([
          trade("coinbase", "BTC-USD", 100, 1),
          trade("kraken", "ETH-USD", 20, 1),
        ])}
      />,
    );

    const section = screen.getByRole("region", { name: /Instruments/ });
    expect(within(section).getByRole("row", { name: /ETH-USD/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(section).queryByRole("group", { name: "Instrument filter" })).toBeNull();
    expect(within(section).queryByRole("button", { name: /watchlist/i })).toBeNull();
    expect(within(section).queryByText("Watchlist")).toBeNull();
    expect(screen.queryByRole("region", { name: "Alerts" })).toBeNull();
  });

  it("does not render the sidebar watchlist when the feature flag is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", undefined);
    localStorage.setItem("baystfirm.markets.watchlist.v1", JSON.stringify(["coinbase|BTC-USD"]));
    render(<HistorySidebar history={emptyHistory} />);

    expect(screen.queryByRole("button", { name: "BTC-USD · coinbase" })).toBeNull();
    expect(screen.queryByText("Star instruments on Markets to see them here")).toBeNull();
  });
});
