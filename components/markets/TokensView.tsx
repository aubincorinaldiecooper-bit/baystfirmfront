"use client";

/* Solana new and meme tokens. Each row shows the key facts as badges you can
 * read at a glance; opening a row shows every fact with its source and when it
 * was read. Our own on-chain checks come first; RugCheck appears only as a
 * labelled second opinion. Every value is a backend field. */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import PageHeader from "@/components/finance/PageHeader";
import { Notice, Section } from "@/components/finance/ui";
import { fetchNewTokens, fetchTokenCard, MarketsError } from "@/lib/markets/client";
import { formatClock } from "@/lib/markets/labels";
import {
  SOLANA_MINT,
  formatAge,
  formatUsd,
  shortAddress,
  sourceLabel,
  timeOf,
} from "@/lib/markets/tokens";
import type { NewTokensFeed, TokenCard } from "@/lib/markets/types";
import TokenFactsList, { Glances } from "./TokenFactsList";

export const FEED_LIMIT = 50;
/** The backend's discovery cycle runs once a minute; read the feed as often. */
export const FEED_REFRESH_MS = 60_000;

const asMarketsError = (cause: unknown) =>
  cause instanceof MarketsError ? cause : new MarketsError("The crypto backend could not be read.", 0, "BAD_RESPONSE");

const tokenName = (card: TokenCard) => card.symbol ?? card.name ?? shortAddress(card.mint);

