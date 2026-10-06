import { describe, expect, it } from "vitest";
import { candleChangePercent } from "@/lib/markets/chartPrices";

describe("candle change labels", () => {
  it("needs at least two candles", () => {
    expect(candleChangePercent([])).toBeNull();
    expect(candleChangePercent([{ close: 1 }])).toBeNull();
  });

  it("compares the first and last closes", () => {
    expect(candleChangePercent([{ close: 1 }, { close: 1.1 }])).toBeCloseTo(10);
  });

  it("returns no percentage when the first close is zero", () => {
    expect(candleChangePercent([{ close: 0 }, { close: 1.1 }])).toBeNull();
  });
});
