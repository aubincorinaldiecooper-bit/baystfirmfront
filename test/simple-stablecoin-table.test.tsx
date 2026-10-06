/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SimpleStablecoinTable from "@/components/markets/SimpleStablecoinTable";
import { initialMarketsState, marketsReducer } from "@/lib/markets/state";
import type { MarketEvent, MarketsSnapshot } from "@/lib/markets/types";

const AT = new Date().toISOString();

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

function marketState(events: MarketEvent[]) {
  const snapshot: MarketsSnapshot = {
    generated_at: AT,
    shadow_mode: true,
    enabled_venues: [...new Set(events.map((event) => event.venue))],
    symbols: [...new Set(events.map((event) => event.symbol))],
    latest_events: events,
    latest_classifications: [],
  };
  return marketsReducer(initialMarketsState(), { type: "snapshot", snapshot });
}

function renderTable(events: MarketEvent[]) {
  return render(
    <SimpleStablecoinTable
      marketState={marketState(events)}
      snapshotLoaded
      snapshotError={null}
      reload={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("SimpleStablecoinTable", () => {
  it("omits stablecoins that have no readings", () => {
    renderTable([trade("coinbase", "BTC-USD", 85_000)]);

    expect(screen.getByText("No recent stablecoin spot readings are available.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /USDT/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /FDUSD/ })).toBeNull();
  });

  it("counts a fresh non-USD venue for a coin priced in USDT", () => {
    renderTable([trade("coinbase", "USDE-USDT", 0.9997)]);

    const row = screen.getByRole("row", { name: /USDE/ });
    expect(within(row).getByText("1 (priced in USDT)")).toBeTruthy();
  });

  it("labels one USD venue as unable to cross-check", () => {
    renderTable([trade("coinbase", "DAI-USD", 0.9999)]);

    const row = screen.getByRole("row", { name: /DAI/ });
    expect(within(row).getByText("1 (can't cross-check)")).toBeTruthy();
  });
});
