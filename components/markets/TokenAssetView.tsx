"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Copy, ExternalLink } from "lucide-react";
import { StatusPill } from "@/components/atoms/StatusPill";
import PageHeader from "@/components/finance/PageHeader";
import { Notice, Section } from "@/components/finance/ui";
import CandleChartPanel from "@/components/markets/CandleChartPanel";
import TokenFactsList from "@/components/markets/TokenFactsList";
import { fetchTokenCard, fetchTokenCandles, MarketsError } from "@/lib/markets/client";
import { formatClock } from "@/lib/markets/labels";
import { formatUsd, shortAddress, SOLANA_MINT } from "@/lib/markets/tokens";
import {
  SOLANA_CANDLE_INTERVALS,
  type CandleInterval,
  type SolanaCandleInterval,
  type TokenCard,
  type TokenCandleResponse,
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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const validMint = SOLANA_MINT.test(mint);

  useEffect(() => {
    const controller = new AbortController();
    setCard(null);
    setError(null);
    setCopyState("idle");
    if (!validMint) {
      setError(new MarketsError("That address is not a Solana token mint.", 400, "INVALID_MINT"));
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    fetchTokenCard(mint, fetchImpl, controller.signal)
      .then((value) => {
        setCard(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setError(cause instanceof MarketsError ? cause : new MarketsError("The crypto backend could not be read.", 0, "BAD_RESPONSE"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fetchImpl, mint, validMint]);

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
    card?.name && card.symbol ? (
      <>
        <bdi>{card.name}</bdi> · <bdi>{card.symbol}</bdi>
      </>
    ) : (
      <bdi>{tokenTitle}</bdi>
    );
  const market = card?.facts.market.status === "ok" ? card.facts.market.value : null;
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
        actions={<StatusPill tone={loading ? "orange" : error ? "red" : "neutral"}>{loading ? "Checking" : error ? "Unavailable" : "Token facts"}</StatusPill>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-8">
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
              {market?.price_usd !== null && market?.price_usd !== undefined ? `Main pool price ${formatUsd(market.price_usd)} USD · ` : ""}
              Checked <time dateTime={card.checked_at}>{formatClock(card.checked_at)}</time>
            </p>
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
