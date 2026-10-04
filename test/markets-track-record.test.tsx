/** @vitest-environment jsdom */
/**
 * The momentum track record: live and backtest scores per horizon, each judged
 * against "Neutral every time" only through the backend's own interval, and the
 * honest states before either has numbers.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TrackRecordPanel, { MIN_JUDGED_CALLS, verdict } from "@/components/markets/TrackRecordPanel";
import { horizonLabel, stateLabel } from "@/lib/markets/labels";
import type { SignalBacktest, TrackRecord, TrackRecordGroup } from "@/lib/markets/types";

afterEach(cleanup);

function group(horizon: number, fields: Partial<TrackRecordGroup> = {}): TrackRecordGroup {
  return {
    classifier: "momentum_regime",
    horizon_seconds: horizon,
    classifier_version: "rules-0.1.0",
    shadow: true,
    calibration_status: "uncalibrated",
    predictions: 1000,
    abstained: 0,
    scored: 909,
    unmatched: 0,
    pending: 42,
    hits: 456,
    hit_rate: 0.5016,
    hit_rate_ci95: [0.4692, 0.5341],
    baseline_hit_rate: 0.6568,
    label_recall: {},
    ...fields,
  };
}

const LIVE: TrackRecord = {
  computed_at: "2026-10-04T21:00:00Z",
  window_hours: 168,
  window_start: "2026-09-27T21:00:00Z",
  groups: [group(300), group(30, { classifier: "short_horizon_momentum" })],
  note: "Live note from the backend.",
};

describe("labels", () => {
  it("names the normal momentum state Neutral and formats horizons", () => {
    expect(stateLabel("range_bound").label).toBe("Neutral");
    expect([30, 60, 300, 3600, 14_400, 86_400].map(horizonLabel)).toEqual(["30s", "1m", "5m", "1h", "4h", "1D"]);
  });
});

describe("verdict", () => {
  it("judges only through the interval and only with enough graded calls", () => {
    expect(verdict(undefined).label).toBe("No graded calls yet");
    expect(verdict(group(60, { scored: MIN_JUDGED_CALLS - 1 })).label).toBe("Too few calls to judge");
    expect(verdict(group(60)).label).toBe("Worse than always Neutral");
    expect(verdict(group(60, { hit_rate_ci95: [0.7, 0.8] })).label).toBe("Better than always Neutral");
    expect(verdict(group(60, { hit_rate_ci95: [0.6, 0.7] })).label).toBe("No clear difference from always Neutral");
  });
});

describe("TrackRecordPanel", () => {
  it("shows live scores per horizon and says the backtest is still being computed", () => {
    const computing: SignalBacktest = {
      status: "computing",
      computed_at: null,
      span_start: null,
      span_end: null,
      sources: [],
      groups: [],
      note: "Backtest note from the backend.",
    };
    render(<TrackRecordPanel live={LIVE} liveError={null} backtest={computing} backtestError={null} />);
    const row = screen.getByText("5m").closest("tr") as HTMLElement;
    expect(within(row).getByText("Right 50.2% of 909")).toBeTruthy();
    expect(within(row).getByText(/Neutral every time: 65\.7%/)).toBeTruthy();
    expect(within(row).getByText("Worse than always Neutral")).toBeTruthy();
    expect(within(row).getByText("42 waiting for their horizon to pass")).toBeTruthy();
    const daily = screen.getByText("1D").closest("tr") as HTMLElement;
    expect(within(daily).getByText("No graded calls yet")).toBeTruthy();
    expect(screen.getByText(/Being computed by the backend/)).toBeTruthy();
    expect(screen.getByText("Live: Live note from the backend.")).toBeTruthy();
  });

  it("shows backtest scores, their span and sources when ready", () => {
    const ready: SignalBacktest = {
      status: "ready",
      computed_at: "2026-10-04T21:00:00Z",
      span_start: "2026-09-27T21:00:00Z",
      span_end: "2026-10-04T21:00:00Z",
      sources: [{ symbol: "BTC-USD", venue: "coinbase", bars: 10_080 }],
      groups: [group(3600, { scored: 400, hit_rate: 0.7, hit_rate_ci95: [0.65, 0.74], baseline_hit_rate: 0.6 })],
      note: "Backtest note from the backend.",
    };
    render(<TrackRecordPanel live={null} liveError={null} backtest={ready} backtestError={null} />);
    const row = screen.getByText("1h").closest("tr") as HTMLElement;
    expect(within(row).getByText("Right 70.0% of 400")).toBeTruthy();
    expect(within(row).getByText("Better than always Neutral")).toBeTruthy();
    expect(screen.getByText(/BTC-USD \(coinbase\)/)).toBeTruthy();
    expect(screen.getByText("Reading…")).toBeTruthy();
  });
});