const readAt = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${formatClock(iso)}` : "time unknown");

interface OpenToken {
  mint: string;
  card: TokenCard | null;
  error: MarketsError | null;
  loading: boolean;
}

function TokenDetails({
  open,
  onClose,
  onOpenTokenPage,
}: {
  open: OpenToken;
  onClose: () => void;
  onOpenTokenPage?: (mint: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { card } = open;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-details-title"
        className="w-full max-w-[760px] rounded-[12px] bg-surface p-5 shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="token-details-title" className="text-[17px] font-semibold text-ink">
              {card ? (
                <>
                  <bdi>{tokenName(card)}</bdi>
                  {card.name && card.symbol ? (
                    <>
                      {" · "}
                      <bdi>{card.name}</bdi>
                    </>
                  ) : null}
                </>
              ) : (
                shortAddress(open.mint)
              )}
            </h2>
            <p className="mt-1 break-all font-mono text-[11.5px] text-ink-3">{open.mint}</p>
            {card && (
              <p className="mt-1 text-[12px] text-ink-3">
                {card.token_program === "token-2022" ? "Token-2022 program" : card.token_program === "spl-token" ? "Standard token program" : "Token program unknown"} ·
                checked {readAt(card.checked_at)}
                {open.loading ? " · refreshing…" : ""}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close token details"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover-2 hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        {card && onOpenTokenPage && (
          <Button
            variant="secondary"
            size="xs"
            className="mt-3"
            onClick={() => {
              onClose();
              onOpenTokenPage(open.mint);
            }}
          >
            Open token page
          </Button>
        )}

        {open.error && (
          <div className="mt-4">
            <Notice kind="error" role="alert" title="This token could not be checked.">
              {open.error.message} <span className="font-mono text-ink-3">{open.error.code}</span>
            </Notice>
          </div>
        )}
        {!card && open.loading && <p className="mt-4 text-[12.5px] text-ink-3">Checking this token…</p>}

        {card && (
          <TokenFactsList card={card} />
        )}
      </div>
    </div>
  );
}

export default function TokensView({
  fetchImpl,
  embedded = false,
  onOpenTokenPage,
  onFeedUpdate,
}: {
  fetchImpl?: typeof fetch;
  embedded?: boolean;
  onOpenTokenPage?: (mint: string) => void;
  onFeedUpdate?: (feed: NewTokensFeed) => void;
} = {}) {
  const [feed, setFeed] = useState<NewTokensFeed | null>(null);
  const [feedError, setFeedError] = useState<MarketsError | null>(null);
  const [readAtMs, setReadAtMs] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenToken | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const lookup = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const read = () => {
      fetchNewTokens(FEED_LIMIT, fetchImpl, controller.signal)
        .then((value) => {
          setFeed(value);
          onFeedUpdate?.(value);
          setFeedError(null);
          setReadAtMs(Date.now());
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setFeedError(asMarketsError(cause));
        });
    };
    read();
    const timer = window.setInterval(read, FEED_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [fetchImpl, generation, onFeedUpdate]);

  useEffect(() => () => lookup.current?.abort(), []);

  const openToken = useCallback(
    (mint: string, cached: TokenCard | null) => {
      lookup.current?.abort();
      const controller = new AbortController();
      lookup.current = controller;
      setOpen({ mint, card: cached, error: null, loading: true });
      fetchTokenCard(mint, fetchImpl, controller.signal)
        .then((card) => setOpen((current) => (current?.mint === mint ? { mint, card, error: null, loading: false } : current)))
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setOpen((current) => (current?.mint === mint ? { ...current, error: asMarketsError(cause), loading: false } : current));
        });
    },
    [fetchImpl],
  );

  const close = useCallback(() => {
    lookup.current?.abort();
    setOpen(null);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const mint = address.trim();
    if (!SOLANA_MINT.test(mint)) {
      setAddressError("That isn't a Solana token address.");
      return;
    }
    setAddressError(null);
    openToken(mint, feed?.tokens.find((card) => card.mint === mint) ?? null);
  };

  const status = feedError
    ? { label: "Backend unreachable", tone: "red" as const }
    : !feed
      ? { label: "Reading…", tone: "neutral" as const }
      : feed.status === "warming"
        ? { label: "Warming up", tone: "orange" as const }
        : { label: "Live", tone: "green" as const };
  const tokens = feed?.tokens ?? [];

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Tokens"
          actions={
            <StatusPill tone={status.tone} className="h-6 text-[12px]">
              {status.label}
            </StatusPill>
          }
        />
      )}
      <div className={`min-h-0 ${embedded ? "" : "flex-1 overflow-y-auto"}`}>
        <div className={embedded ? "" : "mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-8"}>
          {!embedded && (
            <>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">New &amp; meme tokens · Solana</h1>
          <p className="mt-2 max-w-[720px] text-[14px] leading-[1.6] text-ink-2">
            Facts about each token read from public sources, with where and when each was read. There is no overall safety verdict, and
            this is not investment advice. No trading, wallets or custody.
          </p>

          <form onSubmit={submit} className="mt-5 flex max-w-[720px] flex-wrap items-start gap-2">
            <label htmlFor="token-address" className="sr-only">
              Solana token address
            </label>
            <input
              id="token-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Paste a Solana token address"
              autoComplete="off"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 rounded-[8px] bg-surface px-3 font-mono text-[12.5px] text-ink shadow-card outline-none placeholder:font-sans placeholder:text-ink-3 focus:ring-2 focus:ring-accent"
            />
            <Button type="submit" variant="primary" size="md">
              Check token
            </Button>
            {addressError && (
              <p role="alert" className="w-full text-[12.5px] text-red">
                {addressError}
              </p>
            )}
          </form>
            </>
          )}

          {feedError && (
            <div className="mt-6">
              <Notice
                kind="error"
                role="alert"
                title="The token feed could not be read."
                actions={
                  <Button variant="secondary" size="xs" onClick={() => setGeneration((value) => value + 1)}>
                    <RefreshCw size={12} aria-hidden />
                    Try again
                  </Button>
                }
              >
                {feedError.message} <span className="font-mono text-ink-3">{feedError.code}</span>
              </Notice>
            </div>
          )}

          <Section
            id="new-solana-tokens"
            title="New Solana tokens — updated every minute"
            count={tokens.length}
            aside={
              <StatusPill tone={status.tone} className="h-6 text-[12px]">
                {status.label}
              </StatusPill>
            }
          >
            {!feed ? (
              <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Reading the token feed…</p>
            ) : feed.status === "warming" && tokens.length === 0 ? (
              <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
                The backend is reading its first batch of new pools. Launches appear here within a minute or two.
              </p>
            ) : tokens.length === 0 ? (
              <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">No new launches seen yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
                <table className="w-full min-w-[860px] text-left text-[12.5px]">
                  <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 font-medium">Token</th>
                      <th className="px-2 py-2 font-medium">Pool age</th>
                      <th className="px-2 py-2 text-right font-medium">Liquidity</th>
                      <th className="px-2 py-2 text-right font-medium">24h volume</th>
                      <th className="px-2 py-2 font-medium">At a glance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.slice(0, visibleCount).map((card) => {
                      const market = card.facts.market.status === "ok" ? card.facts.market.value : null;
                      return (
                        <tr
                          key={card.mint}
                          onClick={() => openToken(card.mint, card)}
                          className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-hover-2"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              aria-label={`Open details for ${tokenName(card)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openToken(card.mint, card);
                              }}
                              className="text-left"
                            >
                              <span className="block font-medium text-ink"><bdi>{tokenName(card)}</bdi></span>
                              <span className="block font-mono text-[11.5px] text-ink-3">{shortAddress(card.mint)}</span>
                            </button>
                          </td>
                          <td className="px-2 py-2.5 font-mono tabular-nums text-ink-2">
                            {market ? formatAge(market.pool_created_at, readAtMs ?? timeOf(card.checked_at) ?? 0) : "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink">{formatUsd(market?.liquidity_usd)}</td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink">{formatUsd(market?.volume_24h_usd)}</td>
                          <td className="px-2 py-2.5">
                            <Glances card={card} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {tokens.length > visibleCount && (
              <Button variant="secondary" size="xs" className="mt-3" onClick={() => setVisibleCount((value) => value + 12)}>
                Show more
              </Button>
            )}
            {feed && (
              <div className="mt-2 space-y-1 text-[12px] text-ink-3">
                <p>
                  Sources:{" "}
                  {feed.sources
                    .map((source) => `${sourceLabel(source.name)} ${source.ok ? (source.fetched_at ? `read ${formatClock(source.fetched_at)}` : "not read yet") : `failed (${source.error ?? "error"})`}`)
                    .join(" · ")}
                  . New pools via GeckoTerminal (geckoterminal.com).
                </p>
                <p>{feed.note}</p>
              </div>
            )}
          </Section>
        </div>
      </div>
      {open && <TokenDetails open={open} onClose={close} onOpenTokenPage={onOpenTokenPage} />}
    </>
  );
}
