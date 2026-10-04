/**
 * TypeScript mirrors of the Baystfirm crypto backend's schemas
 * (src/baystfirm/models.py, service.py). The Markets page reads only these.
 */

export interface MarketEvent {
  event_id: string;
  venue: string;
  /** Canonical instrument, e.g. "BTC-USD", "USDC-USDT", "BTC-USDT-PERP". */
  symbol: string;
  native_symbol: string;
  base_asset: string;
  quote_asset: string;
  instrument_kind: string;
  event_type: "trade" | "quote" | "book" | "funding" | "open_interest" | "liquidation" | "chain";
  exchange_timestamp: string;
  received_timestamp: string;
  sequence: number | string | null;
  price: number | null;
  size: number | null;
  side: string;
  bid?: number | null;
  ask?: number | null;
  funding_rate?: number | null;
  next_funding_at?: string | null;
  open_interest?: number | null;
  open_interest_value?: number | null;
  mark_price?: number | null;
  index_price?: number | null;
  bid_size?: number | null;
  ask_size?: number | null;
  bid_depth_10bps?: number | null;
  ask_depth_10bps?: number | null;
  bid_depth_50bps?: number | null;
  ask_depth_50bps?: number | null;
  depth_levels?: number | null;
  payload_hash: string;
  metadata: Record<string, unknown>;
}

export const CANDLE_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
  "1w",
] as const;

export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export interface CandleBar {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleResponse {
  venue: string;
  symbol: string;
  interval: CandleInterval;
  source_url_template: string;
  fetched_at: string;
  aggregated_from: CandleInterval | null;
  candles: CandleBar[];
  stale: boolean;
  error?: string;
  truncated: boolean;
  /** Backend-computed indicator outputs keyed by canonical spec, aligned 1:1 with `candles`; `null` during warm-up. */
  indicators?: Record<string, Record<string, (number | null)[]>>;
}

export const SOLANA_CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type SolanaCandleInterval = (typeof SOLANA_CANDLE_INTERVALS)[number];

export interface TokenCandleResponse extends CandleResponse {
  venue: "geckoterminal";
  mint: string;
  pool_address: string;
  dex_id: string;
  price_currency: "usd";
}

export interface SolanaSearchResponse {
  query: string;
  tokens: {
    mint: string;
    symbol: string;
    name: string;
    image: string | null;
    pool_count: number;
    total_liquidity_usd: number;
    volume_24h_usd: number;
    main_pool_address: string;
    price_usd: number | null;
    symbol_match: boolean;
  }[];
  source: "dexscreener";
  fetched_at: string;
  note: string;
}

export interface Evidence {
  metric: string;
  value: number | string;
  threshold: number | string | null;
  source_event_ids: string[];
}

export interface Classification {
  classification_id: string;
  classifier: string;
  classifier_version: string;
  symbol: string;
  label: string;
  probability: number;
  abstained: boolean;
  horizon_seconds: number;
  observed_at: string;
  generated_at: string;
  evidence: Evidence[];
  shadow: boolean;
  calibration_status: string;
  freshness_ms: number;
}

export interface MarketsSnapshot {
  generated_at: string;
  shadow_mode: boolean;
  enabled_venues: string[];
  symbols: string[];
  latest_events: MarketEvent[];
  latest_classifications: Classification[];
}

export interface GateMetrics {
  sample_count: number;
  coverage: number;
  accuracy: number;
  false_alert_rate: number;
  brier_score: number;
  expected_calibration_error: number;
  p95_latency_ms: number;
  macro_recall?: number | null;
  label_recall?: Record<string, number>;
}

export interface EvaluationRun {
  run_id: string;
  classifier: string;
  created_at: string;
  metrics: GateMetrics;
  promotion_eligible: boolean;
  failures: string[];
  dataset?: Record<string, unknown>;
}

export interface EvaluationGate {
  status: string;
  promotion: string;
  runs: EvaluationRun[];
  thresholds: Partial<Record<string, number | null>>;
}

/** One (classifier, horizon) row of `/v1/track-record` and `/v1/track-record/backtest`. */
export interface TrackRecordGroup {
  classifier: string;
  horizon_seconds: number;
  classifier_version: string | null;
  shadow: boolean;
  calibration_status: string | null;
  predictions: number;
  abstained: number;
  scored: number;
  unmatched: number;
  /** Calls whose horizon has not passed yet. */
  pending: number;
  hits: number;
  hit_rate: number | null;
  hit_rate_ci95: [number, number] | null;
  /** How often the outcome was the classifier's normal state ("Neutral" for momentum). */
  baseline_hit_rate: number | null;
  label_recall: Record<string, number>;
}

export interface TrackRecord {
  computed_at: string;
  window_hours: number;
  window_start: string;
  groups: TrackRecordGroup[];
  note: string;
}

export interface SignalBacktest {
  status: "ready" | "computing";
  computed_at: string | null;
  span_start: string | null;
  span_end: string | null;
  sources: { symbol: string; venue: string; bars: number }[];
  groups: TrackRecordGroup[];
  note: string;
}

/* Solana token cards (GET /v1/solana/tokens/new and /v1/solana/tokens/{mint}).
 * Every fact is always present; one a source couldn't answer is "unavailable". */
export type TokenFactStatus = "ok" | "unavailable" | "not_applicable";

export interface TokenFact<T> {
  status: TokenFactStatus;
  value: T | null;
  source: string;
  fetched_at: string | null;
  detail: string | null;
}

export interface TokenHolder {
  owner: string;
  pct: number;
  is_pool: boolean;
}

export interface TokenMarket {
  price_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  price_change_24h_pct: number | null;
  pool_created_at: string | number | null;
  pool_count: number;
  total_liquidity_usd: number;
  total_volume_24h_usd: number;
  pools_checked_at: string | null;
  main_pool: { dex: string; address: string; labels: string[] | null } | null;
  geckoterminal_liquidity_usd: number | null;
}

export interface TokenLiquidityLock {
  pool_type: "launch_curve" | "lp_token" | "position_based" | "unknown";
  dex: string;
  pool: string;
  burned_pct: number | null;
}

export interface TokenCard {
  mint: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  token_program: "spl-token" | "token-2022" | null;
  first_seen_at: string | null;
  checked_at: string;
  facts: {
    mint_authority: TokenFact<string>;
    freeze_authority: TokenFact<string>;
    token_extensions: TokenFact<{ risky: string[]; transfer_fee_bps: number | null }>;
    metadata_mutable: TokenFact<boolean>;
    top10_share: TokenFact<{
      pct: number;
      holder_count: number | null;
      as_of: string | null;
      pool_accounts_excluded: boolean;
      holders: TokenHolder[];
    }>;
    liquidity_lock: TokenFact<TokenLiquidityLock>;
    market: TokenFact<TokenMarket>;
  };
  second_opinion: {
    provider: string;
    status: "ok" | "unavailable";
    fetched_at: string | null;
    score_normalised: number | null;
    lp_locked_pct: number | null;
    risks: { name: string; level: string; description: string }[];
  };
}

export interface NewTokensFeed {
  status: "warming" | "ready";
  updated_at: string | null;
  sources: { name: string; fetched_at: string | null; ok: boolean; error: string | null }[];
  tokens: TokenCard[];
  note: string;
}
