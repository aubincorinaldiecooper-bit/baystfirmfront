/**
 * Plain-language readings of Solana token-card facts. Each reading restates a
 * backend field; a fact the backend couldn't check says so instead of guessing.
 * There is no overall safety verdict here, by design.
 */

import type { Tone } from "@/lib/analysis/labels";
import type { TokenCard, TokenFact } from "./types";

/** A Solana mint address: base58, 32–44 characters. */
export const SOLANA_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const SOURCE_NAMES: Record<string, string> = {
  solana_rpc: "Solana network",
  dexscreener: "DEX Screener",
  geckoterminal: "GeckoTerminal",
  raydium: "Raydium",
  rugcheck: "RugCheck",
};

export const sourceLabel = (source: string) => SOURCE_NAMES[source] ?? source;

const EXTENSION_NAMES: Record<string, string> = {
  transferFeeConfig: "Transfer fee",
  permanentDelegate: "Someone else can move holders' coins",
  transferHook: "Custom code runs on every transfer",
  mintCloseAuthority: "Mint can be closed",
  defaultAccountState: "New holder accounts can start frozen",
  nonTransferable: "Can't be transferred",
  confidentialTransferMint: "Confidential transfers",
};

export const extensionLabel = (name: string) => EXTENSION_NAMES[name] ?? name;

export const shortAddress = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

export interface Glance {
  key: string;
  label: string;
  tone: Tone;
}

type Facts = TokenCard["facts"];
export type FactKey = keyof Facts;

export const FACT_TITLES: Record<FactKey, string> = {
  mint_authority: "Mint more coins",
  freeze_authority: "Freeze holders",
  token_extensions: "Hidden extras",
  metadata_mutable: "Name and picture",
  top10_share: "Top 10 wallets",
  liquidity_lock: "Liquidity lock",
  market: "Market",
};

const SHORT_TITLES: Record<FactKey, string> = {
  mint_authority: "Mint",
  freeze_authority: "Freeze",
  token_extensions: "Extras",
  metadata_mutable: "Details",
  top10_share: "Top 10",
  liquidity_lock: "Liquidity lock",
  market: "Market",
};

const unchecked = (key: FactKey): Glance => ({ key, label: `${SHORT_TITLES[key]}: couldn't check`, tone: "neutral" });

const pct = (value: number) => `${value.toFixed(1)}%`;

function authorityGlance(key: "mint_authority" | "freeze_authority", fact: TokenFact<string>): Glance {
  if (fact.status !== "ok") return unchecked(key);
  if (key === "mint_authority") {
    return fact.value === null ? { key, label: "Can't mint more", tone: "green" } : { key, label: "Creator can mint more", tone: "orange" };
  }
  return fact.value === null ? { key, label: "Can't freeze holders", tone: "green" } : { key, label: "Creator can freeze holders", tone: "orange" };
}

