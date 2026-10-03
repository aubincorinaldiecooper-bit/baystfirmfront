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
  event_type: string;
  exchange_timestamp: string;
  received_timestamp: string;
  sequence: number | string | null;
  price: number | null;
  size: number | null;
  side: string;
  bid: number | null;
  ask: number | null;
  payload_hash: string;
  metadata: Record<string, unknown>;
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
  thresholds: Record<string, number>;
}
