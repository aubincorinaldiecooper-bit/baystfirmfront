"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Copy, ExternalLink } from "lucide-react";
import { StatusPill } from "@/components/atoms/StatusPill";
import PageHeader from "@/components/finance/PageHeader";
import { Notice, Section } from "@/components/finance/ui";
import CandleChartPanel from "@/components/markets/CandleChartPanel";
import NewsSection from "@/components/markets/NewsSection";
import TokenFactsList from "@/components/markets/TokenFactsList";
import { fetchTokenCard, fetchTokenCandles, fetchTokenPrice, MarketsError } from "@/lib/markets/client";
import { formatClock } from "@/lib/markets/labels";
import { formatUsd, shortAddress, SOLANA_MINT } from "@/lib/markets/tokens";
import type { Tick } from "@/lib/markets/state";
import {
  SOLANA_CANDLE_INTERVALS,
  type CandleInterval,
  type SolanaCandleInterval,
  type TokenCard,
  type TokenCandleResponse,
  type TokenPriceResponse,
} from "@/lib/markets/types";

function tokenAttribution(response: import("@/lib/markets/types").CandleResponse) {
  if (!("pool_address" in response)) return null;
  const tokenResponse = response as TokenCandleResponse;
  const poolUrl = tokenResponse.source_url_template.replace("{pool}", tokenResponse.pool_address);
  return (
    <p className="mt-1 text-[11.5px] text-ink-3">
      Chart:{" "}
      <a className="inline-flex items-center gap-1 text-accent hover:underline" href={poolUrl} target="_blank" rel="noreferrer">
        GeckoTerminal · main pool {tokenResponse.dex_id} <bdi>{shortAddress(tokenResponse.pool_address)}</bdi>{" "}
        <ExternalLink size={11} aria-hidden />
      </a>{" "}
      · USD · fetched {formatClock(tokenResponse.fetched_at)}
    </p>
  );
}

