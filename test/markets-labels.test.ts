import { describe, expect, it } from "vitest";
import { formatClock, formatSpan } from "@/lib/markets/labels";

describe("market clock labels", () => {
  it("omits fractional seconds from UTC timestamps", () => {
    expect(formatClock("2026-10-04T16:59:28.254Z")).toBe("16:59:28 UTC");
    expect(formatClock("2026-10-04T16:59:28Z")).toBe("16:59:28 UTC");
  });

  it("formats candle spans using rounded minutes, hours, or days", () => {
    expect(formatSpan(45 * 60_000)).toBe("45 minutes");
    expect(formatSpan(60 * 60_000)).toBe("60 minutes");
    expect(formatSpan(5 * 60 * 60_000)).toBe("5 hours");
    expect(formatSpan(24 * 60 * 60_000)).toBe("24 hours");
    expect(formatSpan(8 * 24 * 60 * 60_000)).toBe("8 days");
    expect(formatSpan(2 * 24 * 60 * 60_000)).toBe("2 days");
    expect(formatSpan(60_000)).toBe("1 minute");
    expect(formatSpan(2 * 24 * 60 * 60_000 - 1)).toBe("48 hours");
  });
});
