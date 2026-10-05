import { describe, expect, it } from "vitest";
import { enterSearch, suggest, type CryptoBase, type SolanaSearchToken } from "@/lib/search/suggest";

const bases: CryptoBase[] = [
  { base: "BTC", symbols: ["BTC-USD"], venueCount: 3 },
  { base: "ETH", symbols: ["ETH-USD"], venueCount: 2 },
];

const bonk: SolanaSearchToken = {
  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  symbol: "BONK",
  name: "Bonk",
  pool_count: 30,
  total_liquidity_usd: 1_600_000,
  symbol_match: true,
};

describe("unified search suggestions", () => {
  it("returns only a token-page suggestion for a valid mint", () => {
    expect(suggest(bonk.mint, bases, [bonk], null).map((item) => item.kind)).toEqual(["mint"]);
  });

  it("puts exact crypto matches first", () => {
    const items = suggest("btc", bases, [], null);
    expect(items[0]).toMatchObject({ kind: "crypto", base: "BTC" });
    expect(items[1].kind).toBe("research");
  });

  it("offers token results and research for a short single word", () => {
    expect(suggest("BONK", bases, [bonk], null).map((item) => item.kind)).toEqual(["solana-token", "research"]);
  });

  it("offers only research for a longer sentence", () => {
    expect(suggest("Apple outlook next quarter", bases, [bonk], null).map((item) => item.kind)).toEqual(["research"]);
  });

  it("returns no suggestions for empty input", () => {
    expect(suggest("  ", bases, [bonk], null)).toEqual([]);
  });

  it("does not silently choose between a crypto asset and a symbol-matching token", () => {
    expect(enterSearch("BONK", bases, [bonk])).toEqual({ kind: "ambiguous" });
    expect(enterSearch("BTC", bases, [])).toEqual({ kind: "crypto", base: "BTC" });
  });
});
