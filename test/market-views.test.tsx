/** @vitest-environment jsdom */
/**
 * The main window and the live view as components: the honest empty states
 * when the backend sends no price series or quarterly figures (the current,
 * web-search-only backend), the charts and their table alternatives when data
 * is present, and the live view's source page, which shows an excerpt only
 * when the source's terms allow it.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveView, { readNote } from "@/components/finance/analysis/LiveView";
import MainWindow, { type MainMode } from "@/components/finance/analysis/MainWindow";
import { liveSources, researchFeed, sourceKey, liveTarget, type LiveSource, type LiveTarget } from "@/lib/analysis/activity";
import { applyEvents, initialAnalysisState, type AnalysisViewState } from "@/lib/analysis/reducer";
import type { AnalysisEvent } from "@/lib/api/types";
import { marketData, NO_PRICE_HISTORY, NO_QUARTERLY_FIGURES, symbolIdentity } from "@/lib/market/model";
import type { RangeKey } from "@/lib/market/series";
import { LIVE_EVENTS, MARKET_EVENTS, linearPoints, syntheticSeries, tradingDays } from "./fixtures/live";

afterEach(cleanup);

/* jsdom has no layout: report a fixed box so the charts render their SVG */
class FixedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback([], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FixedResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 720, height: 320, top: 0, left: 0, right: 720, bottom: 320, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});

function Harness({ state, initialMode = "performance" }: { state: AnalysisViewState; initialMode?: MainMode }) {
  const [mode, setMode] = useState<MainMode>(initialMode);
  const [range, setRange] = useState<RangeKey>("1M");
  const [table, setTable] = useState(false);
  return (
    <MainWindow
      state={state}
      identity={symbolIdentity(state)}
      market={marketData(state)}
      sources={liveSources(state)}
      mode={mode}
      onMode={setMode}
      range={range}
      onRange={setRange}
      table={table}
      onTable={() => setTable(!table)}
      watched={false}
      onWatch={() => {}}
      onPickSource={() => {}}
      dock={null}
    />
  );
}

const webOnly = applyEvents(initialAnalysisState, LIVE_EVENTS);

