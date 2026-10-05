"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChartLine, House, RefreshCw } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import SidebarNav, { type SidebarRecent } from "@/components/primitives/SidebarNav";
import type { UseAnalysisHistoryResult } from "@/lib/api/history";
import type { AnalysisSummary } from "@/lib/api/types";
import { statusLabel } from "@/lib/analysis/labels";
import { watchlistAlertsEnabled } from "@/lib/markets/features";
import { formatQuote, venueLabel } from "@/lib/markets/labels";
import { useWatchlist as useCryptoWatchlist } from "@/lib/markets/useWatchlist";
import { useWatchlist as useStockWatchlist } from "@/lib/market/watchlist";
import { useRecentSearches, type RecentSearch } from "@/lib/search/recents";
import { useWorkspace } from "./workspace";
import type { AlertRule } from "@/lib/markets/alerts";

function displayAnalysis(row: AnalysisSummary): SidebarRecent {
  const symbol = row.instrument?.symbol ?? null;
  const status = row.status === "completed" ? null : statusLabel(row.status);
  return {
    id: `analysis:${row.analysis_id}`,
    label: row.query,
    detail: [symbol, status].filter(Boolean).join(" · ") || undefined,
    at: row.created_at,
  };
}

export function historyRow(row: AnalysisSummary): SidebarRecent {
  return displayAnalysis(row);
}

export function activeAnalysisId(pathname: string | null): string | null {
  const match = /^\/analyses\/([A-Za-z0-9_-]+)/.exec(pathname ?? "");
  return match ? match[1] : null;
}

function activeRecentId(pathname: string | null): string | null {
  const analysisId = activeAnalysisId(pathname);
  if (analysisId) return `analysis:${analysisId}`;
  const crypto = /^\/crypto\/([^/]+)/.exec(pathname ?? "");
  if (crypto) return `crypto:${decodeURIComponent(crypto[1]).toUpperCase()}`;
  const token = /^\/tokens\/([^/]+)/.exec(pathname ?? "");
  if (token) return `token:${decodeURIComponent(token[1])}`;
  return null;
}

function recentRoute(item: RecentSearch): string {
  if (item.id.startsWith("crypto:")) {
    const base = item.id.slice("crypto:".length);
    const query = item.detail ? `?instrument=${encodeURIComponent(item.detail)}` : "";
    return `/crypto/${encodeURIComponent(base)}${query}`;
  }
  if (item.id.startsWith("token:")) return `/tokens/${encodeURIComponent(item.id.slice("token:".length))}`;
  return "/";
}

