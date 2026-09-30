/**
 * Price-series math for the (optional) market views: candle aggregation,
 * indexed change and cross-series alignment, performance tiles, the 52-week
 * range and average volume, axis ticks, key stats and display formatting.
 * Inputs are small synthetic series built in each test.
 */
import { describe, expect, it } from "vitest";
import { keyStats } from "@/lib/market/keyStats";
import { formatClock, formatCompact, formatDay, formatDuration, formatMoney, formatPct, formatPctTick, formatSigned, hostOf, pathOf } from "@/lib/market/format";
import {
  aggregateCandles,
  averageVolume,
  compareSeries,
  fiftyTwoWeekRange,
  indexedChange,
  lastClose,
  niceTicks,
  percentChange,
  performanceTiles,
  toBars,
  weekStart,
  type Bar,
} from "@/lib/market/series";
import type { PricePoint } from "@/lib/api/types";
import { linearPoints, syntheticSeries, tradingDays } from "./fixtures/live";

const bar = (date: string, open: number | null, high: number | null, low: number | null, close: number, volume: number | null = null): Bar => ({
  date,
  open,
  high,
  low,
  close,
  volume,
});

describe("toBars", () => {
  it("keeps valid rows, oldest first, one per date", () => {
    const points = [
      ["2026-09-02", 1, 2, 0.5, 1.5, 10],
      ["2026-09-01", 1, 2, 0.5, 1.2, 10],
      ["bad-date", 1, 1, 1, 1, 1],
      ["2026-09-03", null, null, null, 0, null],
      ["2026-09-02", 1, 2, 0.5, 1.7, 12],
    ] as unknown as PricePoint[];
    expect(toBars(points).map((b) => [b.date, b.close])).toEqual([
      ["2026-09-01", 1.2],
      ["2026-09-02", 1.7],
    ]);
  });
});

describe("aggregateCandles", () => {
  /* Mon 2026-09-07 … Fri 2026-09-18, then Mon 2026-10-05 */
  const bars = [
    bar("2026-09-07", 10, 12, 9, 11, 100),
    bar("2026-09-08", 11, 13, 10, 12, 200),
    bar("2026-09-11", 12, 12.5, 8, 9, null),
    bar("2026-09-14", 9, 10, 8.5, 9.5, 50),
    bar("2026-09-18", 9.5, 11, 9, 10.5, 50),
    bar("2026-10-05", null, null, null, 20, 5),
  ];

  it("daily: one candle per row, close-only rows use the close for open/high/low", () => {
    const daily = aggregateCandles(bars, "daily");
    expect(daily).toHaveLength(6);
    expect(daily[0]).toEqual({ start: "2026-09-07", end: "2026-09-07", open: 10, high: 12, low: 9, close: 11, volume: 100, rows: 1 });
    expect(daily[5]).toMatchObject({ open: 20, high: 20, low: 20, close: 20 });
  });

  it("weekly: calendar weeks from Monday, first open, last close, extremes, summed volume", () => {
    const weekly = aggregateCandles(bars, "weekly");
    expect(weekly.map((c) => [c.start, c.end, c.open, c.high, c.low, c.close, c.volume, c.rows])).toEqual([
      ["2026-09-07", "2026-09-11", 10, 13, 8, 9, 300, 3],
      ["2026-09-14", "2026-09-18", 9, 11, 8.5, 10.5, 100, 2],
      ["2026-10-05", "2026-10-05", 20, 20, 20, 20, 5, 1],
    ]);
  });

  it("monthly: calendar months", () => {
    const monthly = aggregateCandles(bars, "monthly");
    expect(monthly.map((c) => [c.start, c.open, c.high, c.low, c.close, c.volume])).toEqual([
      ["2026-09-07", 10, 13, 8, 10.5, 400],
      ["2026-10-05", 20, 20, 20, 20, 5],
    ]);
  });

  it("weekStart is the Monday of the ISO week", () => {
    expect(weekStart("2026-09-13")).toBe("2026-09-07"); // Sunday
    expect(weekStart("2026-09-07")).toBe("2026-09-07");
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
  });
});

describe("indexed change and comparison", () => {
  it("indexedChange is the percent change from the first value", () => {
    expect(indexedChange([100, 110, 90, 100])).toEqual([0, 10.000000000000009, -9.999999999999998, 0]);
    expect(indexedChange([])).toEqual([]);
    expect(percentChange(0, 5)).toBeNull();
  });

  it("aligns every series on the company's trading dates within the range", () => {
    const dates = tradingDays(30);
    const company = syntheticSeries("company", "EXHL", linearPoints(dates, 100, 1));
    /* the benchmark misses one date and starts two rows later */
    const market = syntheticSeries(
      "broad_market",
      "MKT",
      linearPoints(dates, 50, 1).filter((_, i) => i >= 11 && i !== 20),
    );
    const { dates: axis, lines } = compareSeries([company, market], "1M");
    expect(axis).toEqual(dates.slice(-21));
    const [c, m] = lines;
    expect(c.changes[0]).toBe(0);
    expect(c.end).toBeCloseTo(((129 / 109) - 1) * 100, 10);
    expect(m.closes[0]).toBeNull(); // before the benchmark starts
    expect(m.closes[1]).toBeNull();
    expect(m.changes[2]).toBe(0); // first available close is the base
    expect(m.closes[11]).toBe(m.closes[10]); // the missing date carries the previous close forward
  });
});

