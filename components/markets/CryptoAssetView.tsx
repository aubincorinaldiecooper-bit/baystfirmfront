"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import PageHeader from "@/components/finance/PageHeader";
import { Badge, Notice, Section } from "@/components/finance/ui";
import { useMarketsContext } from "@/components/markets/MarketsProvider";
import { useWorkspace } from "@/components/finance/workspace";
import { watchlistAlertsEnabled } from "@/lib/markets/features";
import { formatQuote, horizonLabel, venueLabel } from "@/lib/markets/labels";
import { groupInstrumentsByBase, preferredInstrument } from "@/lib/markets/instruments";
import { stablecoinReferenceLines } from "@/lib/markets/stablecoins";
import { classificationsFor, instrumentKey, instrumentRows, type InstrumentRow } from "@/lib/markets/state";
import { useWatchlist } from "@/lib/markets/useWatchlist";
import type { DerivativeState } from "@/lib/markets/state";
import NewsSection from "./NewsSection";
import { MOMENTUM_HORIZONS } from "./TrackRecordPanel";
import TrackRecordPanel from "./TrackRecordPanel";
import InstrumentTable from "./InstrumentTable";
import LiveChart from "./LiveChart";
import { DerivativesPanel, LiquidationsPanel, type DerivativeRow } from "./MarketDataPanels";
import SignalBoard from "./SignalBoard";
import GatePanel from "./GatePanel";
import AlertsPanel from "./AlertsPanel";

type CryptoTab = "venues" | "derivatives" | "liquidations" | "signals" | "track-record" | "alerts" | "news";

const EMPTY_MARKET_NAMES: string[] = [];
const STABLECOIN_HIDDEN_TABS: readonly CryptoTab[] = ["derivatives", "liquidations", "track-record"];

const tabs: { id: CryptoTab; label: string }[] = [
  { id: "venues", label: "Venues" },
  { id: "derivatives", label: "Derivatives" },
  { id: "liquidations", label: "Liquidations" },
  { id: "signals", label: "Signals" },
  { id: "track-record", label: "Track record" },
  { id: "alerts", label: "Alerts" },
  { id: "news", label: "News" },
];

function baseOf(symbol: string): string {
  return symbol.split("-")[0]?.trim().toUpperCase() ?? "";
}

function tabFromParam(value: string | undefined): CryptoTab {
  return tabs.find((item) => item.id === value)?.id ?? "venues";
}

function assetDerivativeRows(
  base: string,
  rows: InstrumentRow[],
  snapshotSymbols: string[],
  venues: string[],
  derivatives: Record<string, DerivativeState>,
): DerivativeRow[] {
  const pairs = new Map<string, { venue: string; symbol: string }>();
  for (const row of rows) {
    if (row.kind === "perpetual") pairs.set(row.key, { venue: row.venue, symbol: row.symbol });
  }
  for (const [key, item] of Object.entries(derivatives)) {
    if (item.kind === "perpetual" && baseOf(item.symbol) === base) pairs.set(key, { venue: item.venue, symbol: item.symbol });
  }
  const symbols = snapshotSymbols.filter((symbol) => baseOf(symbol) === base && symbol.endsWith("-PERP"));
  for (const venue of venues.filter((item) => item === "bybit" || item === "okx")) {
    for (const symbol of symbols) pairs.set(instrumentKey(venue, symbol), { venue, symbol });
  }
  return Array.from(pairs.entries())
    .map(([key, pair]) => ({ key, ...pair, data: derivatives[key] ?? null }))
    .sort((a, b) => a.venue.localeCompare(b.venue) || a.symbol.localeCompare(b.symbol));
}

