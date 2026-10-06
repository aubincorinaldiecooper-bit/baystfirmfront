/** @vitest-environment jsdom */
/**
 * The Markets candlestick chart: indicator outputs from the backend are paired
 * with the candles they were computed on (warm-up nulls dropped, misaligned
 * arrays never plotted), toggling an indicator asks the backend for it, and
 * RSI/MACD go to their own panes under the price pane.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CandleChartPanel from "@/components/markets/CandleChartPanel";
import LiveChart from "@/components/markets/LiveChart";
import { chartPanes, continuesHistory } from "@/components/markets/TradingChart";
import { fetchCandles, fetchTokenCandles } from "@/lib/markets/client";
import { chartLines, indicatorPoints } from "@/lib/markets/indicators";
import { stablecoinReferenceLines } from "@/lib/markets/stablecoins";
import { SOLANA_CANDLE_INTERVALS, type CandleBar, type CandleInterval, type CandleResponse } from "@/lib/markets/types";

const chartMock = vi.hoisted(() => {
  const series = () => ({ setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), createPriceLine: vi.fn() });
  const chart = {
    addSeries: vi.fn<(...args: unknown[]) => ReturnType<typeof series>>(() => series()),
    removeSeries: vi.fn(),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    remove: vi.fn(),
    panes: vi.fn(() => []),
    timeScale: vi.fn(() => ({ scrollToRealTime: vi.fn() })),
  };
  return { chart };
});

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => chartMock.chart),
  CandlestickSeries: { type: "Candlestick" },
  LineSeries: { type: "Line" },
  HistogramSeries: { type: "Histogram" },
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0 },
  LineStyle: { Dashed: 2 },
}));

afterEach(cleanup);

function bar(openTime: number, close = 100): CandleBar {
  return { open_time: openTime, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

function response(overrides: Partial<CandleResponse> = {}): CandleResponse {
  return {
    venue: "coinbase",
    symbol: "BTC-USD",
    interval: "1m",
    source_url_template: "https://example.test",
    fetched_at: "2026-10-04T16:00:00Z",
    aggregated_from: null,
    candles: [bar(60_000), bar(120_000), bar(180_000)],
    stale: false,
    truncated: false,
    ...overrides,
  };
}

describe("indicator series", () => {
  it("pairs values with candle open times and drops warm-up nulls", () => {
    const data = response({ indicators: { "sma:20": { value: [null, 101.5, 102] } } });
    expect(indicatorPoints(data, "sma:20", "value")).toEqual([
      { time: 120, value: 101.5 },
      { time: 180, value: 102 },
    ]);
  });

  it("plots nothing when the output is missing or misaligned", () => {
    expect(indicatorPoints(response(), "sma:20", "value")).toEqual([]);
    const misaligned = response({ indicators: { "sma:20": { value: [1, 2] } } });
    expect(indicatorPoints(misaligned, "sma:20", "value")).toEqual([]);
  });

  it("splits MACD into histogram, MACD and signal lines on the MACD pane", () => {
    const data = response({
      indicators: {
        "sma:50": { value: [null, null, 99] },
        "macd:12,26,9": { macd: [null, 1, 2], signal: [null, null, 1.5], histogram: [null, null, 0.5] },
      },
    });
    const lines = chartLines(data, ["macd:12,26,9", "sma:50"]);
    expect(lines.map((line) => [line.id, line.pane, line.style])).toEqual([
      ["sma:50", "price", "line"],
      ["macd:12,26,9/histogram", "macd", "histogram"],
      ["macd:12,26,9/macd", "macd", "line"],
      ["macd:12,26,9/signal", "macd", "line"],
    ]);
    expect(chartPanes(lines)).toEqual(["price", "macd"]);
    expect(chartLines(null, ["sma:50"])).toEqual([]);
  });
});

describe("live candle updates", () => {
  it("treats a changed or appended last bar as a continuation", () => {
    const history = [bar(60_000), bar(120_000)];
    expect(continuesHistory(history, [bar(60_000), bar(120_000, 105)])).toBe(true);
    expect(continuesHistory(history, [...history, bar(180_000)])).toBe(true);
    expect(continuesHistory([], history)).toBe(false);
    expect(continuesHistory(history, [bar(120_000), bar(180_000)])).toBe(false);
    expect(continuesHistory(history, [...history, bar(180_000), bar(240_000)])).toBe(false);
  });
});

describe("fetchCandles", () => {
  it("requests each indicator as a repeated query parameter", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response()), { status: 200 }));
    await fetchCandles("coinbase", "BTC-USD", "1h", fetchImpl as unknown as typeof fetch, undefined, ["sma:20", "rsi:14"]);
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("/api/markets/candles?venue=coinbase&symbol=BTC-USD&interval=1h&limit=300&indicator=sma%3A20&indicator=rsi%3A14");
  });

  it("requests token candles with their interval and repeated backend indicators", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response({ venue: "geckoterminal", interval: "1h" })), { status: 200 }));
    await fetchTokenCandles("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "1h", fetchImpl as unknown as typeof fetch, undefined, [
      "sma:20",
      "rsi:14",
    ]);
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toBe(
      "/api/markets/solana/tokens/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/candles?interval=1h&limit=300&indicator=sma%3A20&indicator=rsi%3A14",
    );
  });
});

describe("shared token candlestick panel", () => {
  it("uses token intervals, forwards interval changes, and retains GeckoTerminal attribution", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const loadCandles = vi.fn(async (interval: CandleInterval) =>
      response({
        venue: "geckoterminal",
        symbol: "Bonk",
        interval,
        source_url_template: "https://www.geckoterminal.com/solana/pools/{pool}",
      }),
    );
    render(
      <CandleChartPanel
        title="BONK in USD"
        venue="geckoterminal"
        symbol="BONK"
        venueName="GeckoTerminal"
        loadCandles={loadCandles}
        intervals={SOLANA_CANDLE_INTERVALS}
        initialInterval="1h"
        showLastPrice={false}
        attribution={() => <p>GeckoTerminal pool chart · USD</p>}
      />,
    );
    await waitFor(() => expect(loadCandles).toHaveBeenCalledTimes(1));
    expect(loadCandles.mock.calls[0][0]).toBe("1h");
    expect(screen.getAllByRole("group", { name: "Candle interval" })[0].querySelectorAll("button")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    await waitFor(() => expect(loadCandles).toHaveBeenCalledTimes(2));
    expect(loadCandles.mock.calls[1][0]).toBe("15m");
    expect(await screen.findByText("GeckoTerminal pool chart · USD")).toBeTruthy();
  });

  it("shows a stale-cache notice for cached GeckoTerminal candles", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const loadCandles = vi.fn(async () =>
      response({
        venue: "geckoterminal",
        symbol: "BONK",
        stale: true,
        error: "upstream unavailable",
      }),
    );
    render(
      <CandleChartPanel
        title="BONK in USD"
        venue="geckoterminal"
        symbol="BONK"
        loadCandles={loadCandles}
        intervals={SOLANA_CANDLE_INTERVALS}
        initialInterval="1h"
        staleMessage={() => "GeckoTerminal could not be reached; showing its cached candle history."}
      />,
    );
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("GeckoTerminal could not be reached; showing its cached candle history.");
  });

  it("reports token candle errors without substituting another source", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <CandleChartPanel
        title="BONK in USD"
        venue="geckoterminal"
        symbol="BONK"
        loadCandles={async () => {
          throw new Error("GeckoTerminal is rate-limited or unavailable.");
        }}
        intervals={SOLANA_CANDLE_INTERVALS}
        initialInterval="1h"
        venueName="GeckoTerminal"
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Candle history could not be loaded: GeckoTerminal is rate-limited or unavailable.",
    );
    expect(screen.getByText("Candles from GeckoTerminal public API are unavailable.")).toBeTruthy();
  });
});

describe("stablecoin chart reference line", () => {
  it("draws the $1 guide for a USDT-USD chart but not BTC-USD", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    chartMock.chart.addSeries.mockClear();
    const stablecoin = render(
      <CandleChartPanel
        title="USDT-USD"
        venue="coinbase"
        symbol="USDT-USD"
        referenceLines={stablecoinReferenceLines("USDT", "USD")}
      />,
    );
    await waitFor(() => expect(chartMock.chart.addSeries).toHaveBeenCalled());
    const stablecoinSeries = chartMock.chart.addSeries.mock.results[0]?.value as {
      createPriceLine: ReturnType<typeof vi.fn>;
      applyOptions: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(stablecoinSeries.createPriceLine).toHaveBeenCalledWith(
        expect.objectContaining({
          price: 1,
          title: "$1",
          axisLabelVisible: true,
          lineStyle: 2,
        }),
      ),
    );
    const autoscaleOptions = stablecoinSeries.applyOptions.mock.calls
      .map(([options]) => options as { autoscaleInfoProvider?: unknown })
      .find((options) => typeof options.autoscaleInfoProvider === "function");
    expect(autoscaleOptions).toBeDefined();
    const autoscaleInfoProvider = autoscaleOptions?.autoscaleInfoProvider as (
      baseImplementation: () => { priceRange: { minValue: number; maxValue: number } },
    ) => { priceRange: { minValue: number; maxValue: number } };
    const autoscaled = autoscaleInfoProvider(() => ({
      priceRange: { minValue: 0.99965, maxValue: 0.9999 },
    }));
    expect(autoscaled.priceRange.minValue).toBe(0.99965);
    expect(autoscaled.priceRange.maxValue).toBe(1);

    stablecoin.unmount();
    chartMock.chart.addSeries.mockClear();
    render(
      <CandleChartPanel
        title="BTC-USD"
        venue="coinbase"
        symbol="BTC-USD"
        referenceLines={stablecoinReferenceLines("BTC", "USD")}
      />,
    );
    await waitFor(() => expect(chartMock.chart.addSeries).toHaveBeenCalled());
    const bitcoinSeries = chartMock.chart.addSeries.mock.results[0]?.value as {
      createPriceLine: ReturnType<typeof vi.fn>;
      applyOptions: ReturnType<typeof vi.fn>;
    };
    expect(bitcoinSeries.createPriceLine).not.toHaveBeenCalled();
    expect(
      bitcoinSeries.applyOptions.mock.calls.some(
        ([options]) => typeof (options as { autoscaleInfoProvider?: unknown }).autoscaleInfoProvider === "function",
      ),
    ).toBe(false);
  });
});

describe("LiveChart", () => {
  beforeEach(() => {
    chartMock.chart.addSeries.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("requests RSI when toggled and draws it on a pane under the price pane", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("indicator=rsi")
        ? response({ indicators: { "rsi:14": { value: [null, 40, 60] } } })
        : response();
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveChart title="BTC-USD on Coinbase" venue="coinbase" symbol="BTC-USD" ticks={[]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "RSI 14" }));
    expect(screen.getByRole("button", { name: "RSI 14" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(String(fetchMock.mock.calls[1]?.[0])).toContain("indicator=rsi%3A14"));
    await waitFor(() =>
      expect(chartMock.chart.addSeries.mock.calls.some((call) => (call[0] as { type: string }).type === "Line" && call[2] === 1)).toBe(true),
    );
    expect(await screen.findByText(/Indicators computed by the Baystfirm backend/)).toBeTruthy();
  });
});
