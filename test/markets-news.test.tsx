/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import NewsList from "@/components/markets/NewsList";
import type { NewsItem } from "@/lib/markets/types";

afterEach(cleanup);

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function item(overrides: Partial<NewsItem> & Pick<NewsItem, "id" | "kind" | "title">): NewsItem {
  const { id, kind, title, ...rest } = overrides;
  return {
    id,
    kind,
    source: kind === "filing" ? "sec_edgar" : kind === "market_event" || kind === "token_event" ? "baystfirm" : "sec",
    source_label: kind === "filing" ? "SEC EDGAR" : kind === "market_event" || kind === "token_event" ? "Baystfirm (measured)" : "U.S. SEC",
    title,
    url: null,
    published_at: "2026-10-05T12:00:00Z",
    symbols: [],
    details: {},
    ...rest,
  };
}

describe("NewsList", () => {
  it("shows kind badges, source and relative/absolute time with safe original links", () => {
    const release = item({
      id: "release",
      kind: "official",
      title: "SEC press release",
      url: "https://www.sec.gov/news/press-release",
    });
    const filing = item({
      id: "filing",
      kind: "filing",
      title: "Apple: Form 10-Q",
      url: "https://www.sec.gov/Archives/edgar/data/1/filing.htm",
    });
    render(<NewsList items={[release, filing]} />);

    const list = screen.getByRole("list", { name: "News and events" });
    expect(within(list).getByText("Regulator")).toBeTruthy();
    expect(within(list).getByText("SEC filing")).toBeTruthy();
    expect(within(list).getByText("U.S. SEC")).toBeTruthy();
    for (const title of [release.title, filing.title]) {
      const link = within(list).getByRole("link", { name: title });
      expect(link.getAttribute("href")).toBe(title === release.title ? release.url : filing.url);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    const time = list.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe(release.published_at);
    expect(time.getAttribute("title")).toBeTruthy();
    expect(time.textContent).toMatch(/^\d+[smhd]$/);
    expect(screen.getByText(/Headlines link to the original publisher/)).toBeTruthy();
  });

  it("links own events to assets only when they are off the current asset page", () => {
    const market = item({ id: "market", kind: "market_event", title: "BTC position liquidated", symbols: ["BTC"] });
    const token = item({ id: "token", kind: "token_event", title: "KNOB liquidity fell", symbols: [MINT] });
    const { rerender } = render(<NewsList items={[market, token]} />);
    expect(screen.getByText("Market event")).toBeTruthy();
    expect(screen.getByText("Token event")).toBeTruthy();
    expect(screen.getByRole("link", { name: market.title }).getAttribute("href")).toBe("/crypto/BTC");
    expect(screen.getByRole("link", { name: token.title }).getAttribute("href")).toBe(`/tokens/${MINT}`);

    rerender(
      <NewsList
        items={[market, token]}
        currentAsset={{ kind: "crypto", symbol: "BTC" }}
      />,
    );
    expect(screen.getByText(market.title).closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: token.title })).toBeTruthy();

    rerender(<NewsList items={[token]} currentAsset={{ kind: "token", symbol: MINT }} />);
    expect(screen.getByText(token.title).closest("a")).toBeNull();
  });

  it("shows cross-market stablecoin readings beneath measured market events", () => {
    const event = item({
      id: "usdc-off-peg",
      kind: "market_event",
      title: "USDC trading 0.62% below 1 USD on Kraken (USDC-USD); 1/3 venues off by ≥0.5%",
      symbols: ["USDC"],
      details: {
        venue_readings: [
          { venue: "Binance.US", median_price: 1.0001, trade_count: 3 },
          { venue: "Coinbase", median_price: 0.9999, trade_count: 4 },
          { venue: "Kraken", median_price: 0.9938, trade_count: 3 },
        ],
        cross_market_median: 0.9999,
        venue_count: 3,
        agreeing_count: 1,
      },
    });
    render(<NewsList items={[event]} />);
    expect(screen.getByText("Binance.US 1.0001 · Coinbase 0.9999 · Kraken 0.9938 · cross-market 0.9999")).toBeTruthy();
  });

  it("keeps unsafe URLs as text and renders honest loading, error and empty states", () => {
    const unsafe = item({ id: "unsafe", kind: "official", title: "Unsafe link", url: "javascript:alert(1)" });
    const { rerender } = render(<NewsList items={[unsafe]} />);
    expect(screen.getByText("Unsafe link").closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: "Unsafe link" })).toBeNull();

    rerender(<NewsList items={[]} loading />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    rerender(<NewsList items={[]} error="backend unavailable" />);
    expect(screen.getByRole("alert").textContent).toContain("backend unavailable");
    rerender(<NewsList items={[]} />);
    expect(screen.getByRole("status").textContent).toBe("No events yet");
  });
});
