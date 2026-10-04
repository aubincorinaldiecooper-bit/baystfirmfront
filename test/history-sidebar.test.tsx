/** @vitest-environment jsdom */
/**
 * The history sidebar over GET /analyses: the backend's own keyset pages
 * (history.json, limit 1), load more until next_cursor is null, the empty and
 * error states, selection by URL, and merging a refreshed first page.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeAnalysisId, historyRow } from "@/components/finance/HistorySidebar";
import { useWorkspace } from "@/components/finance/workspace";
import HeaderSearch from "@/components/finance/HeaderSearch";
import { initialHistoryState, mergeHeadPage, historyReducer } from "@/lib/api/history";
import type { AnalysisListResponse, AnalysisSummary } from "@/lib/api/types";
import { capabilitiesFixture, clone, historyPages, jsonResponse } from "./fixtures/backend";
import { stubBackend, type RouteHandler } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";
import { RECENT_SEARCHES_KEY } from "@/lib/search/recents";
import { WATCHLIST_KEY } from "@/lib/market/watchlist";
import { ALERTS_STORAGE_KEY } from "@/lib/markets/alerts";

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>(), pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: vi.fn<() => void>(),
    prefetch: vi.fn<() => void>(),
    back: vi.fn<() => void>(),
    forward: vi.fn<() => void>(),
    refresh: vi.fn<() => void>(),
  }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
});
beforeEach(() => {
  nav.push.mockReset();
  nav.pathname = "/";
  nav.search = "";
  vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "false");
});

const [page1, page2] = historyPages.pages;

function RefreshHead() {
  const { history } = useWorkspace();
  return (
    <button type="button" onClick={history.refreshHead}>
      refresh head
    </button>
  );
}

function setup(list: RouteHandler) {
  const backend = stubBackend({
    "GET /capabilities": () => jsonResponse(200, capabilitiesFixture),
    "GET /analyses": list,
  });
  renderWorkspace(<RefreshHead />, { client: backend.client });
  return backend;
}

const pagedByCursor: RouteHandler = (call) => jsonResponse(200, call.search.get("cursor") === page1.next_cursor ? page2 : page1);
const sidebar = () => screen.getByRole("complementary", { name: "Workspace navigation" });

describe("history sidebar", () => {
  it("loads the first page, then the next page by cursor until the list is exhausted", async () => {
    const backend = setup(pagedByCursor);
    await within(sidebar()).findByText(page1.analyses[0].query);
    expect(within(sidebar()).queryByText(page2.analyses[0].query)).toBeNull();

    await act(async () => {
      fireEvent.click(within(sidebar()).getByRole("button", { name: "Load more" }));
    });
    await within(sidebar()).findByText(page2.analyses[0].query);
    expect(within(sidebar()).queryByRole("button", { name: "Load more" })).toBeNull();

    const lists = backend.callsTo("GET", "/analyses");
    expect(lists.map((c) => c.search.get("cursor"))).toEqual([null, page1.next_cursor]);
    expect(lists.every((c) => c.search.get("limit") === "30")).toBe(true);
  });

  it("opens an analysis at its own URL and marks the current one", async () => {
    nav.pathname = `/analyses/${page1.analyses[0].analysis_id}`;
    setup(() => jsonResponse(200, page1));
    const row = await within(sidebar()).findByTitle(page1.analyses[0].query);
    expect(row.getAttribute("aria-current")).toBe("true");
    fireEvent.click(row);
    expect(nav.push).toHaveBeenCalledWith(`/analyses/${page1.analyses[0].analysis_id}`);
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Home" }));
    expect(nav.push).toHaveBeenLastCalledWith("/");
  });

  it("keeps only one Home item in the sidebar", () => {
    nav.pathname = "/status";
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    expect(within(sidebar()).getAllByRole("button", { name: "Home" })).toHaveLength(1);
    expect(within(sidebar()).queryByRole("button", { name: "Markets" })).toBeNull();
    expect(within(sidebar()).queryByRole("button", { name: "Tokens" })).toBeNull();
    expect(within(sidebar()).queryByRole("button", { name: "Status" })).toBeNull();
    expect(within(sidebar()).queryByRole("button", { name: "New analysis" })).toBeNull();
  });

  it("renders an empty state, not placeholders, when there is no history", async () => {
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    await within(sidebar()).findByText("Search a coin, token or company to start.");
    expect(within(sidebar()).queryByRole("button", { name: "Load more" })).toBeNull();
    expect(within(sidebar()).queryAllByRole("button", { current: true })).toHaveLength(0);
  });

  it("reports a failed load and retries it", async () => {
    let fail = true;
    setup(() =>
      fail
        ? jsonResponse(502, { error: { code: "INTERNAL_ERROR", message: "The BayAnalytics API could not be reached.", retryable: true, details: null } })
        : jsonResponse(200, page1),
    );
    const alert = await within(sidebar()).findByRole("alert");
    expect(alert.textContent).toContain("History could not be loaded.");
    expect(alert.textContent).toContain("INTERNAL_ERROR");
    fail = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    });
    await within(sidebar()).findByText(page1.analyses[0].query);
  });

  it("merges a refreshed first page without dropping loaded pages", async () => {
    const newest: AnalysisSummary = { ...clone(page1.analyses[0]), analysis_id: "an_newest0000000000", query: "Assess Microsoft.", status: "researching" };
    let head: AnalysisListResponse = page1;
    setup((call) => jsonResponse(200, call.search.get("cursor") === page1.next_cursor ? page2 : head));
    await within(sidebar()).findByText(page1.analyses[0].query);
    await act(async () => {
      fireEvent.click(within(sidebar()).getByRole("button", { name: "Load more" }));
    });
    await within(sidebar()).findByText(page2.analyses[0].query);

    head = { analyses: [newest], next_cursor: "opaque-cursor" };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "refresh head" }));
    });
    await within(sidebar()).findByText("Assess Microsoft.");
    const titles = within(sidebar())
      .getAllByRole("button")
      .map((b) => b.getAttribute("title"))
      .filter(Boolean);
    expect(titles).toEqual(["Assess Microsoft.", page1.analyses[0].query, page2.analyses[0].query]);
    await waitFor(() => expect(within(sidebar()).getByText("AAPL · Researching")).toBeTruthy());
  });
});

describe("history helpers", () => {
  it("shows the ticker, and the status unless completed", () => {
    expect(historyRow(page1.analyses[0])).toEqual({
      id: `analysis:${page1.analyses[0].analysis_id}`,
      label: page1.analyses[0].query,
      detail: "AAPL",
      at: page1.analyses[0].created_at,
    });
    expect(historyRow({ ...page1.analyses[0], status: "failed", error_code: "LAYA_INFERENCE_FAILED" }).detail).toBe("AAPL · Failed");
    expect(historyRow({ ...page1.analyses[0], instrument: null, status: "queued" }).detail).toBe("Queued");
  });

  it("reads the analysis id from the path", () => {
    expect(activeAnalysisId("/analyses/an_123")).toBe("an_123");
    expect(activeAnalysisId("/")).toBeNull();
  });

  it("mergeHeadPage keeps the cursor of pages already loaded", () => {
    const loaded = historyReducer(historyReducer(initialHistoryState, { type: "page", page: page1, reset: true }), {
      type: "page",
      page: page2,
      reset: false,
    });
    expect(loaded.hasMore).toBe(false);
    const newest = { ...page1.analyses[0], analysis_id: "an_new" };
    const merged = mergeHeadPage(loaded, { analyses: [newest], next_cursor: "c" });
    expect(merged.items.map((r) => r.analysis_id)).toEqual(["an_new", page1.analyses[0].analysis_id, page2.analyses[0].analysis_id]);
    expect(merged.nextCursor).toBeNull();
    expect(merged.hasMore).toBe(false);

    const fresh = mergeHeadPage(initialHistoryState, page1);
    expect(fresh.nextCursor).toBe(page1.next_cursor);
    expect(fresh.hasMore).toBe(true);

    const updated = mergeHeadPage(loaded, { analyses: [{ ...page1.analyses[0], status: "failed" }], next_cursor: page1.next_cursor });
    expect(updated.items[0].status).toBe("failed");
    expect(updated.items).toHaveLength(2);
  });
});

describe("browser-local sidebar items", () => {
  it("records crypto asset routes and the selected instrument as browser recents", async () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
    nav.pathname = "/crypto/btc";
    nav.search = "?instrument=coinbase%7CBTC-USD";
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]")).toMatchObject([
        { kind: "crypto", id: "crypto:BTC", label: "BTC", detail: "coinbase|BTC-USD" },
      ]);
    });
    expect(await within(sidebar()).findByTitle("BTC")).toBeTruthy();
  });

  it("records valid Solana token routes as browser recents", async () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
    nav.pathname = "/tokens/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]")).toMatchObject([
        { kind: "token", id: "token:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", label: "DezX…B263" },
      ]);
    });
  });

  it("does not persist asset recents while browser lists are feature-gated off", async () => {
    nav.pathname = "/crypto/BTC";
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    await within(sidebar()).findByText("Search a coin, token or company to start.");
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it("merges asset recents and routes a crypto recent with its selected instrument", async () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([
        {
          kind: "crypto",
          id: "crypto:BTC",
          label: "BTC",
          detail: "coinbase|BTC-USD",
          at: "2026-10-04T17:10:00Z",
        },
      ]),
    );
    setup(() => jsonResponse(200, page1));
    const row = await within(sidebar()).findByTitle("BTC");
    fireEvent.click(row);
    expect(nav.push).toHaveBeenCalledWith("/crypto/BTC?instrument=coinbase%7CBTC-USD");
    expect(within(sidebar()).getByText(page1.analyses[0].query)).toBeTruthy();
  });

  it("hides local recents, watchlists and alerts when the feature flag is off", async () => {
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([{ kind: "token", id: "token:mint", label: "A local token", at: "2026-10-04T17:10:00Z" }]),
    );
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify([{ symbol: "AAPL", name: "Apple", last_close: 100, change_pct: 1, as_of: "2026-10-04" }]),
    );
    localStorage.setItem(
      ALERTS_STORAGE_KEY,
      JSON.stringify([{ id: "rule", kind: "peg", symbol: "USDC", created_at: "2026-10-04T17:00:00Z" }]),
    );
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    await within(sidebar()).findByText("Search a coin, token or company to start.");
    expect(within(sidebar()).queryByText("A local token")).toBeNull();
    expect(within(sidebar()).queryByText("AAPL · as of 2026-10-04")).toBeNull();
    expect(within(sidebar()).queryByText("USDC stablecoin peg")).toBeNull();
  });

  it("routes stock watchlist entries to the newest matching loaded analysis", async () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify([{ symbol: "AAPL", name: "Apple", last_close: 100, change_pct: 1, as_of: "2026-10-04" }]),
    );
    setup(() => jsonResponse(200, page1));
    const stock = await within(sidebar()).findByRole("button", { name: "AAPL · as of 2026-10-04" });
    fireEvent.click(stock);
    expect(nav.push).toHaveBeenCalledWith(`/analyses/${page1.analyses[0].analysis_id}`);
  });

  it("focuses header search for a stock with no loaded analysis without starting research", async () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify([{ symbol: "MSFT", name: "Microsoft", last_close: null, change_pct: null, as_of: null }]),
    );
    const backend = stubBackend({
      "GET /capabilities": () => jsonResponse(200, capabilitiesFixture),
      "GET /analyses": () => jsonResponse(200, { analyses: [], next_cursor: null }),
    });
    const { container } = renderWorkspace(<HeaderSearch />, { client: backend.client });
    const stock = await within(sidebar()).findByRole("button", { name: "MSFT" });
    fireEvent.click(stock);
    const input = container.querySelector('input[role="combobox"]');
    expect(input).toHaveProperty("value", "MSFT");
    expect(document.activeElement).toBe(input);
    expect(backend.callsTo("POST", "/analyses")).toHaveLength(0);
  });

  it("shows saved alerts in plain language and opens the matching crypto page", async () => {
    vi.stubEnv("NEXT_PUBLIC_WATCHLIST_ALERTS", "true");
    localStorage.setItem(
      ALERTS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "btc-alert",
          kind: "threshold",
          metric: "last_price",
          venue: "coinbase",
          symbol: "BTC-USD",
          op: "above",
          value: 70000,
          created_at: "2026-10-04T17:00:00Z",
        },
      ]),
    );
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    const alert = await within(sidebar()).findByRole("button", { name: /BTC-USD last price above/ });
    expect(alert.textContent).toContain("Watching");
    fireEvent.click(alert);
    expect(nav.push).toHaveBeenCalledWith("/crypto/BTC");
  });
});
