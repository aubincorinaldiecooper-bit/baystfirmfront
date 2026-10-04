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
import { initialHistoryState, mergeHeadPage, historyReducer } from "@/lib/api/history";
import type { AnalysisListResponse, AnalysisSummary } from "@/lib/api/types";
import { capabilitiesFixture, clone, historyPages, jsonResponse } from "./fixtures/backend";
import { stubBackend, type RouteHandler } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}));

afterEach(cleanup);
beforeEach(() => {
  nav.push.mockReset();
  nav.pathname = "/";
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
    fireEvent.click(within(sidebar()).getByText("New analysis"));
    expect(nav.push).toHaveBeenLastCalledWith("/");
  });

  it("navigates to Status and keeps Markets navigation", () => {
    nav.pathname = "/status";
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    const status = within(sidebar()).getByRole("button", { name: "Status" });
    expect(status.getAttribute("aria-current")).toBe("page");
    fireEvent.click(status);
    expect(nav.push).toHaveBeenCalledWith("/status");
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Markets" }));
    expect(nav.push).toHaveBeenLastCalledWith("/markets");
  });

  it("renders an empty state, not placeholders, when there is no history", async () => {
    setup(() => jsonResponse(200, { analyses: [], next_cursor: null }));
    await within(sidebar()).findByText("No analyses yet. Ask a question to start one.");
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
    expect(historyRow(page1.analyses[0])).toEqual({ id: page1.analyses[0].analysis_id, label: page1.analyses[0].query, detail: "AAPL" });
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
