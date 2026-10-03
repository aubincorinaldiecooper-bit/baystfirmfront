# BayAnalytics web

The web frontend for [BayAnalytics](../Bayanalytics), a CPU-only financial analysis backend for
public equities. It is a thin client: it asks the backend a question about a listed company,
renders the backend's recorded progress as it happens, streams the synthesised assessment, and
lets the analyst inspect the evidence. No finance reasoning, retrieval, calculation or model
orchestration lives here; the backend's API contract is the only thing this code depends on.

Stack: Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
[Beautiful UI](https://github.com/slev12397/beautiful-ui) primitives (MIT, see
`LICENSE-THIRD-PARTY`) · vitest.

## The proxy boundary

The browser never talks to the BayAnalytics API and never holds its key.

```
┌──────────────┐   same-origin    ┌──────────────────────────────┐   BAY_API_URL     ┌──────────────────┐
│   Browser    │ ───────────────▶ │  Next.js server              │ ────────────────▶ │  BayAnalytics    │
│              │  /api/bay/*      │  app/api/bay/[...path]       │  Authorization:   │  FastAPI /api/v1 │
│  lib/api/*   │ ◀─────────────── │  app/api/bay/analyses/[id]/  │  Bearer <key>     │                  │
│  (client,    │  JSON untouched  │           events (SSE relay) │  (server-side)    │  Laya · Spark ·  │
│   EventSource│  SSE untouched   │  lib/server/proxy.ts         │ ◀──────────────── │  Whisper · store │
│   reducer)   │                  │  lib/auth/session.ts (seam)  │  status, headers, │                  │
└──────────────┘                  └──────────────────────────────┘  body as-is       └──────────────────┘
```

- `lib/server/proxy.ts` relays only the contract routes (`health`, `capabilities`, `analyses`,
  `analyses/{id}`, `analyses/{id}/cancel`, `transcriptions`) and refuses everything else with the
  backend's own `{"error": {...}}` envelope. Upstream status, `Content-Type`, `Retry-After` and
  the body pass through unchanged; JSON is never re-serialised.
- Request bodies are buffered (the backend requires `Content-Length`) and bounded to the backend
  limits before anything is forwarded: 64 KiB for JSON, 25 MiB for audio. Browser cookies and
  `Authorization` headers are never forwarded upstream.
