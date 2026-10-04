import { SOLANA_MINT } from "@/lib/markets/tokens";
import type { CapabilitiesView } from "@/lib/api/capabilities";

export interface CryptoBase {
  base: string;
  symbols: string[];
  venueCount: number;
}

export interface SolanaSearchToken {
  mint: string;
  symbol: string;
  name: string;
  pool_count: number;
  total_liquidity_usd: number;
  symbol_match: boolean;
}

export type SearchSuggestion =
  | { kind: "mint"; id: string; label: string; detail: string; mint: string }
  | { kind: "crypto"; id: string; label: string; detail: string; base: string }
  | { kind: "solana-token"; id: string; label: string; token: SolanaSearchToken }
  | { kind: "research"; id: string; label: string; disabled: boolean; disabledReason: string | null };

export const TOKEN_SEARCH_QUERY = /^\S{2,12}$/;

export function shortMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

export function canSearchSolanaTokens(query: string): boolean {
  return TOKEN_SEARCH_QUERY.test(query.trim());
}

function cryptoSuggestion(base: CryptoBase, query: string): SearchSuggestion {
  return {
    kind: "crypto",
    id: `crypto:${base.base}`,
    label: `${base.base} · crypto · live on ${base.venueCount} ${base.venueCount === 1 ? "venue" : "venues"}`,
    detail: base.symbols.find((symbol) => symbol.toUpperCase() === query.toUpperCase()) ?? base.base,
    base: base.base,
  };
}

export function suggest(
  query: string,
  cryptoBases: readonly CryptoBase[],
  tokenResults: readonly SolanaSearchToken[],
  capabilities: CapabilitiesView | null,
): SearchSuggestion[] {
  const normalized = query.trim();
  if (!normalized) return [];
  if (SOLANA_MINT.test(normalized)) {
    return [
      {
        kind: "mint",
        id: `token:${normalized}`,
        label: `Open Solana token ${shortMint(normalized)}`,
        detail: "Solana token address",
        mint: normalized,
      },
    ];
  }

  const upper = normalized.toUpperCase();
  const exact = cryptoBases.filter(
    (item) => item.base.toUpperCase() === upper || item.symbols.some((symbol) => symbol.toUpperCase() === upper),
  );
  const exactSet = new Set(exact.map((item) => item.base));
  const prefix =
    normalized.length >= 2
      ? cryptoBases.filter(
          (item) =>
            !exactSet.has(item.base) &&
            (item.base.toUpperCase().startsWith(upper) || item.symbols.some((symbol) => symbol.toUpperCase().startsWith(upper))),
        )
      : [];
  const tokenSuggestions = canSearchSolanaTokens(normalized)
    ? tokenResults.slice(0, 5).map((token): SearchSuggestion => ({
        kind: "solana-token",
        id: `token:${token.mint}`,
        label: `${token.symbol} · ${token.name} · $${token.total_liquidity_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${token.pool_count} pools · Solana token`,
        token,
      }))
    : [];
  const researchDisabledReason =
    capabilities?.webSearch === false
      ? "Web search isn't configured on the server, so analyses can't run."
      : !capabilities?.anyProfileAvailable
        ? "No analysis profile is available on this backend right now."
        : null;
  return [
    ...exact.sort((a, b) => a.base.localeCompare(b.base)).map((base) => cryptoSuggestion(base, normalized)),
    ...tokenSuggestions,
    ...prefix.sort((a, b) => a.base.localeCompare(b.base)).map((base) => cryptoSuggestion(base, normalized)),
    {
      kind: "research",
      id: "research",
      label: `Research “${normalized}” as a listed company`,
      disabled: researchDisabledReason !== null || capabilities === null,
      disabledReason: researchDisabledReason ?? (capabilities ? null : "Checking research availability…"),
    },
  ];
}

export type SearchEnterResult =
  | { kind: "mint"; mint: string }
  | { kind: "crypto"; base: string }
  | { kind: "ambiguous" }
  | { kind: "research" };

export function enterSearch(
  query: string,
  cryptoBases: readonly CryptoBase[],
  tokenResults: readonly SolanaSearchToken[],
): SearchEnterResult {
  const normalized = query.trim();
  if (SOLANA_MINT.test(normalized)) return { kind: "mint", mint: normalized };
  if (canSearchSolanaTokens(normalized) && tokenResults.some((token) => token.symbol_match)) return { kind: "ambiguous" };
  const upper = normalized.toUpperCase();
  const exact = cryptoBases.find(
    (item) => item.base.toUpperCase() === upper || item.symbols.some((symbol) => symbol.toUpperCase() === upper),
  );
  return exact ? { kind: "crypto", base: exact.base } : { kind: "research" };
}
