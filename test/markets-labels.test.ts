import { describe, expect, it } from "vitest";
import { formatClock } from "@/lib/markets/labels";

describe("market clock labels", () => {
  it("omits fractional seconds from UTC timestamps", () => {
    expect(formatClock("2026-10-04T16:59:28.254Z")).toBe("16:59:28 UTC");
    expect(formatClock("2026-10-04T16:59:28Z")).toBe("16:59:28 UTC");
  });
});