- `analyses/{id}/events` has a dedicated streaming handler: the upstream body is handed to the
  response as a `ReadableStream` chunk by chunk, `Last-Event-ID` is forwarded both as a header and
  as `?after=`, the response carries `Content-Type: text/event-stream`,
  `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, the route is
  `dynamic = "force-dynamic"` on the Node runtime, and the upstream request is aborted the moment
  the browser disconnects.
- `lib/auth/session.ts` is consulted on every proxied request. It is always anonymous today; see
  `docs/AUTH.md` for the reserved model. **BayAnalytics doesn't store your password because there
  isn't one.**

## The Markets page (crypto)

`/markets` is the crypto terminal over the [Baystfirm](../baystfirm) backend, a separate,
owner-approved source: normalized public trades from the venues the backend runs (Coinbase,
Kraken, Bybit, OKX by default), its stablecoin-peg and short-horizon momentum classifiers and its
evaluation gate. The browser reads it only through `/api/markets/*`
(`lib/server/baystProxy.ts`): GET `snapshot`, `classifications`, `events`, `evaluation/gate` and
`health`, plus the live server-sent stream at `/api/markets/stream` (piped from `/v1/stream/sse`).
Classifications are shown with probability, horizon, evidence, freshness and abstention, and
marked Shadow / Uncalibrated until a run passes the gate and is promoted manually. The analysis
pages are unchanged and stay web-search-only.

Run the backend with `.venv/bin/baystfirm serve --port 8100` in the Baystfirm repository and set
`BAYST_API_URL` / `BAYST_API_KEY` (server-only, like the BayAnalytics values).

## Environment

Copy `.env.example` to `.env.local`. Both variables are server-only and deliberately have no
`NEXT_PUBLIC_` form.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BAY_API_URL` | `http://127.0.0.1:8000/api/v1` | Backend base URL including the versioned prefix |
| `BAY_API_KEY` | _(empty)_ | Sent as `Authorization: Bearer <key>`; a loopback-bound backend needs none |
| `BAYST_API_URL` | `http://127.0.0.1:8100` | Baystfirm crypto backend for `/markets` (no version prefix) |
| `BAYST_API_KEY` | _(empty)_ | Bearer key when the Baystfirm service sets `BAYST_API_KEY` |

The same build runs against a local or a cloud backend by changing these two values.

## Running against a backend

```bash
npm install
cp .env.example .env.local          # edit if the backend is not on 127.0.0.1:8000
npm run dev                         # http://localhost:3000
```

Start the backend separately (`cd backend && .venv/bin/bayanalytics serve` in the BayAnalytics
repository). Then:

- `/` asks the question: free text, the Fast | Deep profile (availability and the backend's
  reason from `GET /capabilities`; an unavailable profile cannot be chosen) and the horizon
  (`auto` lets the backend read it from the question). Sending is `POST /analyses`. A 422
  `AMBIGUOUS_INSTRUMENT` shows the backend's candidates; choosing one resubmits the same question
  with `instrument: {symbol, exchange}`. The backend's capabilities are listed underneath.
- `/analyses/{id}` is one analysis. It reads `GET /analyses/{id}`: a finished analysis is rendered
  from its result; a running one is attached to its event stream from the beginning, so a reload
  replays every recorded event and rebuilds the same view. The page is a workspace: the main
  window (Company performance | Trading view; charts render only from price series or quarterly
  figures the backend sends, and say so plainly when there are none, as with the current
  web-search-only backend), the live research dock under it (the live view of the current
  research step and the activity feed: searches and their hits, each page requested and whether
  it was kept or skipped and why, all from recorded events), and a collapsible right panel with
  the analysis (progress, one step per received phase event; Spark's tokens as they arrive; the
  structured result on completion) and the symbol (a browser-only watchlist, key stats from the
  backend's calculations). A citation chip shows its source in the live view. Cancel calls
  `POST /analyses/{id}/cancel` and the terminal event decides. A dropped connection is retried
  with `Last-Event-ID`; if the stream gives up, the durable state is read and the page reconnects
  from the last seq on demand or when the browser is back online.
- The sidebar is the real history (`GET /analyses`, keyset pages, "Load more" while the backend
  returns a cursor). On narrow screens it is a drawer.

Nothing on the pages is a placeholder: every figure is a backend `display` string or value, and
when the backend is down the page says so and shows the error code.

Checks:

```bash
npm run lint        # eslint (next/core-web-vitals + next/typescript)
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # next build
```

## What is here

```
app/
  layout.tsx                      Inter + JetBrains Mono, theme boot (from Beautiful UI)
  (workspace)/layout.tsx          the shell (history sidebar) shared by every page
  (workspace)/page.tsx            the question composer and the backend status
  (workspace)/analyses/[id]/      one analysis per URL (reload and history links reattach)
  globals.css                     the Beautiful UI foundation stylesheet, intact
  api/bay/[...path]/route.ts      GET/POST passthrough
  api/bay/analyses/[id]/events/   SSE relay
components/
  primitives/                     Beautiful UI primitives kept for the finance UI, demo content removed
                                  (see "Beautiful UI primitives" below)
  atoms/                          Button, SegmentedControl, StatusPill (Beautiful UI, unmodified)
  site/ThemeSync.tsx, ThemeToggle.tsx
  finance/FinanceShell.tsx        the product shell: sidebar / drawer and the page pane
  finance/HistorySidebar.tsx      GET /analyses history, load more, empty and error states
  finance/AnalysisComposer.tsx    question, profile, horizon, POST /analyses, candidate picker
  finance/AnalysisView.tsx        one analysis: the workspace layout, cancel, errors
  finance/analysis/               main window, SVG charts, live research dock, side panel, symbol tab
  finance/ProgressPanel.tsx       the trace (ThinkingState)
  finance/result/                 the structured result, section by section
  finance/ErrorPanels.tsx, CandidatePicker.tsx, BackendStatus.tsx, PageHeader.tsx, ui.tsx
lib/
  api/types.ts                    TypeScript mirrors of the backend schemas and the events
  api/client.ts                   BayApiClient + ApiError normalisation
  api/sse.ts                      SSE frame parser + stream handle (EventSource / fetch)
  api/capabilities.ts             /capabilities loaded once, profile availability with reasons
  api/history.ts                  cursor pagination for GET /analyses
  analysis/reducer.ts             pure event → UI state reducer (dedupe by seq, milestones, attach)
  analysis/progress.ts            the progress steps, one per received phase event
  analysis/activity.ts            the live research dock's feed and live view, from recorded state
  market/                         series math, formatting, key stats, the localStorage watchlist
  analysis/useAnalysisRun.ts      an analysis page's lifecycle: snapshot, replay, result, reconnect
  analysis/useSubmitAnalysis.ts   POST /analyses with the ambiguity flow
  analysis/requirements.ts        PR #4 requirement labels, read defensively
  analysis/citations.ts, labels.ts  citation chips in Spark's text; display labels (no maths)
  api/deps.tsx                    the client and SSE opener, injectable for tests
  auth/session.ts                 the session seam (anonymous)
  server/env.ts, proxy.ts         server-only configuration and the proxy
docs/AUTH.md                      the future authentication model
test/                             vitest suites, the synthetic event fixture and backend-produced
                                  fixtures (test/fixtures/backend, see test/fixtures/backend.ts)
```

### Beautiful UI primitives

Kept because the finance UI maps onto them (spec sections 11 and 15): `PromptBar` (prompt, Fast | Deep
options picker, dictation), `ThinkingState` (recorded research/scoring steps), `ToolChips`
(deterministic calculations), `ContextCards` (sources), `StreamingText` (the streamed assessment),
`LoadingState` (model load / queue), `RecordsTable` (historical periods, comparisons), `InsightCards`
(a few real metrics), `SidebarNav` (history), plus `GlideMenu`, which `SidebarNav` builds on.

The upstream gallery fills these with an invented shop's figures, records, sources, fake timers and
staged reveals. Here every one of them renders only what its props give it: lists default to empty and
render nothing, nothing reveals on a timer (network-delivered text and recorded state are the clock),
no external images or video are loaded, and charts plot only real points (no interpolated tooltip
values). Each modified file says so in its MIT header. `test/demo-content.test.ts` fails if demo
vocabulary, externally hosted assets, stray URLs or component timers reappear in `app/`,
`components/` or `lib/`; `test/primitives.test.tsx` checks the render-what-you-are-given behaviour.

Not copied (no planned finance use): AgentScreen, ApprovalCard, ChatComposer, CodeBlock, DiffTable,
FilterTable, FineTuneCard, Flowchart, RecommendationCard, SearchList, SelectionActions, TaskRows, and
the atoms Chip, EntityChip, ProgressRing, Shimmer, StreamText, Switch, TextRow, ValuePill.
`app/globals.css` is still the full upstream stylesheet (spec section 1.3), so it keeps rules for
those components until it is pruned against visual checks.

### Contract notes the client relies on

- `AMBIGUOUS_INSTRUMENT` is answered synchronously by `POST /analyses` (422 with
  `details.candidates`); `isAmbiguousInstrument()` narrows it. The same code can still arrive on
  the stream as `analysis.failed`.
- A user cancel ends the stream with `analysis.failed` whose `status` is `"cancelled"`; the reducer
  branches on `status`, not on the error code, and treats the terminal event as authoritative.
- `laya.started` / `laya.decision` / `laya.completed` are keyed by their `stage`
  (`research_plan` inside research; `evidence_scan`, `history_scan`, `text_evidence` are scoring;
  `horizon` runs after the calculations, still under the backend's `calculating` status).
- `spark.token` carries the delta as `text`. `spark.started` arrives with the first token.
- The reducer's status union is the spec's list plus `resolving`, which mirrors the backend's
  `resolving_instrument` between `analysis.started` and the first `research.started`.
- A `partial: true` result with `status: completed` means the synthesis was cut off; the reducer
  also sets `partial` from `spark.completed.truncated`.
- When the stream cannot be recovered the SSE handle calls `onFallback` once; the durable state
  comes from `GET /analyses/{id}` (`applyResult` merges it without regressing a live status).
- A running job's `GET /analyses/{id}` snapshot reports `partial: true` for any started job, so
  only a terminal result's `partial` marks content as incomplete.
- `research.query.query` is `null` for structured retrievals (EDGAR, prices, benchmarks); the
  product-level `label` is what the trace shows.
- Optional fields from open backend PRs are rendered only when present: `thesis_diff` and the
  `valuation_reconciliation_Ny` calculations' `meta.reconciliation` (PR #3), and `requirements`
  on `research.started` and on the result (PR #4, short string labels only; the question intent
  and interpretation source are never shown).

## Status

Verified in this repository, with the backend contract as the reference:

| Verified with stubs and the contract (vitest) | Verified by building | Not yet executed anywhere |
| --- | --- | --- |
| Reducer over the documented event sequence, replay dedupe, cancel vs failed, partial, result merge | `next build` of the shell, both route handlers registered as dynamic Node routes | Real models (Laya, Spark), live SEC EDGAR / Stooq / SearXNG research |
| SSE frame parser (split chunks, CRLF, comments, retry), reconnect with `Last-Event-ID` and `?after=`, terminal close, HTTP-error and exhaustion fallback, EventSource dedupe | Lint and strict typecheck | |
| Reducer and progress trace over complete event sequences the backend produced with its own test doubles (completed, failed, cancelled), the backend's raw SSE transcript, replays with duplicates, reconnect mid-stream, attach after reload | | |
| Pages with the real reducer and SSE handle on a controllable EventSource: attach and replay, streamed text then result, drop / fallback / reconnect from the last seq / back online, cancel, structured failure and rerun, not found; composer (candidate picker, profile availability, horizon, 429 / 503 / validation errors); history paging, empty and error states; result rendering with and without the optional PR #3 / PR #4 fields and without Laya internals | | |
| Client error normalisation: 422 ambiguity with candidates, 429 with `Retry-After`, 401, 503 profile unavailable, network and bad-response cases | | Voice upload end to end |
| Proxy: key injected server-side and absent otherwise, JSON/status/`Retry-After` passthrough, body limits, route allow-list, SSE chunk-by-chunk relay, `Last-Event-ID` forwarding, upstream abort on disconnect, error envelopes | | |
| Static boundary: no `NEXT_PUBLIC_` backend config, `BAY_*` read only in `lib/server/env.ts`, server modules guarded by `server-only`; `test/bundle.test.ts` builds with sentinel values and greps `.next/static` for the variable names and the values | | |
| No demo content in shipped code (`test/demo-content.test.ts`); kept primitives render only their props, with no timers, and nothing when empty (`test/primitives.test.tsx`) | | |

Also run once for this change, outside `npm test`: `next build && next start` against the real
BayAnalytics API over HTTP on 127.0.0.1, wired with the backend's own test doubles, driven in
Chromium (submit, live progress, reload mid-run, a killed proxy and the reconnect, cancel, the
ambiguity picker, a queued second run, the mobile drawer). That harness is not part of this
repository.

Not implemented yet (next changes): voice input and authentication (see `docs/AUTH.md`).

## Licensing

Beautiful UI is MIT licensed; the notice is preserved in `LICENSE-THIRD-PARTY` and in the header of
every copied file. Icons come from `lucide-react` (ISC). No commercial icon package is used.