export default function CryptoAssetView({
  base: rawBase,
  instrumentParam,
  tabParam,
}: {
  base: string;
  instrumentParam?: string;
  tabParam?: string;
}) {
  const base = rawBase.trim().toUpperCase();
  const {
    state,
    snapshot,
    snapshotError,
    gate,
    gateError,
    trackRecord,
    trackRecordError,
    backtest,
    backtestError,
    stream,
    reload,
  } = useMarketsContext();
  const { focusSearch, setSearchQuery } = useWorkspace();
  const featuresEnabled = watchlistAlertsEnabled();
  const watchlist = useWatchlist();
  const [horizon, setHorizon] = useState<number>(3600);
  const [picked, setPicked] = useState<{ context: string; key: string } | null>(null);
  const [tab, setTab] = useState<CryptoTab>(() => tabFromParam(tabParam));
  const selectionContext = `${base}|${instrumentParam ?? ""}`;

  const rows = useMemo(
    () => instrumentRows(state).filter((row) => baseOf(row.symbol) === base),
    [base, state],
  );
  const groups = useMemo(() => groupInstrumentsByBase(rows), [rows]);
  const group = groups[0];
  const queryRow = instrumentParam ? state.instruments[instrumentParam] : undefined;
  const selected =
    (picked?.context === selectionContext && rows.some((row) => row.key === picked.key) ? picked.key : null) ??
    (queryRow && baseOf(queryRow.symbol) === base ? queryRow.key : null) ??
    preferredInstrument(rows)?.key ??
    rows[0]?.key ??
    null;
  const selectedRow = rows.find((row) => row.key === selected);
  const referenceLines = stablecoinReferenceLines(base, selectedRow?.last.quote_asset);
  const stablecoinPage = referenceLines !== undefined;
  const snapshotSymbols = snapshot?.symbols ?? EMPTY_MARKET_NAMES;
  const knownBase = rows.length > 0 || snapshotSymbols.some((symbol) => baseOf(symbol) === base);
  const venueNames = snapshot?.enabled_venues ?? EMPTY_MARKET_NAMES;
  const status = stream === "live"
    ? { label: "Live", tone: "green" as const }
    : stream === "closed"
      ? { label: "Stream closed", tone: "red" as const }
      : { label: stream === "connecting" ? "Connecting" : "Reconnecting", tone: "orange" as const };
  const derivativeRows = useMemo(
    () => assetDerivativeRows(base, rows, snapshotSymbols, venueNames, state.derivatives),
    [base, rows, snapshotSymbols, venueNames, state.derivatives],
  );
  const liquidations = useMemo(
    () => state.liquidations.filter((event) => baseOf(event.symbol) === base),
    [base, state.liquidations],
  );
  const pegs = useMemo(
    () => classificationsFor(state, "stablecoin_peg").filter((item) => baseOf(item.symbol) === base),
    [base, state],
  );
  const momentum = useMemo(
    () => classificationsFor(state, "short_horizon_momentum").filter((item) => baseOf(item.symbol) === base),
    [base, state],
  );
  const regime = useMemo(
    () => classificationsFor(state, "momentum_regime", horizon).filter((item) => baseOf(item.symbol) === base),
    [base, horizon, state],
  );
  const availableTabs = (featuresEnabled ? tabs : tabs.filter((item) => item.id !== "alerts")).filter(
    (item) => !stablecoinPage || !STABLECOIN_HIDDEN_TABS.includes(item.id),
  );
  const activeTab = availableTabs.some((item) => item.id === tab) ? tab : "venues";

  const searchThisBase = () => {
    setSearchQuery(base);
    focusSearch();
  };

  return (
    <>
      <PageHeader
        title={base || "Crypto"}
        actions={<StatusPill tone={status.tone} className="h-6 text-[12px]">{status.label}</StatusPill>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{base}</h1>
          <p className="mt-2 max-w-[760px] text-[14px] leading-[1.6] text-ink-2">
            Market states and probabilities only, not investment advice. No trading, wallets or custody.
          </p>
          <p className="mt-1 max-w-[760px] text-[12.5px] leading-[1.6] text-ink-3">
            Live public market data {venueNames.length ? `from ${venueNames.map(venueLabel).join(", ")} ` : ""}normalized by the Baystfirm backend.
          </p>

          {snapshotError && (
            <div className="mt-5">
              <Notice
                kind="error"
                role="alert"
                title="The crypto backend could not be read."
                actions={<Button variant="secondary" size="xs" onClick={reload}>Try again</Button>}
              >
                {snapshotError.message}
              </Notice>
            </div>
          )}

          {!state.snapshotLoaded && !knownBase ? (
            <p className="mt-6 rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">Reading the exchange snapshot…</p>
          ) : !knownBase ? (
            <div className="mt-6">
              <Notice
                kind="info"
                title={`${base} isn’t on our exchange feeds yet.`}
                actions={<Button variant="secondary" size="xs" onClick={searchThisBase}>Search for {base}</Button>}
              >
                Search the header to choose a covered asset, Solana token, or company to research.
              </Notice>
            </div>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-ink-2">
                  {selectedRow
                    ? `Last ${selectedRow.symbol} trade: ${formatQuote(selectedRow.last.price)} on ${venueLabel(selectedRow.venue)}`
                    : "No recent trade price is available."}
                </span>
                {featuresEnabled && selected && selectedRow && (
                  <button
                    type="button"
                    aria-pressed={watchlist.keys.includes(selected)}
                    aria-label={
                      watchlist.keys.includes(selected)
                        ? `Remove ${selectedRow.symbol} on ${venueLabel(selectedRow.venue)} from watchlist`
                        : `Add ${selectedRow.symbol} on ${venueLabel(selectedRow.venue)} to watchlist`
                    }
                    className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-hover-2"
                    onClick={() => watchlist.toggle(selected)}
                  >
                    {watchlist.keys.includes(selected) ? "★ Watched" : "☆ Watch"}
                  </button>
                )}
              </div>
              {rows.length > 0 && (
                <div role="group" aria-label="Crypto instruments" className="mt-3 flex flex-wrap gap-1.5">
                  {rows.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      aria-pressed={selected === row.key}
                      onClick={() => setPicked({ context: selectionContext, key: row.key })}
                      className={`rounded-md px-2.5 py-1.5 text-[11.5px] ${selected === row.key ? "bg-accent-tint text-ink" : "bg-surface text-ink-2 hover:bg-hover-2"}`}
                    >
                      {venueLabel(row.venue)} · {row.symbol}
                    </button>
                  ))}
                </div>
              )}
              <Section id="crypto-tape" title={selectedRow ? `${selectedRow.symbol} · ${venueLabel(selectedRow.venue)}` : "Live chart"}>
                <LiveChart
                  title={selectedRow ? `${selectedRow.symbol} on ${venueLabel(selectedRow.venue)}` : `${base} · no recent trade`}
                  venue={selectedRow?.venue ?? null}
                  symbol={selectedRow?.symbol ?? null}
                  ticks={selected ? state.ticks[selected] ?? [] : []}
                  referenceLines={referenceLines}
                  showIndicators={!stablecoinPage}
                />
              </Section>
              <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label={`${base} market data`}>
                {availableTabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`crypto-tab-${item.id}`}
                    aria-selected={activeTab === item.id}
                    aria-controls={`crypto-panel-${item.id}`}
                    onClick={() => setTab(item.id)}
                    className={`rounded-md px-3 py-1.5 text-[12px] ${activeTab === item.id ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-hover-2"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div
                role="tabpanel"
                id={`crypto-panel-${activeTab}`}
                aria-labelledby={`crypto-tab-${activeTab}`}
                className="mt-1"
              >
                {activeTab === "venues" && (
                  <>
                    <Section id="crypto-venues" title="Venues" count={rows.length}>
                      {rows.length > 0 ? (
                        <InstrumentTable
                          rows={rows}
                          quotes={state.quotes}
                          selected={selected}
                          watchlistEnabled={false}
                          watchlistKeys={watchlist.keys}
                          onToggleWatchlist={watchlist.toggle}
                          onSelect={(key) => setPicked({ context: selectionContext, key })}
                        />
                      ) : (
                        <p className="rounded-[10px] bg-surface px-4 py-3 text-[12.5px] text-ink-3 shadow-card">
                          {base} is on the configured feeds, but no recent trades have arrived yet.
                        </p>
                      )}
                      {group && (
                        <p className="mt-2 text-[11.5px] text-ink-3">
                          Preferred instrument: {group.preferred.symbol} on {venueLabel(group.preferred.venue)}.
                        </p>
                      )}
                    </Section>
                  </>
                )}
                {activeTab === "derivatives" && (
                  <Section id="crypto-derivatives" title="Derivatives" count={derivativeRows.length}>
                    <DerivativesPanel rows={derivativeRows} />
                  </Section>
                )}
                {activeTab === "liquidations" && (
                  <Section id="crypto-liquidations" title="Liquidations" count={Math.min(liquidations.length, 20)}>
                    <LiquidationsPanel events={liquidations} derivatives={state.derivatives} />
                  </Section>
                )}
                {activeTab === "signals" && (
                  <>
                    <div className="mt-8">
                      <Notice kind="warn" title="Shadow signals: not validated">
                        These classifications have not passed the evaluation gate. They are shown for review with their evidence and probability, not as trusted signals or advice.
                      </Notice>
                      {!stablecoinPage && (
                        <p className="mt-2 text-[12px] text-ink-3">Market states and probabilities only; not investment advice.</p>
                      )}
                    </div>
                    {(pegs.length > 0 || stablecoinPage) && (
                      <Section id="crypto-signals-peg" title="Stablecoin peg" count={pegs.length}>
                        <SignalBoard items={pegs} empty="No peg classification yet: it needs fresh trades from at least two venues." />
                      </Section>
                    )}
                    {!stablecoinPage && (
                      <>
                        <Section id="crypto-signals-regime" title="Momentum" count={regime.length}>
                          <div role="group" aria-label="Signal horizon" className="mb-2 flex flex-wrap gap-1">
                            {MOMENTUM_HORIZONS.map((seconds) => (
                              <button
                                key={seconds}
                                type="button"
                                aria-pressed={horizon === seconds}
                                className="rounded-md px-2.5 py-1 font-mono text-[12px] text-ink-2 hover:bg-hover-2 aria-pressed:bg-inset aria-pressed:text-ink"
                                onClick={() => setHorizon(seconds)}
                              >
                                {horizonLabel(seconds)}
                              </button>
                            ))}
                          </div>
                          <SignalBoard
                            items={regime}
                            empty={`No ${horizonLabel(horizon)} momentum call recorded since the backend last restarted.`}
                          />
                        </Section>
                        <Section id="crypto-signals-short" title="Short-horizon momentum" count={momentum.length}>
                          <SignalBoard items={momentum} empty="No momentum classification yet: it needs 30 trades over at least 10 seconds." />
                        </Section>
                      </>
                    )}
                  </>
                )}
                {activeTab === "track-record" && (
                  <>
                    <Section id="crypto-track-record" title="Track record · across all instruments">
                      <TrackRecordPanel live={trackRecord} liveError={trackRecordError} backtest={backtest} backtestError={backtestError} />
                    </Section>
                    <Section id="crypto-evaluation-gate" title="Evaluation gate">
                      {gateError ? (
                        <Notice kind="error" role="alert" title="The evaluation gate could not be read.">{gateError.message}</Notice>
                      ) : gate ? (
                        <GatePanel gate={gate} />
                      ) : (
                        <p className="text-[12.5px] text-ink-3">Reading the evaluation gate…</p>
                      )}
                    </Section>
                  </>
                )}
                {activeTab === "alerts" && featuresEnabled && (
                  <AlertsPanel state={state} rows={rows} />
                )}
                {activeTab === "news" && (
                  <>
                    <NewsSection
                      title={`${base} events`}
                      feed="news"
                      symbol={base}
                      kinds={["market_event"]}
                      currentAsset={{ kind: "crypto", symbol: base }}
                    />
                    <NewsSection title="Regulator releases" feed="news" kinds={["official"]} limit={10} />
                  </>
                )}
              </div>
            </>
          )}
          <div className="mt-6">
            <Badge tone="neutral">Intelligence only · no trading or custody</Badge>
          </div>
        </div>
      </div>
    </>
  );
}
