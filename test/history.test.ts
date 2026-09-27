import { describe, expect, it, vi } from "vitest";
import { BayApiClient } from "@/lib/api/client";
import { createHistoryPager, historyReducer, initialHistoryState, mergeHistoryPage, upsertHistoryRow } from "@/lib/api/history";
import type { AnalysisSummary } from "@/lib/api/types";

function row(id: string, overrides: Partial<AnalysisSummary> = {}): AnalysisSummary {
  return {
    analysis_id: id,
    query: `query ${id}`,
    instrument: null,
    profile: "fast",
    horizon: "multi_horizon",
    status: "completed",
    created_at: "2026-09-27T10:00:00+00:00",
    updated_at: "2026-09-27T10:00:00+00:00",
    completed_at: "2026-09-27T10:01:00+00:00",
    error_code: null,
    ...overrides,
  };
}

describe("history helpers", () => {
  it("mergeHistoryPage appends new rows, keeps order and drops duplicates", () => {
    const existing = [row("an_3"), row("an_2")];
    const merged = mergeHistoryPage(existing, [row("an_2"), row("an_1"), row("an_1")]);
    expect(merged.map((r) => r.analysis_id)).toEqual(["an_3", "an_2", "an_1"]);
    expect(mergeHistoryPage(existing, [row("an_3")])).toBe(existing);
  });

  it("upsertHistoryRow replaces in place or prepends", () => {
    const items = [row("an_2", { status: "researching" }), row("an_1")];
    const updated = upsertHistoryRow(items, row("an_2", { status: "completed" }));
    expect(updated.map((r) => r.analysis_id)).toEqual(["an_2", "an_1"]);
    expect(updated[0].status).toBe("completed");
    expect(upsertHistoryRow(items, row("an_9")).map((r) => r.analysis_id)).toEqual(["an_9", "an_2", "an_1"]);
  });

  it("historyReducer pages, resets and tracks the cursor", () => {
    let state = historyReducer(initialHistoryState, { type: "load_start", reset: true });
    expect(state.status).toBe("loading");
    state = historyReducer(state, { type: "page", page: { analyses: [row("an_3"), row("an_2")], next_cursor: "c1" }, reset: true });
    expect(state).toMatchObject({ status: "ready", hasMore: true, nextCursor: "c1", loaded: true });
    state = historyReducer(state, { type: "page", page: { analyses: [row("an_2"), row("an_1")], next_cursor: null }, reset: false });
    expect(state.items.map((r) => r.analysis_id)).toEqual(["an_3", "an_2", "an_1"]);
    expect(state.hasMore).toBe(false);
    state = historyReducer(state, { type: "page", page: { analyses: [row("an_5")], next_cursor: null }, reset: true });
    expect(state.items.map((r) => r.analysis_id)).toEqual(["an_5"]);
  });
});

describe("createHistoryPager", () => {
  it("walks the cursor chain newest-first and stops when exhausted", async () => {
    const pages: Record<string, { analyses: AnalysisSummary[]; next_cursor: string | null }> = {
      "": { analyses: [row("an_3"), row("an_2")], next_cursor: "cur_2" },
      cur_2: { analyses: [row("an_2"), row("an_1")], next_cursor: null },
    };
    const fetchImpl = vi.fn(async (url: string) => {
      const cursor = new URL(url, "http://localhost").searchParams.get("cursor") ?? "";
      return new Response(JSON.stringify(pages[cursor]), { status: 200, headers: { "content-type": "application/json" } });
    });
    const pager = createHistoryPager(new BayApiClient({ fetch: fetchImpl }), 2);
    await pager.loadFirst();
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/bay/analyses?limit=2");
    expect(pager.state.items.map((r) => r.analysis_id)).toEqual(["an_3", "an_2"]);
    expect(pager.state.hasMore).toBe(true);
    await pager.loadMore();
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/bay/analyses?limit=2&cursor=cur_2");
    expect(pager.state.items.map((r) => r.analysis_id)).toEqual(["an_3", "an_2", "an_1"]);
    expect(pager.state.hasMore).toBe(false);
    expect(await pager.loadMore()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("records an ApiError and rethrows it", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "key", retryable: false } }), { status: 401 }));
    const pager = createHistoryPager(new BayApiClient({ fetch: fetchImpl }));
    await expect(pager.loadFirst()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(pager.state.status).toBe("error");
    expect(pager.state.error?.code).toBe("UNAUTHORIZED");
  });
});
