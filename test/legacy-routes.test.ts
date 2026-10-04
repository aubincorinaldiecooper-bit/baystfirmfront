import { describe, expect, it } from "vitest";
import { marketsRedirect, TOKENS_REDIRECT } from "@/lib/navigation/legacy";

describe("legacy market routes", () => {
  it("redirects /markets home when no instrument is selected", () => {
    expect(marketsRedirect(undefined)).toBe("/");
  });

  it("preserves the selected instrument while redirecting to its crypto base", () => {
    const selected = "coinbase|BTC-USD";
    expect(marketsRedirect(selected)).toBe(`/crypto/BTC?instrument=${encodeURIComponent(selected)}`);
  });

  it("extracts the base from full symbols and accepts array search params", () => {
    expect(marketsRedirect(["kraken|eth-usd", "other"])).toBe(
      `/crypto/ETH?instrument=${encodeURIComponent("kraken|eth-usd")}`,
    );
  });

  it("redirects /tokens to home", () => {
    expect(TOKENS_REDIRECT).toBe("/");
  });
});
