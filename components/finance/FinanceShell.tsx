"use client";
/* Shell layout adapted from Beautiful UI's harness (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root. */

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCapabilities } from "@/lib/api/capabilities";
import { useApiDeps } from "@/lib/api/deps";
import { useAnalysisHistory } from "@/lib/api/history";
import MarketsProvider, { useMarketsContext as useProviderMarkets } from "@/components/markets/MarketsProvider";
import type { UseMarketsResult } from "@/lib/markets/useMarkets";
import HistorySidebar from "./HistorySidebar";
import RecentAssetTracker from "./RecentAssetTracker";
import { WorkspaceContext, type WorkspaceValue } from "./workspace";

/* ─────────────────────────────────────────────────────────
 * FINANCE SHELL
 * The Beautiful UI harness frame (canvas, rounded page pane)
 * around the analysis workspace: the history sidebar on the
 * left and the routed page on the right. On narrow screens
 * the sidebar becomes a drawer opened from the page header.
 * History and capabilities are loaded once here and shared.
 * ───────────────────────────────────────────────────────── */

const HISTORY_PAGE_SIZE = 30;

export default function FinanceShell({ children, marketsOverride }: { children: ReactNode; marketsOverride?: UseMarketsResult }) {
  return (
    <MarketsProvider value={marketsOverride}>
      <FinanceWorkspace>{children}</FinanceWorkspace>
    </MarketsProvider>
  );
}

function FinanceWorkspace({ children }: { children: ReactNode }) {
  const { client } = useApiDeps();
  const history = useAnalysisHistory(client, { limit: HISTORY_PAGE_SIZE });
  const capabilities = useCapabilities(client);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const markets = useProviderMarkets();

  const openSidebar = useCallback(() => setDrawerOpen(true), []);
  const focusSearch = useCallback(() => searchInputRef.current?.focus(), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const value: WorkspaceValue = { history, capabilities, markets, searchQuery, setSearchQuery, focusSearch, searchInputRef, openSidebar };

  return (
    <WorkspaceContext.Provider value={value}>
      <Suspense fallback={null}>
        <RecentAssetTracker />
      </Suspense>
      <main className="flex h-[100dvh] gap-2.5 bg-canvas p-1.5 text-ink sm:p-2.5">
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close history"
            onClick={closeDrawer}
            className="fixed inset-0 z-30 bg-[oklch(0_0_0/0.35)] md:hidden"
          />
        )}
        <div
          className={`${
            drawerOpen ? "fixed inset-y-0 left-0 z-40 flex bg-canvas p-2.5 shadow-overlay" : "hidden"
          } md:static md:z-auto md:flex md:bg-transparent md:p-0 md:shadow-none`}
        >
          <Suspense fallback={<div className="h-full w-[224px]" aria-hidden />}>
            <HistorySidebar
              history={history}
              collapsed={drawerOpen ? false : railCollapsed}
              onCollapsedChange={(collapsed) => {
                if (drawerOpen) setDrawerOpen(false);
                else setRailCollapsed(collapsed);
              }}
              onNavigate={closeDrawer}
            />
          </Suspense>
        </div>
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
          {children}
        </section>
      </main>
    </WorkspaceContext.Provider>
  );
}
