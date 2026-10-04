"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { profileOptions } from "@/lib/search/profiles";
import { canSearchSolanaTokens, enterSearch, suggest, type CryptoBase, type SearchSuggestion, type SolanaSearchToken } from "@/lib/search/suggest";
import { instrumentRows } from "@/lib/markets/state";
import { fetchSolanaTokenSearch, MarketsError } from "@/lib/markets/client";
import type { SolanaSearchResponse } from "@/lib/markets/types";
import type { Profile } from "@/lib/api/types";
import { WEB_SEARCH_OFF_MESSAGE } from "@/lib/api/capabilities";
import { useSubmitAnalysis } from "@/lib/analysis/useSubmitAnalysis";
import CandidatePicker from "./CandidatePicker";
import { RequestErrorPanel } from "./ErrorPanels";
import { useWorkspace } from "./workspace";

const EMPTY_SOLANA_TOKENS: SolanaSearchToken[] = [];

function cryptoBasesFromMarket(symbols: readonly string[], instruments: ReturnType<typeof instrumentRows>): CryptoBase[] {
  const grouped = new Map<string, { symbols: Set<string>; venues: Set<string> }>();
  const addSymbol = (symbol: string, venue?: string) => {
    const base = symbol.split("-")[0]?.toUpperCase();
    if (!base) return;
    const group = grouped.get(base) ?? { symbols: new Set<string>(), venues: new Set<string>() };
    group.symbols.add(symbol);
    if (venue) group.venues.add(venue);
    grouped.set(base, group);
  };
  symbols.forEach((symbol) => addSymbol(symbol));
  instruments.forEach((row) => addSymbol(row.symbol, row.venue));
  return Array.from(grouped, ([base, group]) => ({
    base,
    symbols: [...group.symbols],
    venueCount: group.venues.size,
  })).sort((a, b) => a.base.localeCompare(b.base));
}

function suggestionRoute(suggestion: SearchSuggestion): string | null {
  if (suggestion.kind === "mint") return `/tokens/${encodeURIComponent(suggestion.mint)}`;
  if (suggestion.kind === "crypto") return `/crypto/${encodeURIComponent(suggestion.base)}`;
  if (suggestion.kind === "solana-token") return `/tokens/${encodeURIComponent(suggestion.token.mint)}`;
  return null;
}

