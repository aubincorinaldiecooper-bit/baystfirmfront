/** @vitest-environment jsdom */
/**
 * The Solana Tokens page: each row's at-a-glance badges restate backend facts
 * (a fact the backend couldn't check says so), a row opens every fact with its
 * source, RugCheck appears only as a labelled second opinion, and a pasted
 * address is checked only when it is a Solana mint.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TokensView from "@/components/markets/TokensView";
import { factSummary, formatAge, glance } from "@/lib/markets/tokens";
import type { NewTokensFeed, TokenCard, TokenFact } from "@/lib/markets/types";

vi.mock("@/components/finance/PageHeader", () => ({
  default: ({ title }: { title: string }) => <header>{title}</header>,
}));

afterEach(cleanup);

const AT = "2026-10-04T17:00:00Z";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function fact<T>(value: T | null, fields: Partial<TokenFact<T>> = {}): TokenFact<T> {
  return { status: "ok", value, source: "solana_rpc", fetched_at: AT, detail: null, ...fields };
}

type Top10Value = NonNullable<TokenCard["facts"]["top10_share"]["value"]>;

function unavailableTop10(fields: Partial<TokenFact<Top10Value>> = {}): TokenFact<Top10Value> {
  return fact<Top10Value>(null, { status: "unavailable", ...fields });
}

function card(fields: Partial<TokenCard> = {}, facts: Partial<TokenCard["facts"]> = {}): TokenCard {
  return {
    mint: MINT,
    name: "Bonk",
    symbol: "BONK",
    image_url: null,
    token_program: "spl-token",
    first_seen_at: AT,
    checked_at: AT,
    facts: {
      mint_authority: fact<string>(null),
      freeze_authority: fact<string>(null),
      token_extensions: fact({ risky: [], transfer_fee_bps: null }),
      metadata_mutable: fact(true),
      top10_share: fact({
        pct: 38.4,
        holder_count: null,
        as_of: null,
        pool_accounts_excluded: true,
        holders: [
          { owner: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", pct: 9.1, is_pool: true },
          { owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", pct: 8.8, is_pool: false },
        ],
      }),
      liquidity_lock: fact({ pool_type: "lp_token" as const, dex: "raydium", pool: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", burned_pct: 99.75 }, { source: "raydium" }),
      market: fact(
        {
          price_usd: 0.00002,
          liquidity_usd: 6_981_785,
          volume_24h_usd: 1_200_000,
          price_change_24h_pct: -2.5,
          pool_created_at: Date.parse("2026-10-04T16:00:00Z"),
          pool_count: 8,
          total_liquidity_usd: 7_500_000,
          total_volume_24h_usd: 1_900_000,
          pools_checked_at: AT,
          main_pool: { dex: "raydium", address: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", labels: null },
          geckoterminal_liquidity_usd: 6_900_000,
        },
        { source: "dexscreener" },
      ),
      ...facts,
    },
    second_opinion: {
      provider: "RugCheck",
      status: "ok",
      fetched_at: AT,
      score_normalised: 30,
      lp_locked_pct: 14.4,
      risks: [{ name: "Mutable metadata", level: "warn", description: "Token metadata can be changed by the owner" }],
    },
    ...fields,
  };
}

const FEED: NewTokensFeed = {
  status: "ready",
  updated_at: AT,
  sources: [
    { name: "geckoterminal", fetched_at: AT, ok: true, error: null },
    { name: "solana_rpc", fetched_at: null, ok: false, error: "rate limited" },
  ],
  tokens: [card()],
  note: "Facts read from public sources at the times shown.",
};

function backend(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const path = url.replace("/api/markets/", "").split("?")[0];
    const route = routes[path];
    return route ? route() : new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("glance", () => {
  it("restates revoked powers, burns, holder share and changeable details", () => {
    expect(glance(card()).map((item) => [item.label, item.tone])).toEqual([
      ["Can't mint more", "green"],
      ["Can't freeze holders", "green"],
      ["LP burned 99.8%", "green"],
      ["Top 10 hold 38.4%", "neutral"],
      ["Name/picture changeable", "orange"],
    ]);
  });

  it("says when a fact couldn't be checked or doesn't apply, and names hidden extras", () => {
    const labels = glance(
      card(
        {},
        {
          mint_authority: fact("3TtcVHRJKZUEB4KGwAoNuvBUdnX2DMU2YoACz3ynpa5f"),
          top10_share: unavailableTop10({ detail: "Couldn't check right now (Solana connection rate-limited)" }),
          liquidity_lock: fact({ pool_type: "launch_curve" as const, dex: "pumpfun", pool: "x", burned_pct: null }, { status: "not_applicable" }),
          token_extensions: fact({ risky: ["transferFeeConfig", "permanentDelegate"], transfer_fee_bps: 250 }),
        },
      ),
    ).map((item) => item.label);
    expect(labels).toEqual(["Creator can mint more", "Can't freeze holders", "On launch curve", "Transfer fee 2.50% + 1 other extra", "Name/picture changeable"]);
    expect(
      glance(card({}, { top10_share: unavailableTop10({ detail: "Check pending" }) })).map((item) => item.label),
    ).not.toContain("Top 10: couldn't check");
  });

  it("explains facts in words, passing the backend's reason through", () => {
    const unavailable = card({}, { top10_share: unavailableTop10({ detail: "Couldn't check right now (Solana connection rate-limited)" }) });
    expect(factSummary("top10_share", unavailable)).toBe("Couldn't check right now (Solana connection rate-limited)");
    expect(factSummary("liquidity_lock", card())).toBe("99.8% of the pool's tokens are burned (raydium)");
    expect(formatAge(Date.parse("2026-10-04T16:00:00Z"), Date.parse(AT))).toBe("1h");
    expect(formatAge(null, 0)).toBe("—");
  });

  it("labels GeckoTerminal holder data without claiming pool accounts were excluded", () => {
    const gecko = card(
      {},
      {
        top10_share: fact(
          {
            pct: 38.4623,
            holder_count: 1_024_405,
            as_of: "2026-10-04T16:59:00Z",
            pool_accounts_excluded: false,
            holders: [],
          },
          {
            source: "geckoterminal",
            detail: "Top 10 holders per GeckoTerminal; may include pool and exchange accounts",
          },
        ),
      },
    );
    expect(factSummary("top10_share", gecko)).toBe(
      "38.5% of supply per GeckoTerminal; may include pool and exchange accounts.",
    );
    expect(glance(gecko).map((item) => item.label)).toContain("Top 10 hold 38.5%");
    expect(glance(card({}, { top10_share: unavailableTop10() })).map((item) => item.label)).not.toContain("Top 10 hold 38.5%");
  });
});

describe("TokensView", () => {
  it("lists launches with badges and the sources' state, then opens every fact with its source", async () => {
    const { fetchImpl, calls } = backend({
      "solana/tokens/new": json(FEED),
      [`solana/tokens/${MINT}`]: json(card({ checked_at: "2026-10-04T17:01:00Z" })),
    });
    render(<TokensView fetchImpl={fetchImpl} />);
    const row = (await screen.findByRole("button", { name: "Open details for BONK" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Can't mint more")).toBeTruthy();
    expect(within(row).getByText("LP burned 99.8%")).toBeTruthy();
    expect(screen.getByText(/Solana network failed \(rate limited\)/)).toBeTruthy();
    expect(calls[0]).toBe("/api/markets/solana/tokens/new?limit=50");

    fireEvent.click(within(row).getByRole("button", { name: "Open details for BONK" }));
    const dialog = await screen.findByRole("dialog", { name: /BONK/ });
    await waitFor(() => expect(within(dialog).getByText(/checked 2026-10-04 17:01:00 UTC/)).toBeTruthy());
    expect(calls).toContain(`/api/markets/solana/tokens/${MINT}`);
    expect(within(dialog).getByText("Our checks")).toBeTruthy();
    expect(within(dialog).getByText(/Creator can't mint more coins/)).toBeTruthy();
    expect(within(dialog).getAllByText(/^Raydium · read/).length).toBe(1);
    expect(within(dialog).getByText("Pool, not counted")).toBeTruthy();
    expect(within(dialog).getByText("Second opinion: RugCheck")).toBeTruthy();
    expect(within(dialog).getByText(/RugCheck's own assessment, not ours/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows GeckoTerminal holder metadata with its pool-account caveat", async () => {
    const geckoCard = card(
      {},
      {
        top10_share: fact(
          {
            pct: 38.4623,
            holder_count: 1_024_405,
            as_of: "2026-10-04T16:59:00Z",
            pool_accounts_excluded: false,
            holders: [],
          },
          {
            source: "geckoterminal",
            detail: "Top 10 holders per GeckoTerminal; may include pool and exchange accounts",
          },
        ),
      },
    );
    const { fetchImpl } = backend({
      "solana/tokens/new": json({ ...FEED, tokens: [geckoCard] }),
      [`solana/tokens/${MINT}`]: json(geckoCard),
    });
    render(<TokensView fetchImpl={fetchImpl} />);
    const row = (await screen.findByRole("button", { name: "Open details for BONK" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Top 10 hold 38.5%")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Open details for BONK" }));
    const dialog = await screen.findByRole("dialog", { name: /BONK/ });
    expect(within(dialog).getByText("Per GeckoTerminal; may include pool and exchange accounts.")).toBeTruthy();
    expect(within(dialog).getByText("Holder count: 1,024,405")).toBeTruthy();
    expect(within(dialog).getByText("2026-10-04 16:59:00 UTC").getAttribute("datetime")).toBe("2026-10-04T16:59:00Z");
    expect(within(dialog).queryByText("Pool, not counted")).toBeNull();
  });

  it("checks a pasted address only when it is a Solana mint, and reports a backend refusal", async () => {
    const other = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
    const { fetchImpl, calls } = backend({
      "solana/tokens/new": json({ ...FEED, status: "warming", tokens: [] }),
      [`solana/tokens/${other}`]: json({ detail: "That address is not a Solana token mint." }, 404),
    });
    render(<TokensView fetchImpl={fetchImpl} />);
    expect(await screen.findByText(/reading its first batch of new pools/)).toBeTruthy();

    const input = screen.getByLabelText("Solana token address");
    fireEvent.change(input, { target: { value: "0xnot-solana" } });
    fireEvent.click(screen.getByRole("button", { name: "Check token" }));
    expect(screen.getByRole("alert").textContent).toBe("That isn't a Solana token address.");
    expect(calls).toHaveLength(1);

    fireEvent.change(input, { target: { value: ` ${other} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Check token" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/That address is not a Solana token mint./)).toBeTruthy();
    expect(calls[1]).toBe(`/api/markets/solana/tokens/${other}`);
  });

  it("shows an honest error when the feed can't be read", async () => {
    const { fetchImpl } = backend({ "solana/tokens/new": json({ detail: "boom" }, 502) });
    render(<TokensView fetchImpl={fetchImpl} />);
    expect(await screen.findByText("The token feed could not be read.")).toBeTruthy();
    expect(screen.getByText("Backend unreachable")).toBeTruthy();
  });
});