export default function TokenAssetView({
  mint,
  fetchImpl,
}: {
  mint: string;
  fetchImpl?: typeof fetch;
}) {
  const [card, setCard] = useState<TokenCard | null>(null);
  const [error, setError] = useState<MarketsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [priceResponse, setPriceResponse] = useState<TokenPriceResponse | null>(null);
  const [priceStale, setPriceStale] = useState(false);
  const [priceTicks, setPriceTicks] = useState<Tick[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const validMint = SOLANA_MINT.test(mint);
  const cardLoaded = card?.mint === mint;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let refreshing = false;
    setCard(null);
    setError(null);
    setRefreshFailed(false);
    setPriceResponse(null);
    setPriceStale(false);
    setPriceTicks([]);
    setCopyState("idle");
    if (!validMint) {
      setError(new MarketsError("That address is not a Solana token mint.", 400, "INVALID_MINT"));
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }
    setLoading(true);
    fetchTokenCard(mint, fetchImpl, controller.signal)
      .then((value) => {
        if (!active) return;
        setCard(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setError(cause instanceof MarketsError ? cause : new MarketsError("The crypto backend could not be read.", 0, "BAD_RESPONSE"));
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });
    const refresh = async () => {
      if (!active || document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        const value = await fetchTokenCard(mint, fetchImpl, controller.signal);
        if (!active) return;
        setCard(value);
        setError(null);
        setRefreshFailed(false);
      } catch (cause: unknown) {
        if (!active || controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setRefreshFailed(true);
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchImpl, mint, validMint]);

  useEffect(() => {
    if (!validMint || !cardLoaded) return;

    const controller = new AbortController();
    let active = true;
    let refreshing = false;
    const refreshPrice = async () => {
      if (!active || document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        const response = await fetchTokenPrice(mint, fetchImpl, controller.signal);
        if (!active) return;
        if (response.stale) {
          setPriceStale(true);
          return;
        }
        setPriceResponse(response);
        setPriceStale(false);
        const price = response.market?.price_usd;
        const time = Date.parse(response.fetched_at) / 1000;
        if (price !== null && price !== undefined && Number.isFinite(time)) {
          setPriceTicks((current) => [...current, { time, value: price }].slice(-200));
        }
      } catch (cause: unknown) {
        if (!active || controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setPriceStale(true);
      } finally {
        refreshing = false;
      }
    };

    void refreshPrice();
    const timer = window.setInterval(() => void refreshPrice(), 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshPrice();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cardLoaded, fetchImpl, mint, validMint]);

  const loadCandles = useCallback(
    (interval: CandleInterval, signal: AbortSignal, indicators: readonly string[]) =>
      fetchTokenCandles(
        mint,
        interval as SolanaCandleInterval,
        fetchImpl ?? fetch,
        signal,
        indicators,
      ),
    [fetchImpl, mint],
  );

  const tokenTitle = card?.name ?? card?.symbol ?? shortAddress(mint);
  const tokenIdentity =
    card?.name && card.symbol && card.symbol.toLowerCase() !== card.name.toLowerCase() ? (
      <>
        <bdi>{card.name}</bdi> · <bdi>{card.symbol}</bdi>
      </>
    ) : (
      <bdi>{tokenTitle}</bdi>
    );
  const market = card?.facts.market.status === "ok" ? card.facts.market.value : null;
  const currentPriceResponse = priceResponse?.mint === mint ? priceResponse : null;
  const livePrice = currentPriceResponse?.market?.price_usd;
  const displayPrice = livePrice ?? market?.price_usd ?? null;
  const displayPriceAt =
    livePrice !== null && livePrice !== undefined
      ? currentPriceResponse?.fetched_at
      : card?.checked_at;
  const copyMint = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(mint);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  };

  return (
    <>
      <PageHeader
        title={tokenIdentity}
        actions={
          loading ? (
            <StatusPill tone="orange">Checking</StatusPill>
          ) : error ? (
            <StatusPill tone="red">Unavailable</StatusPill>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-8">
          <p className="text-[12.5px] text-ink-3">Solana token · intelligence only · no trading, wallets or custody</p>
          <div className="mt-2 flex items-center gap-3">
            {card?.image_url && (
              <Image
                src={card.image_url}
                alt=""
                width={44}
                height={44}
                unoptimized
                className="size-11 rounded-full bg-surface object-cover"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">
                {tokenIdentity}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11.5px] text-ink-3"><bdi>{shortAddress(mint)}</bdi></span>
                {card && (
                  <button
                    type="button"
                    aria-label="Copy mint address"
                    onClick={() => void copyMint()}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover-2"
                  >
                    <Copy size={12} aria-hidden />
                    {copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Copy unavailable" : "Copy mint"}
                  </button>
                )}
              </div>
            </div>
          </div>
          {card && (
            <p className="mt-2 text-[12px] text-ink-2">
              {displayPrice !== null && displayPriceAt && (
                <>
                  Main pool price {formatUsd(displayPrice)} USD · {priceStale ? "price from" : "updated"}{" "}
                  <time dateTime={displayPriceAt}>{formatClock(displayPriceAt)}</time> ·{" "}
                </>
              )}
              Checked <time dateTime={card.checked_at}>{formatClock(card.checked_at)}</time>
            </p>
          )}
          {card && refreshFailed && (
            <div className="mt-2">
              <Notice kind="warn" role="status" title={`Couldn't refresh; showing facts from ${formatClock(card.checked_at)}.`} />
            </div>
          )}
          {error && (
            <div className="mt-5">
              <Notice kind="error" role="alert" title="Token facts are unavailable.">
                {error.message}
              </Notice>
            </div>
          )}
          {!card && loading && <p className="mt-5 rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Reading token facts from the Baystfirm backend…</p>}
          {card && (
            <>
              <Section id="token-candles" title="Candlestick history">
                <CandleChartPanel
                  title={<bdi>{tokenTitle} in USD</bdi>}
                  venue="geckoterminal"
                  symbol={card.symbol ?? card.name ?? mint}
                  loadCandles={loadCandles}
                  intervals={SOLANA_CANDLE_INTERVALS}
                  initialInterval="1h"
                  venueName="GeckoTerminal"
                  ticks={priceTicks}
                  emptyMessage="GeckoTerminal has no candles for this interval."
                  loadingMessage="Loading candles from GeckoTerminal…"
                  staleMessage={() => "GeckoTerminal could not be reached; showing its cached candle history."}
                  attribution={tokenAttribution}
                  showLastPrice={false}
                  ariaLabel={`Candlestick history for ${tokenTitle} in USD`}
                />
              </Section>
              <Section id="token-facts" title="Token facts">
                <TokenFactsList card={card} />
              </Section>
              <NewsSection
                title="Token events"
                feed="news"
                symbol={mint}
                kinds={["token_event"]}
                currentAsset={{ kind: "token", symbol: mint }}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