export default function HeaderSearch() {
  const router = useRouter();
  const { history, capabilities, markets, searchQuery, setSearchQuery, searchInputRef } = useWorkspace();
  const capabilityView = capabilities.status === "ready" ? capabilities.capabilities : null;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [tokenSearch, setTokenSearch] = useState<SolanaSearchResponse | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const requestRef = useRef<{ query: string; promise: Promise<SolanaSearchResponse | null> } | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const onCreated = useCallback(
    (response: { analysis_id: string }) => {
      history.refreshHead();
      setOpen(false);
      setSearchQuery("");
      router.push(`/analyses/${encodeURIComponent(response.analysis_id)}`);
    },
    [history, router, setSearchQuery],
  );
  const submission = useSubmitAnalysis(onCreated);

  const rows = useMemo(() => instrumentRows(markets.state), [markets.state]);
  const cryptoBases = useMemo(
    () => cryptoBasesFromMarket(markets.snapshot?.symbols ?? [], rows),
    [markets.snapshot?.symbols, rows],
  );
  const tokenResults =
    tokenSearch?.query.trim().toLowerCase() === searchQuery.trim().toLowerCase() ? tokenSearch.tokens : EMPTY_SOLANA_TOKENS;
  const suggestions = useMemo(
    () => suggest(searchQuery, cryptoBases, tokenResults, capabilityView),
    [searchQuery, cryptoBases, tokenResults, capabilityView],
  );
  const availableProfiles = useMemo(() => (capabilityView ? profileOptions(capabilityView) : []), [capabilityView]);

  useEffect(() => {
    if (!capabilityView) return;
    if (profile === null || !capabilityView.profiles[profile].available) setProfile(capabilityView.defaultProfile);
  }, [capabilityView, profile]);

  const requestTokenSearch = useCallback((query: string) => {
    const current = requestRef.current;
    if (current?.query === query) return current.promise;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setTokenLoading(true);
    setTokenError(null);
    setTokenSearch(null);
    const promise = fetchSolanaTokenSearch(query, fetch, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setTokenSearch(response);
        return response;
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return null;
        setTokenError(cause instanceof MarketsError ? cause.message : "Solana token search is unavailable.");
        return null;
      })
      .finally(() => {
        if (!controller.signal.aborted) setTokenLoading(false);
      });
    requestRef.current = { query, promise };
    return promise;
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!canSearchSolanaTokens(query)) {
      requestController.current?.abort();
      requestController.current = null;
      requestRef.current = null;
      setTokenSearch(null);
      setTokenError(null);
      setTokenLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void requestTokenSearch(query), 250);
    return () => {
      window.clearTimeout(timer);
      if (requestRef.current?.query === query) requestController.current?.abort();
    };
  }, [requestTokenSearch, searchQuery]);

  useEffect(() => () => requestController.current?.abort(), []);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
    submission.dismiss();
  };

  const navigateTo = (route: string) => {
    close();
    setSearchQuery("");
    router.push(route);
  };

  const research = (query: string, selectedProfile = profile ?? capabilityView?.defaultProfile) => {
    if (!selectedProfile || !query.trim()) return;
    submission.submit({ query: query.trim(), profile: selectedProfile, horizon: "auto" });
  };

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    if (suggestion.kind === "research") {
      if (!suggestion.disabled) research(searchQuery);
      return;
    }
    const route = suggestionRoute(suggestion);
    if (route) navigateTo(route);
  };

  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        let next = current;
        for (let attempt = 0; attempt < suggestions.length; attempt += 1) {
          next = (next + direction + suggestions.length) % suggestions.length;
          const candidate = suggestions[next];
          if (candidate.kind !== "research" || !candidate.disabled) return next;
        }
        return -1;
      });
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    setOpen(true);
    const active = suggestions[activeIndex];
    if (active) {
      chooseSuggestion(active);
      return;
    }

    const query = searchQuery.trim();
    if (canSearchSolanaTokens(query)) {
      const response = await requestTokenSearch(query);
      if (response?.tokens.some((token) => token.symbol_match)) {
        setOpen(true);
        setActiveIndex(-1);
        return;
      }
      const result = enterSearch(query, cryptoBases, response?.tokens ?? []);
      if (result.kind === "crypto") {
        navigateTo(`/crypto/${encodeURIComponent(result.base)}`);
        return;
      }
      if (result.kind === "mint") {
        navigateTo(`/tokens/${encodeURIComponent(result.mint)}`);
        return;
      }
    } else {
      const result = enterSearch(query, cryptoBases, []);
      if (result.kind === "mint") {
        navigateTo(`/tokens/${encodeURIComponent(result.mint)}`);
        return;
      }
      if (result.kind === "crypto") {
        navigateTo(`/crypto/${encodeURIComponent(result.base)}`);
        return;
      }
    }
    research(query);
  };

  const activeSuggestion = suggestions[activeIndex];
  const ambiguity = canSearchSolanaTokens(searchQuery.trim()) && tokenResults.some((token) => token.symbol_match);
  const submitState = submission.state;
  const listOpen = open && searchQuery.trim().length > 0;

  return (
    <div className="relative min-w-0 max-w-[560px] flex-1">
      <div className="flex h-8 items-center gap-2 rounded-[8px] bg-field px-2.5 text-ink-3 shadow-hairline focus-within:text-ink-2">
        <Search size={15} aria-hidden className="shrink-0" />
        <input
          ref={searchInputRef}
          role="combobox"
          aria-label="Search a coin, Solana token address or company"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls="header-search-options"
          aria-activedescendant={listOpen && activeSuggestion ? `header-search-option-${activeSuggestion.id}` : undefined}
          value={searchQuery}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
            submission.dismiss();
          }}
          onKeyDown={(event) => void onKeyDown(event)}
          placeholder="Search a coin, Solana token address or company"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      {listOpen && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(70vh,520px)] overflow-y-auto rounded-[10px] bg-surface p-1.5 shadow-overlay"
          onMouseDown={(event) => event.preventDefault()}
        >
          <ul id="header-search-options" role="listbox" aria-label="Search suggestions" className="flex flex-col gap-0.5">
            {suggestions.map((suggestion, index) => {
              const disabled = suggestion.kind === "research" && suggestion.disabled;
              return (
                <li key={suggestion.id} role="presentation">
                  <button
                    id={`header-search-option-${suggestion.id}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseSuggestion(suggestion)}
                    className={`w-full rounded-[8px] px-2.5 py-2 text-left text-[12.5px] ${
                      activeIndex === index ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover-2"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {suggestion.kind === "solana-token" ? (
                      <span className="block truncate">
                        <bdi>{suggestion.token.symbol}</bdi> · <bdi>{suggestion.token.name}</bdi> ·{" "}
                        {`$${suggestion.token.total_liquidity_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} ·{" "}
                        {suggestion.token.pool_count} pools · Solana token
                      </span>
                    ) : (
                      <span className="block truncate">{suggestion.label}</span>
                    )}
                    {suggestion.kind === "research" && suggestion.disabledReason && (
                      <span className="mt-0.5 block text-[11px] text-ink-3">{suggestion.disabledReason}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {canSearchSolanaTokens(searchQuery.trim()) && (
            <p className="px-2.5 py-1.5 text-[11.5px] text-ink-3" role={tokenError ? "alert" : "status"}>
              {tokenLoading
                ? "Searching Solana tokens…"
                : tokenError
                  ? `Solana token search unavailable: ${tokenError}`
                  : tokenSearch
                    ? "DEX Screener search results · no endorsement"
                    : "Solana token search starts as you type"}
            </p>
          )}
          {ambiguity && (
            <p className="px-2.5 py-1.5 text-[12px] font-medium text-ink-2" role="status">
              This matches a Solana token and could also be a company — pick one
            </p>
          )}
          {availableProfiles.length > 0 && (
            <div role="group" aria-label="Analysis profile" className="flex items-center gap-1 border-t border-line px-2 py-1.5">
              {availableProfiles.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={profile === option.key}
                  title={option.disabledReason ?? option.description}
                  disabled={option.disabled || capabilityView?.webSearch === false || !capabilityView?.anyProfileAvailable}
                  onClick={() => setProfile(option.key as Profile)}
                  className="rounded-full px-2 py-1 text-[11.5px] font-medium text-ink-2 hover:bg-hover-2 aria-pressed:bg-inset aria-pressed:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {option.name}
                </button>
              ))}
              <span className="ml-auto text-[10.5px] text-ink-3">Web search only</span>
            </div>
          )}
          {capabilities.status === "error" && capabilities.error && (
            <div className="border-t border-line px-2 py-1.5">
              <RequestErrorPanel error={capabilities.error} onRetry={capabilities.reload} />
            </div>
          )}
          {capabilityView?.webSearch === false && (
            <p className="border-t border-line px-2.5 py-1.5 text-[11.5px] text-ink-3" role="status">
              {WEB_SEARCH_OFF_MESSAGE}
            </p>
          )}
          {submitState.status === "ambiguous" && (
            <div className="border-t border-line px-2 py-1.5">
              <CandidatePicker
                message={submitState.message}
                candidates={submitState.candidates}
                onChoose={submission.choose}
                onDismiss={submission.dismiss}
              />
            </div>
          )}
          {submitState.status === "error" && (
            <div className="border-t border-line px-2 py-1.5">
              <RequestErrorPanel error={submitState.error} onRetry={() => submission.submit(submitState.request)} />
            </div>
          )}
          {submitState.status === "submitting" && (
            <p className="border-t border-line px-2.5 py-1.5 text-[11.5px] text-ink-3" role="status">
              Researching “{submitState.request.query}”…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