function extensionsGlance(fact: Facts["token_extensions"]): Glance | null {
  const key = "token_extensions";
  if (fact.status !== "ok" || !fact.value) return unchecked(key);
  const { risky, transfer_fee_bps: feeBps } = fact.value;
  if (risky.length === 0) return null;
  const fee = feeBps !== null && feeBps > 0 ? `Transfer fee ${(feeBps / 100).toFixed(2)}%` : null;
  const others = risky.filter((name) => !(fee && name === "transferFeeConfig"));
  const label = [fee, others.length > 0 ? `${others.length} other extra${others.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" + ");
  return { key, label: label || "Hidden extras", tone: "orange" };
}

function metadataGlance(fact: Facts["metadata_mutable"]): Glance {
  const key = "metadata_mutable";
  if (fact.status !== "ok" || fact.value === null) return unchecked(key);
  return fact.value ? { key, label: "Name/picture changeable", tone: "orange" } : { key, label: "Name/picture locked", tone: "green" };
}

function topGlance(fact: Facts["top10_share"]): Glance | null {
  const key = "top10_share";
  if (fact.status !== "ok" || !fact.value) return null;
  return { key, label: `Top 10 hold ${pct(fact.value.pct)}`, tone: fact.value.pct > 50 ? "orange" : "neutral" };
}

function lockGlance(fact: Facts["liquidity_lock"]): Glance {
  const key = "liquidity_lock";
  if (fact.status === "not_applicable") {
    const type = fact.value?.pool_type;
    return { key, label: type === "launch_curve" ? "On launch curve" : type === "position_based" ? "Position pool, no LP token" : "Lock doesn't apply", tone: "neutral" };
  }
  if (fact.status !== "ok" || !fact.value || fact.value.burned_pct === null) return unchecked(key);
  return { key, label: `LP burned ${pct(fact.value.burned_pct)}`, tone: fact.value.burned_pct >= 95 ? "green" : "orange" };
}

/** The badges shown on a token's row, in reading order. */
export function glance(card: TokenCard): Glance[] {
  const { facts } = card;
  return [
    authorityGlance("mint_authority", facts.mint_authority),
    authorityGlance("freeze_authority", facts.freeze_authority),
    lockGlance(facts.liquidity_lock),
    topGlance(facts.top10_share),
    extensionsGlance(facts.token_extensions),
    metadataGlance(facts.metadata_mutable),
  ].filter((item): item is Glance => item !== null);
}

const usd = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const digits = value < 0.01 ? 8 : value < 1 ? 5 : 2;
  return value >= 1000
    ? `$${value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}`
    : `$${value.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
};

export const formatUsd = usd;

/** One line per fact in the details modal: what the source said, in words. */
export function factSummary(key: FactKey, card: TokenCard): string {
  const fact = card.facts[key];
  if (fact.status === "unavailable") return fact.detail ?? "Couldn't check right now";
  if (fact.status === "not_applicable") return fact.detail ?? "Doesn't apply to this token";
  switch (key) {
    case "mint_authority": {
      const value = card.facts.mint_authority.value;
      return value === null ? "Creator can't mint more coins (the power was given up)" : `Creator can still mint more coins · authority ${shortAddress(value)}`;
    }
    case "freeze_authority": {
      const value = card.facts.freeze_authority.value;
      return value === null ? "No one can freeze holders' coins (the power was given up)" : `Creator can freeze holders' coins · authority ${shortAddress(value)}`;
    }
    case "token_extensions": {
      const value = card.facts.token_extensions.value;
      if (!value || value.risky.length === 0) return "None of the risky extras";
      return value.risky
        .map((name) =>
          name === "transferFeeConfig" && value.transfer_fee_bps !== null ? `Transfer fee ${(value.transfer_fee_bps / 100).toFixed(2)}%` : extensionLabel(name),
        )
        .join(" · ");
    }
    case "metadata_mutable":
      return card.facts.metadata_mutable.value ? "Its owner can still change the name and picture" : "Name and picture can't be changed";
    case "top10_share": {
      const value = card.facts.top10_share.value;
      if (!value) return "—";
      if (value.pool_accounts_excluded) return `${pct(value.pct)} of supply, not counting pool accounts`;
      if (card.facts.top10_share.source === "geckoterminal") {
        return `${pct(value.pct)} of supply per GeckoTerminal; may include pool and exchange accounts.`;
      }
      return `${pct(value.pct)} of supply; pool accounts may be included`;
    }
    case "liquidity_lock": {
      const value = card.facts.liquidity_lock.value;
      return value && value.burned_pct !== null ? `${pct(value.burned_pct)} of the pool's tokens are burned (${value.dex})` : "—";
    }
    case "market": {
      const value = card.facts.market.value;
      if (!value) return "—";
      return `Liquidity ${usd(value.liquidity_usd)} · 24h volume ${usd(value.volume_24h_usd)} · price ${usd(value.price_usd)} · ${value.pool_count} pool${value.pool_count === 1 ? "" : "s"}`;
    }
  }
}

/** Milliseconds since the epoch from an ISO string or epoch milliseconds. */
export function timeOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** "45s", "12m", "5h", "3d": how long ago `then` was, relative to `now`. */
export function formatAge(then: string | number | null | undefined, now: number): string {
  const ms = timeOf(then);
  if (ms === null) return "—";
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
