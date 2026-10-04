/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TokenAssetView from "@/components/markets/TokenAssetView";
import type { TokenCard, TokenFact, TokenLiquidityLock } from "@/lib/markets/types";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <div role="img" aria-label={alt} data-src={src} />,
}));
vi.mock("@/components/finance/PageHeader", () => ({
  default: ({ title }: { title: ReactNode }) => <header>{title}</header>,
}));
vi.mock("@/components/markets/CandleChartPanel", () => ({
  default: ({ title }: { title: ReactNode }) => <div aria-label="Token candlestick panel">{title}</div>,
}));
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function fact<T>(value: T | null, fields: Partial<TokenFact<T>> = {}): TokenFact<T> {
  return { status: "ok", value, source: "solana_rpc", fetched_at: "2026-10-04T17:00:00Z", detail: null, ...fields };
}

const tokenCard: TokenCard = {
  mint: MINT,
  name: "\u202eK N O B",
  symbol: "\u202eKNOB",
  image_url: "https://cdn.example.test/token.png",
  token_program: "spl-token",
  first_seen_at: "2026-10-04T16:00:00Z",
  checked_at: "2026-10-04T17:00:00Z",
  facts: {
    mint_authority: fact<string>(null),
    freeze_authority: fact<string>(null),
    token_extensions: fact({ risky: [], transfer_fee_bps: null }),
    metadata_mutable: fact(true),
    top10_share: fact(
      {
        pct: 38.4623,
        holder_count: 1_024_405,
        as_of: "2026-10-04T16:59:00Z",
        pool_accounts_excluded: false,
        holders: [{ owner: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", pct: 9.1, is_pool: true }],
      },
      {
        source: "geckoterminal",
        detail: "Top 10 holders per GeckoTerminal; may include pool and exchange accounts",
      },
    ),
    liquidity_lock: fact<TokenLiquidityLock>(null, { status: "unavailable", source: "raydium", detail: "Couldn't check right now" }),
    market: fact({
      price_usd: 0.00002,
      liquidity_usd: 6_981_785,
      volume_24h_usd: 1_200_000,
      price_change_24h_pct: -2.5,
      pool_created_at: "2026-10-04T16:00:00Z",
      pool_count: 8,
      total_liquidity_usd: 7_500_000,
      total_volume_24h_usd: 1_900_000,
      pools_checked_at: "2026-10-04T17:00:00Z",
      main_pool: { dex: "raydium", address: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", labels: null },
      geckoterminal_liquidity_usd: 6_900_000,
    }),
  },
  second_opinion: {
    provider: "RugCheck",
    status: "ok",
    fetched_at: "2026-10-04T17:00:00Z",
    score_normalised: 30,
    lp_locked_pct: 14.4,
    risks: [{ name: "Mutable metadata", level: "warn", description: "Token metadata can be changed by the owner" }],
  },
};

describe("TokenAssetView", () => {
  it("renders upstream names in bidi isolation, token identity, and copy feedback", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`/api/markets/solana/tokens/${MINT}`);
      return new Response(JSON.stringify(tokenCard), { status: 200, headers: { "content-type": "application/json" } });
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);

    const title = await screen.findByRole("heading", { level: 1 });
    const isolatedNames = title.querySelectorAll("bdi");
    expect(Array.from(isolatedNames).map((item) => item.textContent)).toEqual([tokenCard.name, tokenCard.symbol]);
    const header = screen.getByRole("banner");
    expect(Array.from(header.querySelectorAll("bdi")).map((item) => item.textContent)).toEqual([tokenCard.name, tokenCard.symbol]);
    expect(screen.getByText(/Main pool price \$0\.00002 USD/)).toBeTruthy();
    expect(screen.getByText(/Checked/).querySelector("time")?.getAttribute("dateTime")).toBe(tokenCard.checked_at);
    expect(container.querySelector('[role="img"]')?.getAttribute("data-src")).toBe(tokenCard.image_url);
    expect(screen.getByRole("heading", { name: "Token facts" })).toBeTruthy();
    expect(screen.getByText("Per GeckoTerminal; may include pool and exchange accounts.")).toBeTruthy();
    expect(screen.getByText("Holder count: 1,024,405")).toBeTruthy();
    expect(screen.getByText("Pool account")).toBeTruthy();
    expect(screen.queryByText("Pool, not counted")).toBeNull();
    expect(screen.getByText(/8 pools · total liquidity/)).toBeTruthy();
    expect(screen.getByText("Second opinion: RugCheck")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy mint address" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINT));
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("rejects an invalid mint without requesting token data", async () => {
    const fetchImpl = vi.fn();
    render(<TokenAssetView mint="not-a-mint" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect((await screen.findByRole("alert")).textContent).toContain("That address is not a Solana token mint.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
