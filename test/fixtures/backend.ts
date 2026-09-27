/**
 * Backend-produced test fixtures (test/fixtures/backend/*.json, completed.sse.txt).
 *
 * TEST FIXTURES, NOT MARKET DATA. They were produced by running the BayAnalytics
 * backend itself (real runtime, job runner, event bus, orchestrator and HTTP
 * API, in-process) with its own test doubles from backend/tests/doubles:
 * RuleLaya (a rule-based stand-in for Laya), ScriptedSpark (scripted text
 * labelled "[scripted]", no language model) and the synthetic fixture
 * research directory backend/tests/fixtures/research/apple. Every company
 * figure in them is synthetic. Each JSON file carries the same note in
 * `_note` and the backend revision in `_backend`:
 *
 *   - main @ ef4ba9d: capabilities, completed (+ the raw SSE transcript),
 *     cancelled (cancel at the first spark.token), failed (Laya failure after
 *     research), ambiguous (422 for "Compare Apple and Microsoft."),
 *     not-found, history (two keyset pages of limit 1), deep-unavailable;
 *   - PR #3 branch @ dacaadb: thesis-diff (second run of the same question,
 *     with `thesis_diff` and `valuation_reconciliation_*`) and thesis-scope (a
 *     near-term run after multi-horizon ones: `horizon_scope_changed`).
 *
 * They are read only by tests; app/, components/ and lib/ never import them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AnalysisEvent,
  AnalysisListResponse,
  AnalysisResult,
  Capabilities,
  CancelAnalysisResponse,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  ErrorEnvelope,
} from "@/lib/api/types";

const DIR = join(__dirname, "backend");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), "utf8")) as T;
}

export interface RunFixture {
  _note: string;
  _backend: string;
  request: CreateAnalysisRequest;
  created: CreateAnalysisResponse;
  events: AnalysisEvent[];
  result: AnalysisResult;
}

export const completedRun = load<RunFixture>("completed.json");
export const cancelledRun = load<RunFixture & { cancel_response: CancelAnalysisResponse }>("cancelled.json");
export const failedRun = load<RunFixture>("failed.json");
export const thesisRun = load<Omit<RunFixture, "events"> & { previous_analysis_id: string }>("thesis-diff.json");
export const thesisScopeRun = load<Omit<RunFixture, "events">>("thesis-scope.json");
export const capabilitiesFixture = load<{ capabilities: Capabilities }>("capabilities.json").capabilities;
export const deepUnavailable = load<{ capabilities: Capabilities; create_status: number; create_body: ErrorEnvelope }>(
  "deep-unavailable.json",
);
export const ambiguous = load<{ request: CreateAnalysisRequest; status: number; body: ErrorEnvelope }>("ambiguous.json");
export const notFound = load<{ status: number; body: ErrorEnvelope }>("not-found.json");
export const historyPages = load<{ pages: AnalysisListResponse[]; limit: number }>("history.json");
export const completedSseTranscript = readFileSync(join(DIR, "completed.sse.txt"), "utf8");

/** A deep copy, so a test can alter a fixture without affecting others. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
