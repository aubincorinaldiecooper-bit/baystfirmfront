"use client";

/* The history sidebar: real rows from GET /analyses (keyset pages, newest
 * first), a load-more control while the backend reports a next cursor, and
 * loading / empty / error states. Selecting a row opens /analyses/{id}. */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, ChartLine, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import SidebarNav, { type SidebarRecent } from "@/components/primitives/SidebarNav";
import type { UseAnalysisHistoryResult } from "@/lib/api/history";
import type { AnalysisSummary } from "@/lib/api/types";
import { statusLabel } from "@/lib/analysis/labels";
import { watchlistAlertsEnabled } from "@/lib/markets/features";
import { venueLabel } from "@/lib/markets/labels";
import { useWatchlist } from "@/lib/markets/useWatchlist";

export function historyRow(row: AnalysisSummary): SidebarRecent {
  const symbol = row.instrument?.symbol ?? null;
  const status = row.status === "completed" ? null : statusLabel(row.status);
  return {
    id: row.analysis_id,
    label: row.query,
    detail: [symbol, status].filter(Boolean).join(" · ") || undefined,
  };
}

export function activeAnalysisId(pathname: string | null): string | null {
  const match = /^\/analyses\/([A-Za-z0-9_-]+)/.exec(pathname ?? "");
  return match ? match[1] : null;
}

export default function HistorySidebar({
  history,
  collapsed,
  onCollapsedChange,
  onNavigate,
}: {
  history: UseAnalysisHistoryResult;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchlist = useWatchlist();
  const showWatchlist = watchlistAlertsEnabled();
  const activeId = activeAnalysisId(pathname);
  const activeWatchlistId = pathname?.startsWith("/markets") ? searchParams.get("instrument") : null;
  const watchlistRows = watchlist.keys.flatMap((key): SidebarRecent[] => {
    const separator = key.indexOf("|");
    if (separator <= 0) return [];
    const venue = key.slice(0, separator);
    const symbol = key.slice(separator + 1);
    if (!symbol) return [];
    return [{ id: key, label: `${symbol} · ${venueLabel(venue)}` }];
  });

  const firstLoad = !history.loaded && (history.status === "loading" || history.status === "idle");
  const empty = firstLoad ? (
    <div className="px-2 py-2">
      <LoadingState label="Loading history" variant="Dots" showElapsed={false} />
    </div>
  ) : history.status === "error" && !history.loaded ? (
    <div role="alert" className="px-2 py-2 text-[12.5px] leading-[1.5] text-ink-2">
      <p className="font-medium text-ink">History could not be loaded.</p>
      <p className="mt-0.5">{history.error?.message}</p>
      {history.error && <p className="mt-0.5 font-mono text-[11px] text-ink-3">{history.error.code}</p>}
      <Button variant="secondary" size="xs" className="mt-2" onClick={history.refresh}>
        <RefreshCw size={12} aria-hidden />
        Try again
      </Button>
    </div>
  ) : (
    <p className="px-2 py-2 text-[12.5px] leading-[1.5] text-ink-3">No analyses yet. Ask a question to start one.</p>
  );

  const footer =
    history.status === "loading" && history.loaded ? (
      <div className="px-2 py-1.5">
        <LoadingState label="Loading more" variant="Dots" showElapsed={false} />
      </div>
    ) : history.status === "error" && history.loaded ? (
      <div role="alert" className="px-2 py-1.5 text-[12px] text-ink-2">
        <span>{history.error?.message}</span>
        <Button variant="quiet" size="xs" onClick={history.loadMore}>
          Retry
        </Button>
      </div>
    ) : history.hasMore ? (
      <Button variant="quiet" size="xs" className="w-full justify-start text-ink-2" onClick={history.loadMore}>
        Load more
      </Button>
    ) : undefined;

  return (
    <SidebarNav
      fill
      workspaceName="BayAnalytics"
      logo={<ChartLine size={18} aria-hidden />}
      navItems={[
        { key: "markets", label: "Markets", icon: <Activity size={18} aria-hidden /> },
        { key: "status", label: "Status", icon: <Server size={18} aria-hidden /> },
      ]}
      activeNav={pathname?.startsWith("/status") ? "status" : pathname?.startsWith("/markets") ? "markets" : ""}
      onNavigate={(key) => {
        if (key === "markets") {
          onNavigate?.();
          router.push("/markets");
        } else if (key === "status") {
          onNavigate?.();
          router.push("/status");
        }
      }}
      newLabel="New analysis"
      onNew={() => {
        onNavigate?.();
        router.push("/");
      }}
      recents={history.items.map(historyRow)}
      {...(showWatchlist
        ? {
            watchlist: watchlistRows,
            watchlistEmpty: "Star instruments on Markets to see them here",
            activeWatchlistId,
            onPickWatchlist: (key: string) => {
              onNavigate?.();
              router.push(`/markets?instrument=${encodeURIComponent(key)}`);
            },
          }
        : {})}
      activeId={activeId}
      onPick={(id) => {
        onNavigate?.();
        router.push(`/analyses/${encodeURIComponent(id)}`);
      }}
      recentsEmpty={empty}
      recentsFooter={footer}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      labels={{ recents: "History", search: "Search history", noMatches: "No matching analyses" }}
    />
  );
}
