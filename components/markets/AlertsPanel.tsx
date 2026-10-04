"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Section } from "@/components/finance/ui";
import { formatClock, formatQuote, venueLabel } from "@/lib/markets/labels";
import {
  alertCondition,
  thresholdValueFromInput,
  type AlertMetric,
  type AlertRule,
} from "@/lib/markets/alerts";
import type { InstrumentRow, MarketsState } from "@/lib/markets/state";
import { useAlerts } from "@/lib/markets/useAlerts";

type FormKind = AlertMetric | "peg" | "liquidation";

const METRIC_NAMES: Record<AlertMetric, string> = {
  last_price: "Price",
  spread_bps: "Spread",
  funding_rate: "Funding rate",
};

function stablecoinForSymbol(symbol: string): string | null {
  return symbol.split("-").find((asset) => asset === "USDC" || asset === "USDT") ?? null;
}

function ruleTitle(rule: AlertRule): string {
  if (rule.kind === "peg") return `${rule.symbol} stablecoin peg`;
  if (rule.kind === "liquidation") {
    return `${venueLabel(rule.venue)} ${rule.symbol} liquidation ≥ $${rule.min_notional_usd.toLocaleString("en-US")}`;
  }
  const threshold =
    rule.metric === "funding_rate"
      ? `${(rule.value * 100).toFixed(4)}%`
      : rule.metric === "spread_bps"
        ? `${rule.value} bps`
        : formatQuote(rule.value);
  return `${venueLabel(rule.venue)} ${rule.symbol} ${METRIC_NAMES[rule.metric].toLowerCase()} ${rule.op} ${threshold}`;
}