function recentFireStatus(at: string | undefined): string {
  if (!at || !Number.isFinite(Date.parse(at))) return "Watching";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  const age =
    seconds < 60 ? "just now" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86_400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86_400)}d ago`;
  return `Fired ${age}`;
}

function ruleLabel(rule: AlertRule): string {
  if (rule.kind === "peg") return `${rule.symbol} stablecoin peg`;
  if (rule.kind === "liquidation") {
    return `${rule.symbol} liquidations above $${rule.min_notional_usd.toLocaleString("en-US")} · ${venueLabel(rule.venue)}`;
  }
  const metric = rule.metric === "last_price" ? "last price" : rule.metric === "spread_bps" ? "spread" : "funding rate";
  const value =
    rule.metric === "funding_rate"
      ? `${(rule.value * 100).toFixed(4)}%`
      : rule.metric === "spread_bps"
        ? `${rule.value} bps`
        : formatQuote(rule.value);
  return `${rule.symbol} ${metric} ${rule.op} ${value} · ${venueLabel(rule.venue)}`;
}

function alertRows(rules: AlertRule[], firings: { rule_id: string; at: string }[]): SidebarRecent[] {
  return rules.map((rule) => {
    const latest = firings.find((firing) => firing.rule_id === rule.id);
    return { id: rule.id, label: ruleLabel(rule), detail: recentFireStatus(latest?.at) };
  });
}

function historyLoading() {
  return (
    <div className="px-2 py-2">
      <LoadingState label="Loading history" variant="Dots" showElapsed={false} />
    </div>
  );
}

function historyError(history: UseAnalysisHistoryResult) {
  return (
    <div role="alert" className="px-2 py-2 text-[12.5px] leading-[1.5] text-ink-2">
      <p className="font-medium text-ink">History could not be loaded.</p>
      <p className="mt-0.5">{history.error?.message}</p>
      {history.error && <p className="mt-0.5 font-mono text-[11px] text-ink-3">{history.error.code}</p>}
      <Button variant="secondary" size="xs" className="mt-2" onClick={history.refresh}>
        <RefreshCw size={12} aria-hidden />
        Try again
      </Button>
    </div>
  );
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
  const workspace = useWorkspace();
  const cryptoWatchlist = useCryptoWatchlist();
  const stockWatchlist = useStockWatchlist();
  const showBrowserLists = watchlistAlertsEnabled();
  const localRecents = useRecentSearches(showBrowserLists).items;
  const alertContext = workspace.markets.alerts;
  const activeId = activeRecentId(pathname);
  const activeWatchlistId = pathname?.startsWith("/crypto/") ? `crypto-watch:${searchParams.get("instrument") ?? ""}` : null;

  const recents = useMemo(() => {
    const analyses = history.items.map(displayAnalysis);
    return [...analyses, ...localRecents]
      .sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? ""));
  }, [history.items, localRecents]);

  const watchlistRows = showBrowserLists
    ? [
        ...cryptoWatchlist.keys.flatMap((key): SidebarRecent[] => {
          const separator = key.indexOf("|");
          if (separator <= 0) return [];
          const venue = key.slice(0, separator);
          const symbol = key.slice(separator + 1);
          if (!symbol) return [];
          return [{ id: `crypto-watch:${key}`, label: `${symbol} · ${venueLabel(venue)}` }];
        }),
        ...stockWatchlist.entries.map((entry): SidebarRecent => ({
          id: `stock:${entry.symbol}`,
          label: `${entry.symbol}${entry.as_of ? ` · as of ${entry.as_of}` : ""}`,
        })),
      ]
    : [];
  const alerts = showBrowserLists && alertContext ? alertRows(alertContext.rules, alertContext.firings) : [];

  const firstLoad = !history.loaded && (history.status === "loading" || history.status === "idle");
  const empty = firstLoad
    ? historyLoading()
    : history.status === "error" && !history.loaded
      ? historyError(history)
      : (
          <p className="px-2 py-2 text-[12.5px] leading-[1.5] text-ink-3">
            Search a coin, token or company to start.
          </p>
        );
  const footer = firstLoad
    ? historyLoading()
    : history.status === "error" && !history.loaded
      ? historyError(history)
      : history.status === "loading" && history.loaded
        ? (
            <div className="px-2 py-1.5">
              <LoadingState label="Loading more" variant="Dots" showElapsed={false} />
            </div>
          )
        : history.status === "error" && history.loaded
          ? (
              <div role="alert" className="px-2 py-1.5 text-[12px] text-ink-2">
                <span>{history.error?.message}</span>
                <Button variant="quiet" size="xs" onClick={history.loadMore}>
                  Retry
                </Button>
              </div>
            )
          : history.hasMore
            ? (
                <Button variant="quiet" size="xs" className="w-full justify-start text-ink-2" onClick={history.loadMore}>
                  Load more
                </Button>
              )
            : undefined;

  return (
    <SidebarNav
      fill
      workspaceName="BayAnalytics"
      logo={<ChartLine size={18} aria-hidden />}
      navItems={[{ key: "home", label: "Home", icon: <House size={18} aria-hidden /> }]}
      activeNav={pathname === "/" ? "home" : ""}
      onNavigate={(key) => {
        if (key === "home") {
          onNavigate?.();
          router.push("/");
        }
      }}
      recents={recents}
      {...(showBrowserLists
        ? {
            watchlist: watchlistRows,
            watchlistEmpty: "Your watchlist is empty.",
            activeWatchlistId,
            onPickWatchlist: (id: string) => {
              onNavigate?.();
              if (id.startsWith("crypto-watch:")) {
                const key = id.slice("crypto-watch:".length);
                const separator = key.indexOf("|");
                const symbol = separator >= 0 ? key.slice(separator + 1) : "";
                const base = symbol.split("-")[0]?.toUpperCase();
                if (base) router.push(`/crypto/${encodeURIComponent(base)}?instrument=${encodeURIComponent(key)}`);
                return;
              }
              if (id.startsWith("stock:")) {
                const symbol = id.slice("stock:".length);
                const latest = [...history.items]
                  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                  .find((item) => item.instrument?.symbol === symbol);
                if (latest) router.push(`/analyses/${encodeURIComponent(latest.analysis_id)}`);
                else {
                  workspace.setSearchQuery(symbol);
                  workspace.focusSearch();
                }
              }
            },
            alerts,
            alertsEmpty: "No alert rules yet.",
            onPickAlert: (id: string) => {
              onNavigate?.();
              const rule = alertContext?.rules.find((item) => item.id === id);
              const symbol = rule?.symbol;
              const base = symbol?.split("-")[0]?.toUpperCase();
              if (base) router.push(`/crypto/${encodeURIComponent(base)}`);
            },
          }
        : {})}
      activeId={activeId}
      onPick={(id) => {
        onNavigate?.();
        if (id.startsWith("analysis:")) router.push(`/analyses/${encodeURIComponent(id.slice("analysis:".length))}`);
        else if (id.startsWith("crypto:") || id.startsWith("token:") || id.startsWith("stock:")) {
          const item = localRecents.find((recent) => recent.id === id);
          if (item?.kind === "stock") {
            const latest = [...history.items]
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
              .find((analysis) => analysis.instrument?.symbol.toUpperCase() === item.label.toUpperCase());
            if (latest) router.push(`/analyses/${encodeURIComponent(latest.analysis_id)}`);
            else {
              workspace.setSearchQuery(item.label);
              workspace.focusSearch();
            }
          } else if (item) router.push(recentRoute(item));
          else if (id.startsWith("crypto:")) router.push(`/crypto/${encodeURIComponent(id.slice("crypto:".length))}`);
          else if (id.startsWith("token:")) router.push(`/tokens/${encodeURIComponent(id.slice("token:".length))}`);
        }
      }}
      recentsEmpty={empty}
      recentsFooter={footer}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      labels={{ recents: "Recent searches", search: "Search recent items", noMatches: "No matching searches" }}
    />
  );
}