describe("performanceTiles", () => {
  /* 300 weekday rows ending 2026-09-25 with close = index + 1 */
  const dates = tradingDays(300);
  const bars = toBars(linearPoints(dates, 1, 1));
  const last = bars[bars.length - 1].close;

  it("compares the last close with 5 / 21 / 63 / 126 / 252 trading rows back", () => {
    const tiles = Object.fromEntries(performanceTiles(bars).map((t) => [t.label, t.pct]));
    const back = (n: number) => (last / bars[bars.length - 1 - n].close - 1) * 100;
    expect(tiles["1W"]).toBeCloseTo(back(5), 10);
    expect(tiles["1M"]).toBeCloseTo(back(21), 10);
    expect(tiles["3M"]).toBeCloseTo(back(63), 10);
    expect(tiles["6M"]).toBeCloseTo(back(126), 10);
    expect(tiles["1Y"]).toBeCloseTo(back(252), 10);
  });

  it("YTD compares with the last close of the prior calendar year", () => {
    const priorYearEnd = bars.filter((b) => b.date < "2026-01-01").pop()!;
    expect(priorYearEnd.date).toBe("2025-12-31");
    const ytd = performanceTiles(bars).find((t) => t.label === "YTD")!.pct;
    expect(ytd).toBeCloseTo((last / priorYearEnd.close - 1) * 100, 10);
  });

  it("is null where the series does not reach back far enough", () => {
    const short = bars.slice(-30);
    const tiles = Object.fromEntries(performanceTiles(short).map((t) => [t.label, t.pct]));
    expect(tiles["1W"]).not.toBeNull();
    expect(tiles["1M"]).not.toBeNull();
    expect(tiles["3M"]).toBeNull();
    expect(tiles.YTD).toBeNull(); // no row from the prior year
    expect(performanceTiles([]).every((t) => t.pct === null)).toBe(true);
  });

  it("lastClose gives the close and its change from the previous row", () => {
    expect(lastClose(bars)).toMatchObject({ date: "2026-09-25", close: 300, previous: 299, change: 1 });
    expect(lastClose([])).toBeNull();
  });
});

describe("52-week range and average volume", () => {
  it("uses the last 252 rows, lows and highs (close where missing)", () => {
    const rows: Bar[] = [bar("2025-01-01", 1, 1000, 0.01, 1, 5)];
    for (let i = 0; i < 252; i += 1) rows.push(bar(`2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, 10, i === 5 ? null : 20 + i, i === 7 ? null : 5 + i, 10 + i, i));
    const range = fiftyTwoWeekRange(rows)!;
    expect(range.low).toBe(5); // the first row (0.01) is 253 rows back, outside the window
    expect(range.high).toBe(20 + 251);
    expect(fiftyTwoWeekRange([])).toBeNull();
  });

  it("averages the last 30 rows that report a volume", () => {
    const rows = Array.from({ length: 40 }, (_, i) => bar(`2026-01-${String(i + 1).padStart(2, "0")}`, 1, 1, 1, 1, i < 10 ? 1_000_000 : i % 2 ? 300 : null));
    expect(averageVolume(rows, 30)).toBe(300);
    expect(averageVolume(rows.map((r) => ({ ...r, volume: null })), 30)).toBeNull();
  });
});

describe("niceTicks", () => {
  it("gives round steps within the extent", () => {
    expect(niceTicks(-3.2, 11.7, 5)).toEqual([0, 5, 10]);
    expect(niceTicks(101.3, 108.9, 5)).toEqual([102, 104, 106, 108]);
    expect(niceTicks(0.12, 0.58, 5)).toEqual([0.2, 0.3, 0.4, 0.5]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe("keyStats", () => {
  const calcs = [
    { name: "pe_ttm", status: "computed", display: "24.1×" },
    { name: "market_cap", status: "computed", display: "$1.2B" },
    { name: "ev_ebitda_ttm", status: "unavailable", display: "unavailable" },
    { name: "fcf_margin", status: "ok", display: "12.0%" },
    { name: "price_return_1y", status: "computed", display: "5.0%" },
  ];

  it("uses each calculation's own display string, in the contract's order, skipping missing and not-ok ones", () => {
    expect(keyStats(calcs, null).map((s) => [s.label, s.value])).toEqual([
      ["Market cap", "$1.2B"],
      ["P/E (TTM)", "24.1×"],
      ["FCF margin", "12.0%"],
    ]);
  });

  it("adds the 52-week range and 30-day average volume only when rows exist", () => {
    const rows = toBars(linearPoints(tradingDays(40), 10, 1, 2_000_000));
    const stats = keyStats(calcs, rows);
    expect(stats.find((s) => s.key === "range_52w")?.value).toBe("9.00 – 50.00");
    expect(stats.find((s) => s.key === "avg_volume_30d")?.value).toBe(formatCompact(averageVolume(rows)!));
    expect(keyStats([], []).length).toBe(0);
  });
});

describe("formatting", () => {
  it("formats signed figures with a real minus sign", () => {
    expect(formatPct(12.345)).toBe("+12.3%");
    expect(formatPct(-3.21)).toBe("−3.2%");
    expect(formatSigned(-0.001)).toBe("+0.00");
    expect(formatPctTick(0)).toBe("0%");
    expect(formatPctTick(-10)).toBe("−10%");
  });

  it("formats dates, money, durations and URLs", () => {
    expect(formatDay("2026-09-29T00:00:00+00:00")).toBe("Sep 29, 2026");
    expect(formatDay(null)).toBe("");
    expect(formatMoney(901_200_000, "USD")).toBe("$901.2M");
    expect(formatMoney(94_930_000_000, "EUR")).toBe("EUR 94.93B");
    expect(formatDuration(18.6)).toBe("19 ms");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatClock(31_400)).toBe("0:31");
    expect(formatClock(125_000)).toBe("2:05");
    expect(hostOf("https://www.news.example.com/a/b?c=1")).toBe("news.example.com");
    expect(pathOf("https://www.news.example.com/a/b?c=1")).toBe("/a/b?c=1");
    expect(hostOf("not a url")).toBeNull();
  });
});
