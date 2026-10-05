"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { useMarketsContext } from "@/components/markets/MarketsProvider";
import TokensView from "@/components/markets/TokensView";
import { fetchCandles } from "@/lib/markets/client";
import { formatClock, formatQuote, venueLabel } from "@/lib/markets/labels";
import { groupInstrumentsByBase, type BaseInstrumentGroup } from "@/lib/markets/instruments";
import { cryptoMove, rankMarketMoves, solanaMove } from "@/lib/markets/moves";
import { instrumentRows } from "@/lib/markets/state";
import { sourceLabel } from "@/lib/markets/tokens";
import type { CandleResponse, NewTokensFeed } from "@/lib/markets/types";
import PageHeader from "./PageHeader";
import { Badge, Notice, Section } from "./ui";
import { useWorkspace } from "./workspace";

const STREAM_STATUS = {
  connecting: { label: "Connecting", tone: "orange" as const },
  live: { label: "Live", tone: "green" as const },
  reconnecting: { label: "Reconnecting", tone: "orange" as const },
  closed: { label: "Stream closed", tone: "red" as const },
};

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "time unavailable";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function CryptoOverview({
  groups,
  snapshotLoaded,
  snapshotError,
  stream,
  reload,
}: {
  groups: BaseInstrumentGroup[];
  snapshotLoaded: boolean;
  snapshotError: Error | null;
  stream: keyof typeof STREAM_STATUS;
  reload: () => void;
}) {
  const status = STREAM_STATUS[stream];
  return (
    <Section id="crypto-overview" title="Crypto — live from exchanges" count={groups.length} aside={<StatusPill tone={status.tone}>{status.label}</StatusPill>}>
      {snapshotError && (
        <Notice
          kind="error"
          role="alert"
          title="The crypto backend could not be read."
          actions={
            <Button variant="secondary" size="xs" onClick={reload}>
              Try again
            </Button>
          }
        >
          {snapshotError.message}
        </Notice>
      )}
      {!snapshotLoaded && groups.length === 0 ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Waiting for the exchange snapshot…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">No recent crypto trades are available.</p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
          <table className="w-full min-w-[620px] text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-[0.04em] text-ink-3">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-2 py-2 text-right font-medium">Price</th>
                <th className="px-2 py-2 font-medium">Venues</th>
                <th className="px-2 py-2 font-medium">Last trade</th>
                <th className="px-3 py-2 font-medium">Stream</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.base} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/crypto/${encodeURIComponent(group.base)}`} className="font-semibold text-ink hover:text-accent">
                      {group.base}
                    </Link>
                    {group.hasPerpetual && <Badge tone="neutral">Perp</Badge>}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink">
                    {formatQuote(group.preferred.last.price)}
                  </td>
                  <td className="px-2 py-2 text-ink-2">
                    {group.venueCount} · {venueLabel(group.preferred.venue)}
                  </td>
                  <td className="px-2 py-2 font-mono text-[11.5px] text-ink-3">{formatClock(group.preferred.last.exchange_timestamp)}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">
        Preferred price uses Coinbase USD spot when available, otherwise a spot market, then a perpetual market. {groups.reduce((count, group) => count + group.instruments.length, 0)} instruments across these bases.
      </p>
    </Section>
  );
}

function StocksOverview() {
  const { history } = useWorkspace();
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return history.items
      .filter((item) => item.status === "completed" && item.instrument !== null)
      .slice()
      .sort((a, b) => Date.parse(b.completed_at ?? b.created_at) - Date.parse(a.completed_at ?? a.created_at))
      .filter((item) => {
        const symbol = item.instrument?.symbol.trim().toUpperCase();
        if (!symbol || seen.has(symbol)) return false;
        seen.add(symbol);
        return true;
      })
      .slice(0, 8);
  }, [history.items]);

  return (
    <Section id="stock-research" title="Stocks — fresh on search" count={rows.length}>
      {rows.length > 0 ? (
        <div className="divide-y divide-line rounded-[10px] bg-surface shadow-card">
          {rows.map((item) => (
            <Link
              key={item.analysis_id}
              href={`/analyses/${encodeURIComponent(item.analysis_id)}`}
              className="flex items-center justify-between gap-4 px-3 py-3 hover:bg-hover-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {item.instrument?.symbol}
                  {item.instrument?.name ? ` · ${item.instrument.name}` : ""}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ink-2">{item.query}</span>
              </span>
              <span className="shrink-0 text-[11.5px] text-ink-3">researched {relativeTime(item.completed_at ?? item.created_at)}</span>
            </Link>
          ))}
        </div>
      ) : history.status === "loading" || !history.loaded ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Loading company research…</p>
      ) : (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-2 shadow-card">
          Search a company to research it. Each search pulls fresh web data at that moment.
        </p>
      )}
      {history.error && <p role="status" className="mt-2 text-[11.5px] text-ink-3">Research history could not be refreshed: {history.error.message}</p>}
    </Section>
  );
}

function BiggestMoves({
  groups,
  snapshotLoaded,
  tokenFeed,
}: {
  groups: BaseInstrumentGroup[];
  snapshotLoaded: boolean;
  tokenFeed: NewTokensFeed | null;
}) {
  const [candles, setCandles] = useState<Record<string, CandleResponse | null>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  useEffect(() => {
    if (!snapshotLoaded) return;
    if (!groupsRef.current.length) {
      setCandles({});
      setFailed([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setFailed([]);
    Promise.all(
      groupsRef.current.map(async (group) => {
        try {
          const response = await fetchCandles(group.preferred.venue, group.preferred.symbol, "1h", fetch, controller.signal, [], 25);
          return [group.base, response, false] as const;
        } catch (cause) {
          if (cause instanceof Error && cause.name === "AbortError") return [group.base, null, false] as const;
          return [group.base, null, true] as const;
        }
      }),
    ).then((results) => {
      if (!active) return;
      setCandles(Object.fromEntries(results.map(([base, response]) => [base, response])));
      setFailed(results.filter(([, , error]) => error).map(([base]) => base));
      setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [generation, snapshotLoaded]);

  const moves = useMemo(() => {
    const crypto = groups.flatMap((group) => {
      const response = candles[group.base];
      return response ? [cryptoMove(group, response.candles)].filter((move) => move !== null) : [];
    });
    const solana = (tokenFeed?.tokens ?? []).flatMap((card) => {
      const fact = card.facts.market;
      if (fact.status !== "ok" || !fact.value) return [];
      const move = solanaMove(card.mint, card.symbol, fact.value, sourceLabel(fact.source), Date.now());
      return move ? [move] : [];
    });
    return rankMarketMoves([...crypto, ...solana]);
  }, [candles, groups, tokenFeed]);

  return (
    <Section
      id="biggest-moves"
      title="Biggest moves now"
      count={moves.length}
      aside={
        <Button
          variant="secondary"
          size="xs"
          disabled={loading || !snapshotLoaded}
          onClick={() => setGeneration((value) => value + 1)}
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
      }
    >
      <p className="mb-3 text-[11.5px] text-ink-3">Largest recent moves across what we cover. Not a recommendation.</p>
      {failed.length > 0 && (
        <p role="status" className="mb-2 text-[11.5px] text-ink-3">
          Candle history unavailable for {failed.length} instrument{failed.length === 1 ? "" : "s"}.
        </p>
      )}
      {moves.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {moves.map((move) => (
            <Link key={move.id} href={move.href} className="rounded-[10px] bg-surface p-3 shadow-card hover:bg-hover-2">
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-3">
                {move.kind} · {move.windowLabel}
              </span>
              <span className="mt-1 flex items-center justify-between gap-3">
                <span className="truncate text-[13px] font-semibold text-ink"><bdi>{move.label}</bdi></span>
                <span className={`font-mono text-[13px] tabular-nums ${move.change24hPct > 0 ? "text-green" : move.change24hPct < 0 ? "text-red" : "text-ink-2"}`}>
                  {move.change24hPct > 0 ? "+" : ""}{move.change24hPct.toFixed(2)}%
                </span>
              </span>
              {move.change1hPct !== null && (
                <span className="mt-1 block text-[11.5px] text-ink-2">
                  1h {move.change1hPct > 0 ? "+" : ""}{move.change1hPct.toFixed(2)}%
                </span>
              )}
              <span className="mt-1 block truncate text-[10.5px] text-ink-3">{move.source}</span>
            </Link>
          ))}
        </div>
      ) : loading ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Loading recent candle history…</p>
      ) : !snapshotLoaded ? (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Waiting for the market snapshot…</p>
      ) : (
        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
          No recent moves have enough reported history yet.
        </p>
      )}
    </Section>
  );
}

export default function HomeView() {
  const router = useRouter();
  const { state, snapshotError, stream, reload } = useMarketsContext();
  const [tokenFeed, setTokenFeed] = useState<NewTokensFeed | null>(null);
  const groups = useMemo(() => groupInstrumentsByBase(instrumentRows(state)), [state]);

  return (
    <>
      <PageHeader title="Markets" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Markets</h1>
          <p className="mt-2 max-w-[760px] text-[14px] leading-[1.6] text-ink-2">
            Market states and probabilities only, not investment advice. No trading, wallets or custody. Live public crypto market data is normalized by the Baystfirm backend; company research uses fresh web-search results.
          </p>
          <BiggestMoves groups={groups} snapshotLoaded={state.snapshotLoaded} tokenFeed={tokenFeed} />
          <div className="grid grid-cols-1 gap-x-8 xl:grid-cols-2">
            <CryptoOverview
              groups={groups}
              snapshotLoaded={state.snapshotLoaded}
              snapshotError={snapshotError}
              stream={stream}
              reload={reload}
            />
            <StocksOverview />
          </div>
          <TokensView
            embedded
            onFeedUpdate={setTokenFeed}
            onOpenTokenPage={(mint) => router.push(`/tokens/${encodeURIComponent(mint)}`)}
          />
        </div>
      </div>
    </>
  );
}
