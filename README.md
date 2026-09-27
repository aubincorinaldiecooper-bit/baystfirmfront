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

## Environment

Copy `.env.example` to `.env.local`. Both variables are server-only and deliberately have no
`NEXT_PUBLIC_` form.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BAY_API_URL` | `http://127.0.0.1:8000/api/v1` | Backend base URL including the versioned prefix |
| `BAY_API_KEY` | _(empty)_ | Sent as `Authorization: Bearer <key>`; a loopback-bound backend needs none |

The same build runs against a local or a cloud backend by changing these two values.

## Running against a backend

```bash
npm install
cp .env.example .env.local          # edit if the backend is not on 127.0.0.1:8000
npm run dev                         # http://localhost:3000
```

Start the backend separately (`cd backend && .venv/bin/bayanalytics serve` in the BayAnalytics
repository). The home page reads `GET /capabilities` through the proxy and shows the real Fast /
Deep availability with the backend's reasons, voice availability, whether web search is
configured, and the deployment. Nothing on the page is a placeholder: when the backend is down
the page says so and shows the error code.

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
  page.tsx                        the shell with the backend status
  globals.css                     the Beautiful UI foundation stylesheet, intact
  api/bay/[...path]/route.ts      GET/POST passthrough
  api/bay/analyses/[id]/events/   SSE relay
components/
  primitives/                     Beautiful UI primitives kept for the finance UI, demo content removed
                                  (see "Beautiful UI primitives" below)
  atoms/                          Button, SegmentedControl, StatusPill (Beautiful UI, unmodified)
  site/ThemeSync.tsx, ThemeToggle.tsx
  finance/FinanceShell.tsx        the product shell (no demo scenarios)
lib/
  api/types.ts                    TypeScript mirrors of the backend schemas and the 20 events
  api/client.ts                   BayApiClient + ApiError normalisation
  api/sse.ts                      SSE frame parser + stream handle (EventSource / fetch)
  api/capabilities.ts             /capabilities loaded once, profile availability with reasons
  api/history.ts                  cursor pagination for GET /analyses
  analysis/reducer.ts             pure event → UI state reducer (dedupe by seq)
  auth/session.ts                 the session seam (anonymous)
  server/env.ts, proxy.ts         server-only configuration and the proxy
docs/AUTH.md                      the future authentication model
test/                             vitest suites and the synthetic event fixture
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

## Status

Verified in this repository, with the backend contract as the reference:

| Verified with stubs and the contract (vitest) | Verified by building | Not yet executed anywhere |
| --- | --- | --- |
| Reducer over the documented event sequence, replay dedupe, cancel vs failed, partial, result merge | `next build` of the shell, both route handlers registered as dynamic Node routes | A request against a running BayAnalytics backend (no model weights, no SEC/Stooq access in the build environment) |
| SSE frame parser (split chunks, CRLF, comments, retry), reconnect with `Last-Event-ID` and `?after=`, terminal close, HTTP-error and exhaustion fallback, EventSource dedupe | Lint and strict typecheck | Browser-side `EventSource` reconnect against a real stream |
| Client error normalisation: 422 ambiguity with candidates, 429 with `Retry-After`, 401, 503 profile unavailable, network and bad-response cases | | Voice upload end to end |
| Proxy: key injected server-side and absent otherwise, JSON/status/`Retry-After` passthrough, body limits, route allow-list, SSE chunk-by-chunk relay, `Last-Event-ID` forwarding, upstream abort on disconnect, error envelopes | | |
| Static boundary: no `NEXT_PUBLIC_` backend config, `BAY_*` read only in `lib/server/env.ts`, server modules guarded by `server-only`; `test/bundle.test.ts` builds with sentinel values and greps `.next/static` for the variable names and the values | | |
| No demo content in shipped code (`test/demo-content.test.ts`); kept primitives render only their props, with no timers, and nothing when empty (`test/primitives.test.tsx`) | | |

Not implemented yet (next changes): the prompt bar and Fast | Deep control wired to
`POST /analyses`, the analysis thread (progress, streamed answer, structured result), the
evidence pane, the history sidebar, the ambiguity picker, cancellation UI, voice input, and
authentication (see `docs/AUTH.md`).

## Licensing

Beautiful UI is MIT licensed; the notice is preserved in `LICENSE-THIRD-PARTY` and in the header of
every copied file. Icons come from `lucide-react` (ISC). No commercial icon package is used.