describe("without price series or quarterly figures (web search only)", () => {
  it("says so in the Company performance area, with no price, tiles or charts", () => {
    render(<Harness state={webOnly} />);
    expect(screen.getByText(NO_QUARTERLY_FIGURES)).toBeTruthy();
    expect(NO_QUARTERLY_FIGURES).toBe("No quarterly figures — web search didn't return a page with this company's quarterly results.");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("list", { name: "Performance" })).toBeNull();
    expect(screen.queryByText(/Last close/)).toBeNull();
    const range = screen.getByRole("group", { name: "Time range" });
    expect(within(range).getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole("button", { name: "Table" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so in the Trading view", () => {
    render(<Harness state={webOnly} initialMode="trading" />);
    expect(screen.getByText(NO_PRICE_HISTORY)).toBeTruthy();
    expect(NO_PRICE_HISTORY).toBe("No price history — web search didn't return a page with this company's daily prices.");
    expect(screen.queryByText(/^O /)).toBeNull();
  });

  it("switches between the two messages with the mode control", () => {
    render(<Harness state={webOnly} />);
    fireEvent.click(screen.getByRole("button", { name: "Trading view" }));
    expect(screen.getByRole("button", { name: "Trading view" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(NO_PRICE_HISTORY)).toBeTruthy();
    expect(screen.queryByText(NO_QUARTERLY_FIGURES)).toBeNull();
  });

  it("names the company by its symbol when the backend sent no name", () => {
    const nameless = applyEvents(initialAnalysisState, LIVE_EVENTS.map((e) => (e.event === "instrument.resolved" ? ({ ...e, name: "" } as AnalysisEvent) : e)));
    render(<Harness state={nameless} />);
    const row = screen.getByText("EXHL").parentElement!;
    expect(row.textContent).not.toContain("Example Holdings");
  });
});

describe("with optional market data", () => {
  const long = syntheticSeries("company", "EXHL", linearPoints(tradingDays(300), 100, 0.5));
  const withMarket = applyEvents(webOnly, [{ ...MARKET_EVENTS[0], ...long } as AnalysisEvent, MARKET_EVENTS[1], MARKET_EVENTS[2]]);

  it("draws the comparison, tiles and financials, with tables as the alternative", () => {
    render(<Harness state={withMarket} />);
    expect(screen.queryByText(NO_QUARTERLY_FIGURES)).toBeNull();
    expect(screen.getByRole("img", { name: /^Percent change over the past month: EXHL \+/ })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Performance" })).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText(/Last close Sep 25, 2026 · daily data, not live/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Revenue by quarter from Q1 2026 to Q2 2026/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("img", { name: /^Percent change/ })).toBeNull();
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(within(tables[1]).getAllByRole("row")).toHaveLength(3);
  });

  it("draws candles in the Trading view with the OHLC readout, and an OHLC table", () => {
    render(<Harness state={withMarket} initialMode="trading" />);
    expect(screen.getByRole("img", { name: /^EXHL daily candles over the past month, last close 249\.50$/ })).toBeTruthy();
    expect(screen.getByText(/^Daily · Sep 25, 2026$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "6M" }));
    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    expect(screen.getByRole("img", { name: /weekly candles over the past year/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Period", "Open", "High", "Low", "Close"]);
  });
});

describe("the live view's source page", () => {
  const state = webOnly;
  const items = researchFeed(state);
  const sources = liveSources(state);
  const renderTarget = (target: LiveTarget) => render(<LiveView state={state} target={target} pinned live={false} onBack={() => {}} />);
  const sourceTarget = (id: string) => liveTarget(state, items, sources, sourceKey(id)).target;

  it("shows the captured excerpt when the terms allow redistribution", () => {
    renderTarget(sourceTarget("src_kept"));
    expect(screen.getByText("Captured for the analysis")).toBeTruthy();
    expect(screen.getByText("The company raised its full-year outlook.")).toBeTruthy();
    expect(screen.getByText("Read 4,180 characters in 1.2 s")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to summary" })).toBeTruthy();
  });

  it("hides the excerpt and says why when the terms don't allow it", () => {
    renderTarget(sourceTarget("src_meta"));
    expect(screen.getByText("Excerpt not shown: this source's terms don't allow redistribution.")).toBeTruthy();
    expect(screen.queryByText("Captured for the analysis")).toBeNull();
    expect(document.body.textContent).not.toContain("Text the terms do not allow to redistribute.");
  });

  it("never shows an excerpt without known terms", () => {
    const source: LiveSource = { ...(sources.get("src_kept") as LiveSource), redistribution: null, excerpt: null };
    renderTarget({ kind: "source", key: "k", source });
    expect(screen.getByText("Excerpt not shown: this source's redistribution terms aren't known.")).toBeTruthy();
  });

  it("explains a rejected page and a budget skip in plain English", () => {
    const rejected = items.find((i) => i.kind === "rejected")!;
    renderTarget(liveTarget(state, items, sources, rejected.key).target);
    expect(screen.getByText("Not used · paywalled")).toBeTruthy();
    cleanup();
    const budget = items.find((i) => i.kind === "skipped" && i.skip.reason === "budget")!;
    renderTarget(liveTarget(state, items, sources, budget.key).target);
    expect(screen.getByText("Not used · budget reached")).toBeTruthy();
  });

  it("shows a failed search as failed, not as zero results", () => {
    const failed = items.filter((i) => i.kind === "search")[1];
    renderTarget(liveTarget(state, items, sources, failed.key).target);
    expect(screen.getAllByText("Search failed").length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 results/)).toBeNull();
  });

  it("marks search hits with what became of them", () => {
    const search = items.find((i) => i.kind === "search")!;
    renderTarget(liveTarget(state, items, sources, search.key).target);
    expect(screen.getByText("12 results · top 5 shown")).toBeTruthy();
    const hit = screen.getByText("Example Holdings raises its outlook").closest("li")!;
    expect(hit.textContent).toContain("Kept");
    expect(screen.getByText("Subscriber story on Example Holdings").closest("li")!.textContent).toContain("Skipped");
    expect(screen.getByText("An unvisited hit").closest("li")!.textContent).not.toMatch(/Kept|Skipped|Reading/);
  });

  it("formats the read note from the measured figures only", () => {
    expect(readNote(1834, 12000)).toBe("Read 12,000 characters in 1.8 s");
    expect(readNote(600, null)).toBe("Loaded in 0.6 s");
    expect(readNote(null, null)).toBeNull();
  });
});
