import { describe, expect, it } from "vitest";
import { basisBps, spreadBps } from "@/lib/markets/metrics";

describe("market metrics", () => {
  it("computes spread bps from the quote midpoint", () => {
    expect(spreadBps(100, 101)).toBeCloseTo((1 / 100.5) * 10_000);
    expect(spreadBps(null, 101)).toBeNull();
    expect(spreadBps(0, 0)).toBeNull();
  });

  it("computes derivative basis bps relative to the index", () => {
    expect(basisBps(102, 100)).toBe(200);
    expect(basisBps(99, 100)).toBe(-100);
    expect(basisBps(100, 0)).toBeNull();
    expect(basisBps(null, 100)).toBeNull();
  });
});
