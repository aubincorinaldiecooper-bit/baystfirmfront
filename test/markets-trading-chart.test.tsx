/** @vitest-environment jsdom */
/**
 * The Markets candlestick chart: indicator outputs from the backend are paired
 * with the candles they were computed on (warm-up nulls dropped, misaligned
 * arrays never plotted), toggling an indicator asks the backend for it, and
 * RSI/MACD go to their own panes under the price pane.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveChart from "@/components/markets/LiveChart";
import { chartPanes, continuesHistory } from "@/components/markets/TradingChart";
import { fetchCandles } from "@/lib/markets/client";
import { chartLines, indicatorPoints } from "@/lib/markets/indicators";
import type { CandleBar, CandleResponse } from "@/lib/markets/types";

const chartMock = vi.hoisted(() => {
  const series = () => ({ setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), createPriceLine: vi.fn() });
  const chart = {
    addSeries: vi.fn((..._args: unknown[]) => series()),
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
