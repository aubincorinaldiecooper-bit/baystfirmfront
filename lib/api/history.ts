/**
 * History pagination for `GET /analyses` (cursor-based, newest first).
 *
 * The backend returns `{analyses, next_cursor}`; `next_cursor` is opaque and
 * is passed back as `?cursor=` for the following page, `null` when the list
 * is exhausted. The pure helpers here keep the merge rules testable; the hook
 * is what the sidebar will use.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError, bayApi, isAbortError, isApiError, type BayApiClient } from "./client";
import type { AnalysisListResponse, AnalysisSummary } from "./types";

export const DEFAULT_HISTORY_PAGE_SIZE = 50;

export interface HistoryState {
  items: AnalysisSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: ApiError | null;
  /** True once at least one page has been loaded. */
  loaded: boolean;
}

export const initialHistoryState: HistoryState = {
  items: [],
  nextCursor: null,
  hasMore: false,
  status: "idle",
  error: null,
  loaded: false,
};

/** Append a page, dropping rows already present (by analysis_id) and keeping order. */
export function mergeHistoryPage(existing: AnalysisSummary[], page: AnalysisSummary[]): AnalysisSummary[] {
  const seen = new Set(existing.map((row) => row.analysis_id));
  const fresh = page.filter((row) => {
    if (seen.has(row.analysis_id)) return false;
    seen.add(row.analysis_id);
    return true;
  });
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** Replace a row in place (e.g. when an analysis finishes), or prepend it when new. */
export function upsertHistoryRow(items: AnalysisSummary[], row: AnalysisSummary): AnalysisSummary[] {
  const index = items.findIndex((r) => r.analysis_id === row.analysis_id);
  if (index === -1) return [row, ...items];
  const next = items.slice();
  next[index] = row;
  return next;
}

/**
 * Merge a freshly read first page into a list that may hold more pages: the
 * page's rows come first (newest, with their current status), every other
 * loaded row keeps its place after them. Cursors are keysets, so the cursor
 * of the oldest loaded row stays valid when newer rows appear.
 */
export function mergeHeadPage(state: HistoryState, page: AnalysisListResponse): HistoryState {
  const fresh = new Set(page.analyses.map((row) => row.analysis_id));
  const rest = state.items.filter((row) => !fresh.has(row.analysis_id));
  const items = mergeHistoryPage([], [...page.analyses, ...rest]);
  const keepCursor = state.loaded && rest.length > 0;
  const nextCursor = keepCursor ? state.nextCursor : page.next_cursor;
  return {
    items,
    nextCursor,
    hasMore: keepCursor ? state.hasMore : page.next_cursor !== null,
    status: "ready",
    error: null,
    loaded: true,
  };
}

export type HistoryAction =
  | { type: "load_start"; reset: boolean }
  | { type: "page"; page: AnalysisListResponse; reset: boolean }
  | { type: "head"; page: AnalysisListResponse }
  | { type: "failed"; error: ApiError }
  | { type: "upsert"; row: AnalysisSummary };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "load_start":
      return { ...state, status: "loading", error: null, items: action.reset ? [] : state.items };
    case "page": {
      const items = action.reset ? mergeHistoryPage([], action.page.analyses) : mergeHistoryPage(state.items, action.page.analyses);
      return {
        items,
        nextCursor: action.page.next_cursor,
        hasMore: action.page.next_cursor !== null,
        status: "ready",
        error: null,
        loaded: true,
      };
    }
    case "head":
      return mergeHeadPage(state, action.page);
    case "failed":
      return { ...state, status: "error", error: action.error };
    case "upsert":
      return { ...state, items: upsertHistoryRow(state.items, action.row) };
    default:
      return state;
  }
}

export interface HistoryPager {
  /** Load (or reload) the first page. */
  loadFirst: (signal?: AbortSignal) => Promise<AnalysisListResponse>;
  /** Load the next page after the last `next_cursor`. Resolves null when exhausted. */
  loadMore: (signal?: AbortSignal) => Promise<AnalysisListResponse | null>;
  readonly state: HistoryState;
}

/** Framework-free pager over the client; the hook below wraps it in React state. */
export function createHistoryPager(client: BayApiClient = bayApi, limit = DEFAULT_HISTORY_PAGE_SIZE): HistoryPager {
  let state = initialHistoryState;
  const commit = (action: HistoryAction) => {
    state = historyReducer(state, action);
  };
  return {
    get state() {
      return state;
    },
    async loadFirst(signal) {
      commit({ type: "load_start", reset: true });
      try {
        const page = await client.listAnalyses({ limit }, { signal });
        commit({ type: "page", page, reset: true });
        return page;
      } catch (error) {
        if (isApiError(error)) commit({ type: "failed", error });
        throw error;
      }
    },
    async loadMore(signal) {
      if (state.loaded && !state.hasMore) return null;
      const cursor = state.nextCursor;
      commit({ type: "load_start", reset: false });
      try {
        const page = await client.listAnalyses({ limit, cursor }, { signal });
        commit({ type: "page", page, reset: false });
        return page;
      } catch (error) {
        if (isApiError(error)) commit({ type: "failed", error });
        throw error;
      }
    },
  };
}

export interface UseAnalysisHistoryResult extends HistoryState {
  loadMore: () => void;
  refresh: () => void;
  /** Re-read the first page and merge it in, keeping pages already loaded (after a create or a finish). */
  refreshHead: () => void;
  upsert: (row: AnalysisSummary) => void;
}

/** History for the sidebar: first page on mount, `loadMore` for the rest. */
export function useAnalysisHistory(
  client: BayApiClient = bayApi,
  options: { limit?: number; enabled?: boolean } = {},
): UseAnalysisHistoryResult {
  const limit = options.limit ?? DEFAULT_HISTORY_PAGE_SIZE;
  const enabled = options.enabled ?? true;
  const [state, dispatch] = useReducer(historyReducer, initialHistoryState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null, reset: boolean) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      dispatch({ type: "load_start", reset });
      try {
        const page = await client.listAnalyses({ limit, cursor }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        dispatch({ type: "page", page, reset });
      } catch (cause) {
        if (controller.signal.aborted || isAbortError(cause)) return;
        dispatch({
          type: "failed",
          error: isApiError(cause)
            ? cause
            : new ApiError({ code: "NETWORK_ERROR", message: "Could not load history.", retryable: true, httpStatus: 0, cause }),
        });
      }
    },
    [client, limit],
  );

  useEffect(() => {
    if (!enabled) return;
    void fetchPage(null, true);
    return () => inFlight.current?.abort();
  }, [enabled, fetchPage]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (current.status === "loading" || (current.loaded && !current.hasMore)) return;
    void fetchPage(current.nextCursor, false);
  }, [fetchPage]);

  const refresh = useCallback(() => {
    void fetchPage(null, true);
  }, [fetchPage]);

  const upsert = useCallback((row: AnalysisSummary) => dispatch({ type: "upsert", row }), []);

  const headController = useRef<AbortController | null>(null);
  const refreshHead = useCallback(() => {
    if (!stateRef.current.loaded) {
      void fetchPage(null, true);
      return;
    }
    headController.current?.abort();
    const controller = new AbortController();
    headController.current = controller;
    client
      .listAnalyses({ limit }, { signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted) dispatch({ type: "head", page });
      })
      .catch(() => {
        /* the loaded list stays as it is; the next refresh or load-more reports errors */
      });
  }, [client, fetchPage, limit]);

  useEffect(() => () => headController.current?.abort(), []);

  return { ...state, loadMore, refresh, refreshHead, upsert };
}
