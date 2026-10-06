/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TokenAssetView from "@/components/markets/TokenAssetView";
import * as marketsClient from "@/lib/markets/client";
import type {
  NewsFeed,
  NewsItem,
  TokenCard,
  TokenFact,
  TokenLiquidityLock,
  TokenPriceResponse,
} from "@/lib/markets/types";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <div role="img" aria-label={alt} data-src={src} />,
}));
vi.mock("@/components/finance/PageHeader", () => ({
  default: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) => (
    <header>{title}<div data-testid="page-header-actions">{actions}</div></header>
  ),
}));
vi.mock("@/components/markets/CandleChartPanel", () => ({
  default: ({
    title,
    ticks = [],
    showLastPrice,
  }: {
    title: ReactNode;
    ticks?: { time: number; value: number }[];
    showLastPrice?: boolean;
  }) => (
    <div
      aria-label="Token candlestick panel"
      data-tick-count={ticks.length}
      data-show-last-price={String(showLastPrice)}
    >
      {title}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.restoreAllMocks();
});

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NEWS_NOTE = "Headlines link to the original publisher. Market and token events are measured by Baystfirm from exchange and on-chain data. Facts, not investment advice.";
const EMPTY_NEWS: NewsFeed = { generated_at: "2026-10-04T17:00:00Z", items: [], sources: [], note: NEWS_NOTE };

beforeEach(() => {
  vi.spyOn(marketsClient, "getNews").mockResolvedValue(EMPTY_NEWS);
});

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

function tokenPrice(
  price: number | null,
  fetchedAt = "2026-10-04T17:00:00Z",
  stale = false,
): TokenPriceResponse {
  const market = tokenCard.facts.market.value;
  return {
    mint: MINT,
    source: "dexscreener",
    fetched_at: fetchedAt,
    stale,
    market: market ? { ...market, price_usd: price } : null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TokenAssetView", () => {
  it("renders upstream names in bidi isolation, token identity, and copy feedback", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/price")) return jsonResponse(tokenPrice(0.00002));
      expect(url).toBe(`/api/markets/solana/tokens/${MINT}`);
      return jsonResponse(tokenCard);
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
    expect(container.textContent?.match(/per GeckoTerminal; may include pool and exchange accounts\./gi)).toHaveLength(1);
    expect(screen.getByText("Holder count: 1,024,405")).toBeTruthy();
    expect(screen.getByText("Pool account")).toBeTruthy();
    expect(screen.queryByText("Pool, not counted")).toBeNull();
    expect(screen.getByText(/8 pools · total liquidity/)).toBeTruthy();
    expect(screen.getByText("Second opinion: RugCheck")).toBeTruthy();
    expect(screen.getByLabelText("Token candlestick panel").getAttribute("data-show-last-price")).toBe("false");
    expect(screen.getByTestId("page-header-actions").textContent).toBe("");
    expect(screen.queryByText(/recorded trade/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy mint address" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINT));
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("rejects an invalid mint without requesting token data", async () => {
    const fetchImpl = vi.fn();
    render(<TokenAssetView mint="not-a-mint" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect((await screen.findByRole("alert")).textContent).toContain("That address is not a Solana token mint.");
    expect(screen.getByTestId("page-header-actions").textContent).toBe("Unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows the checking pill while token facts are loading", () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(screen.getByTestId("page-header-actions").textContent).toBe("Checking");
  });

  it("shows a token name alone when its symbol differs only by case", async () => {
    const sameNameCard = { ...tokenCard, name: "Bonk", symbol: "BONK" };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/price") ? jsonResponse(tokenPrice(0.00002)) : jsonResponse(sameNameCard),
    );
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    const title = await screen.findByRole("heading", { level: 1 });
    expect(title.textContent).toBe("Bonk");
    expect(title.querySelectorAll("bdi")).toHaveLength(1);
  });

  it("refreshes facts after 60 seconds and keeps the previous card when refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let cardCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/price")) return jsonResponse(tokenPrice(0.00002));
      cardCalls += 1;
      return cardCalls === 1
        ? jsonResponse(tokenCard)
        : jsonResponse({ error: { message: "Refresh unavailable." } }, 503);
    });
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);

    expect(await screen.findByText(/Main pool price \$0\.00002 USD/)).toBeTruthy();
    expect(cardCalls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(cardCalls).toBe(2);
    expect(screen.getByText(/Main pool price \$0\.00002 USD/)).toBeTruthy();
    expect(screen.getByText("Couldn't refresh; showing facts from 17:00:00 UTC.")).toBeTruthy();
    expect(screen.queryByText("Reading token facts from the Baystfirm backend…")).toBeNull();
  });

  it("polls DexScreener price every 10 seconds while visible and charts successful ticks", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let priceCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/price")) {
        priceCalls += 1;
        return jsonResponse(
          priceCalls === 1
            ? tokenPrice(0.00003, "2026-10-04T17:00:10Z")
            : tokenPrice(0.00004, "2026-10-04T17:00:20Z"),
        );
      }
      return jsonResponse(tokenCard);
    });
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);

    expect(await screen.findByText(/Main pool price \$0\.00003 USD/)).toBeTruthy();
    expect(screen.getByText("17:00:10 UTC").closest("p")?.textContent).toContain("updated");
    expect(screen.getByLabelText("Token candlestick panel").getAttribute("data-tick-count")).toBe("1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(priceCalls).toBe(2);
    expect(screen.getByText(/Main pool price \$0\.00004 USD/)).toBeTruthy();
    expect(screen.getByText("17:00:20 UTC").closest("p")?.textContent).toContain("updated");
    expect(screen.getByLabelText("Token candlestick panel").getAttribute("data-tick-count")).toBe("2");
  });

  it("skips price polling while hidden and polls immediately when visible again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    let priceCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/price")) {
        priceCalls += 1;
        return jsonResponse(tokenPrice(0.00003, "2026-10-04T17:00:10Z"));
      }
      return jsonResponse(tokenCard);
    });
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);

    expect(await screen.findByRole("heading", { name: "Token facts" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(priceCalls).toBe(0);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(priceCalls).toBe(1));
    await screen.findByText("17:00:10 UTC");
    expect(screen.getByText("17:00:10 UTC").closest("p")?.textContent).toContain("updated");
  });

  it("keeps the last good price and labels it as old after a failed poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let priceCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/price")) {
        priceCalls += 1;
        return priceCalls === 1
          ? jsonResponse(tokenPrice(0.00003, "2026-10-04T17:00:10Z"))
          : jsonResponse({ error: { message: "Price unavailable." } }, 503);
      }
      return jsonResponse(tokenCard);
    });
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);

    expect(await screen.findByText(/Main pool price \$0\.00003 USD/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(priceCalls).toBe(2);
    expect(screen.getByText("17:00:10 UTC").closest("p")?.textContent).toContain(
      "Main pool price $0.00003 USD · price from",
    );
    expect(screen.queryByText(/Price unavailable/)).toBeNull();
    expect(screen.getByLabelText("Token candlestick panel").getAttribute("data-tick-count")).toBe("1");
  });

  it("shows mint-filtered token events beneath Token facts as plain text on the same asset page", async () => {
    const event: NewsItem = {
      id: "liquidity-drop",
      kind: "token_event",
      source: "baystfirm",
      source_label: "Baystfirm (measured)",
      title: "KNOB liquidity fell 60% ($100,000 → $40,000) on raydium",
      url: null,
      published_at: "2026-10-04T16:59:00Z",
      symbols: [MINT],
      details: { before_usd: 100_000, after_usd: 40_000, symbol: "KNOB" },
    };
    const getNews = vi.spyOn(marketsClient, "getNews").mockResolvedValue({ ...EMPTY_NEWS, items: [event] });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/price") ? jsonResponse(tokenPrice(0.00002)) : jsonResponse(tokenCard),
    );
    render(<TokenAssetView mint={MINT} fetchImpl={fetchImpl as unknown as typeof fetch} />);

    const section = await screen.findByRole("region", { name: /^Token events/ });
    expect((await within(section).findByText(event.title)).closest("a")).toBeNull();
    const factsHeading = screen.getByRole("heading", { name: "Token facts" });
    const eventsHeading = screen.getByRole("heading", { name: /^Token events/ });
    expect(factsHeading.compareDocumentPosition(eventsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getNews).toHaveBeenCalledWith({ symbol: MINT, kinds: ["token_event"], limit: 50 }, expect.any(Function), expect.any(AbortSignal));
  });
});