function observedValue(firing: { rule_id: string; observed: number | string }, rules: AlertRule[]): string {
  if (typeof firing.observed !== "number") return firing.observed;
  const rule = rules.find((item) => item.id === firing.rule_id);
  if (rule?.kind === "threshold") {
    if (rule.metric === "funding_rate") return `${(firing.observed * 100).toFixed(4)}%`;
    if (rule.metric === "spread_bps") return `${firing.observed.toFixed(2)} bps`;
    return formatQuote(firing.observed);
  }
  return firing.observed.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function newRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AlertsPanel({
  state,
  rows,
}: {
  state: MarketsState;
  rows: InstrumentRow[];
}) {
  const { rules, firings, notificationPermission, addRule, removeRule, requestNotifications } = useAlerts(state);
  const [kind, setKind] = useState<FormKind>("last_price");
  const [selectedKey, setSelectedKey] = useState("");
  const [op, setOp] = useState<"above" | "below">("above");
  const [value, setValue] = useState("");
  const dataReady = state.snapshotLoaded || state.events > 0 || Object.keys(state.classifications).length > 0;

  const availableRows = useMemo(() => {
    if (kind === "funding_rate" || kind === "liquidation") return rows.filter((row) => row.kind === "perpetual");
    if (kind === "peg") return rows.filter((row) => stablecoinForSymbol(row.symbol) !== null);
    return rows;
  }, [kind, rows]);
  const instrument = availableRows.find((row) => row.key === selectedKey) ?? availableRows[0];

  useEffect(() => {
    if (!availableRows.some((row) => row.key === selectedKey)) setSelectedKey(availableRows[0]?.key ?? "");
  }, [availableRows, selectedKey]);

  function addFromForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instrument) return;
    const created_at = new Date().toISOString();
    const id = newRuleId();

    if (kind === "peg") {
      const symbol = stablecoinForSymbol(instrument.symbol);
      if (!symbol) return;
      addRule({ id, kind: "peg", symbol, created_at });
    } else if (kind === "liquidation") {
      const minNotional = Number(value);
      if (!Number.isFinite(minNotional) || minNotional < 0) return;
      addRule({
        id,
        kind: "liquidation",
        venue: instrument.venue,
        symbol: instrument.symbol,
        min_notional_usd: minNotional,
        created_at,
      });
    } else {
      const entered = Number(value);
      if (!Number.isFinite(entered)) return;
      addRule({
        id,
        kind: "threshold",
        metric: kind,
        venue: instrument.venue,
        symbol: instrument.symbol,
        op,
        value: thresholdValueFromInput(kind, entered),
        created_at,
      });
    }
    setValue("");
  }

  return (
    <Section id="alerts" title="Alerts" count={rules.length}>
      <div className="rounded-[10px] bg-surface p-4 shadow-card">
        <form onSubmit={addFromForm} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[190px] flex-1 flex-col gap-1 text-[11.5px] font-medium text-ink-2">
            Instrument
            <select
              aria-label="Instrument"
              value={instrument?.key ?? ""}
              onChange={(event) => setSelectedKey(event.target.value)}
              disabled={availableRows.length === 0}
              className="h-9 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
            >
              {availableRows.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.symbol} · {venueLabel(row.venue)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[150px] flex-col gap-1 text-[11.5px] font-medium text-ink-2">
            Alert type
            <select
              aria-label="Alert type"
              value={kind}
              onChange={(event) => setKind(event.target.value as FormKind)}
              className="h-9 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
            >
              <option value="last_price">Price</option>
              <option value="spread_bps">Spread</option>
              <option value="funding_rate" disabled={!rows.some((row) => row.kind === "perpetual")}>
                Funding rate (perpetuals)
              </option>
              <option value="peg" disabled={!rows.some((row) => stablecoinForSymbol(row.symbol) !== null)}>
                Stablecoin peg
              </option>
              <option value="liquidation" disabled={!rows.some((row) => row.kind === "perpetual")}>
                Liquidation size
              </option>
            </select>
          </label>
          {kind !== "peg" && (
            <>
              {kind !== "liquidation" && (
                <label className="flex min-w-[100px] flex-col gap-1 text-[11.5px] font-medium text-ink-2">
                  Direction
                  <select
                    aria-label="Direction"
                    value={op}
                    onChange={(event) => setOp(event.target.value as "above" | "below")}
                    className="h-9 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
                  >
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                </label>
              )}
              <label className="flex min-w-[140px] flex-col gap-1 text-[11.5px] font-medium text-ink-2">
                {kind === "liquidation"
                  ? "Minimum notional (USD)"
                  : kind === "funding_rate"
                    ? "Threshold (%)"
                    : kind === "spread_bps"
                      ? "Threshold (bps)"
                      : "Threshold"}
                <input
                  aria-label={kind === "liquidation" ? "Minimum notional (USD)" : "Threshold"}
                  type="number"
                  step="any"
                  required
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className="h-9 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
                />
              </label>
            </>
          )}
          <button
            type="submit"
            disabled={!instrument || (kind !== "peg" && value.trim() === "")}
            className="h-9 rounded-md bg-ink px-3 text-[12px] font-medium text-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add alert
          </button>
        </form>

        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-[12px] font-medium text-ink">Rules</h3>
          {rules.length === 0 ? (
            <p className="mt-2 text-[12px] text-ink-3">No alert rules yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {rules.map((rule) => {
                const condition = alertCondition(rule, state, dataReady);
                const status =
                  condition === null
                    ? "Waiting for data"
                    : condition
                      ? "Condition already true — fires on the next crossing"
                      : "Watching";
                return (
                  <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-ink">{ruleTitle(rule)}</p>
                      <p className="mt-0.5 text-[11.5px] text-ink-3">{status}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${ruleTitle(rule)}`}
                      className="rounded-md px-2 py-1 text-[11.5px] text-ink-3 hover:bg-hover-2 hover:text-ink"
                      onClick={() => removeRule(rule.id)}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={requestNotifications}
            className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-2 hover:bg-hover-2"
          >
            Also notify me in this browser
          </button>
          {notificationPermission === "unsupported" ? (
            <p className="text-[11.5px] text-ink-3">Browser notifications are unsupported; in-page alerts still work.</p>
          ) : notificationPermission === "denied" ? (
            <p className="text-[11.5px] text-ink-3">Browser notifications were denied; in-page alerts still work.</p>
          ) : notificationPermission === "granted" ? (
            <p className="text-[11.5px] text-ink-3">Browser notifications enabled.</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-[10px] bg-surface p-4 shadow-card">
        <h3 className="text-[12px] font-medium text-ink">Triggered alerts</h3>
        <div aria-live="polite" aria-relevant="additions text">
          {firings.length === 0 ? (
            <p className="mt-2 text-[12px] text-ink-3">No alerts have fired yet.</p>
          ) : (
            <ol className="mt-2 divide-y divide-line">
              {firings.map((firing, index) => (
                <li key={`${firing.rule_id}:${firing.source_id}:${index}`} className="py-2">
                  <p className="text-[11.5px] text-ink-3">{formatClock(firing.at) || "—"}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink">{firing.message}</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">
                    Observed {observedValue(firing, rules)} · Source {firing.source_id}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-ink-3">
          Saved in this browser only. Alerts fire while this page is open.
        </p>
      </div>
    </Section>
  );
}
