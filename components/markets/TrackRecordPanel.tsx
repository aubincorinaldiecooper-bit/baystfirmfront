"use client";

/* How often the momentum signal was right, per horizon: live calls graded as
 * their horizon passed, next to a replay of the same signal over recent
 * exchange candles. Each score sits beside "Neutral every time", the share of
 * outcomes that were Neutral anyway, so a signal that only looks right because
 * prices rarely move is visible. Every number is a backend field. */

import { Badge } from "@/components/finance/ui";
import type { Tone } from "@/lib/analysis/labels";
import { formatClock, horizonLabel, venueLabel } from "@/lib/markets/labels";
import type { MarketsError } from "@/lib/markets/client";
import type { SignalBacktest, TrackRecord, TrackRecordGroup } from "@/lib/markets/types";

export const MOMENTUM_HORIZONS = [60, 300, 900, 3600, 14_400, 86_400] as const;
/** Below this many graded calls a hit rate is shown but not judged. */
export const MIN_JUDGED_CALLS = 30;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function verdict(group: TrackRecordGroup | undefined): { label: string; tone: Tone } {
  if (!group || group.scored === 0 || group.hit_rate === null) return { label: "No graded calls yet", tone: "neutral" };
  if (group.scored < MIN_JUDGED_CALLS || !group.hit_rate_ci95 || group.baseline_hit_rate === null) {
    return { label: "Too few calls to judge", tone: "neutral" };
  }
  const [low, high] = group.hit_rate_ci95;
  if (high < group.baseline_hit_rate) return { label: "Worse than always Neutral", tone: "red" };
  if (low > group.baseline_hit_rate) return { label: "Better than always Neutral", tone: "green" };
  return { label: "No clear difference from always Neutral", tone: "orange" };
}

function ScoreCell({ group, waiting }: { group: TrackRecordGroup | undefined; waiting: boolean }) {
  const judged = verdict(group);
  return (
    <td className="px-2 py-2.5 align-top">
      {group && group.hit_rate !== null ? (
        <>
          <div className="font-mono tabular-nums text-ink">
            Right {pct(group.hit_rate)} of {group.scored}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-3">
            {group.hit_rate_ci95 && `95% range ${pct(group.hit_rate_ci95[0])}–${pct(group.hit_rate_ci95[1])} · `}
            {group.baseline_hit_rate !== null && `Neutral every time: ${pct(group.baseline_hit_rate)}`}
          </div>
        </>
      ) : (
        <div className="text-ink-3">—</div>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge tone={judged.tone} dot>
          {judged.label}
        </Badge>
      </div>
      {waiting && group && group.pending > 0 && (
        <div className="mt-1 text-[11.5px] text-ink-3">{group.pending} waiting for their horizon to pass</div>
      )}
    </td>
  );
}

const byHorizon = (groups: TrackRecordGroup[] | undefined) =>
  new Map((groups ?? []).filter((group) => group.classifier === "momentum_regime").map((group) => [group.horizon_seconds, group]));

export default function TrackRecordPanel({
  live,
  liveError,
  backtest,
  backtestError,
}: {
  live: TrackRecord | null;
  liveError: MarketsError | null;
  backtest: SignalBacktest | null;
  backtestError: MarketsError | null;
}) {
  const liveGroups = byHorizon(live?.groups);
  const backtestGroups = byHorizon(backtest?.groups);
  const backtestReady = backtest?.status === "ready";
  const liveStatus = liveError ? `Could not be read: ${liveError.message}` : live ? null : "Reading…";
  const backtestStatus = backtestError
    ? `Could not be read: ${backtestError.message}`
    : !backtest
      ? "Reading…"
      : backtestReady
        ? null
        : "Being computed by the backend; reload in a few minutes.";

  return (
    <div className="space-y-2">
      <p className="max-w-[720px] text-[12.5px] leading-[1.6] text-ink-2">
        A call is right when the move over its horizon matches it: Upward, Downward, or Neutral when the price barely
        moved. &ldquo;Neutral every time&rdquo; is how often a signal that never called a move would have been right.
      </p>
      <div className="overflow-x-auto rounded-[10px] bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead className="text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Horizon</th>
              <th className="px-2 py-2 font-medium">Live{live ? `, last ${Math.round(live.window_hours / 24)} days` : ""}</th>
              <th className="px-2 py-2 font-medium">Backtest</th>
            </tr>
          </thead>
          <tbody>
            {(liveStatus || backtestStatus) && (
              <tr className="border-b border-line">
                <td className="px-4 py-2.5 text-ink-3" />
                <td className="px-2 py-2.5 text-ink-3">{liveStatus}</td>
                <td className="px-2 py-2.5 text-ink-3">{backtestStatus}</td>
              </tr>
            )}
            {MOMENTUM_HORIZONS.map((seconds) => (
              <tr key={seconds} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 align-top font-mono text-ink">{horizonLabel(seconds)}</td>
                {live ? <ScoreCell group={liveGroups.get(seconds)} waiting /> : <td />}
                {backtestReady ? <ScoreCell group={backtestGroups.get(seconds)} waiting={false} /> : <td />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {backtestReady && backtest.span_start && backtest.span_end && (
        <p className="text-[12px] text-ink-3">
          Backtest replayed {backtest.span_start.slice(0, 10)} {formatClock(backtest.span_start)} to {backtest.span_end.slice(0, 10)}{" "}
          {formatClock(backtest.span_end)} on 1-minute candles:{" "}
          {backtest.sources.map((source) => `${source.symbol} (${venueLabel(source.venue)})`).join(", ")}.
        </p>
      )}
      {live?.note && <p className="text-[12px] text-ink-3">Live: {live.note}</p>}
      {backtest?.note && <p className="text-[12px] text-ink-3">Backtest: {backtest.note}</p>}
    </div>
  );
}
