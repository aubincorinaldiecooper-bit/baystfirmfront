# BayAnalytics web frontend

## Data rules

- Company-research data comes only from the backend's web-search results. Never add a data source, API or provider the user hasn't approved.
- Company-research charts (price history, quarterly figures) and key stats show only values the backend retrieved through web search, with the page each came from. An empty chart states that web search found no page with that data. Never present it as switched off.
- Everything the UI shows comes from recorded backend events or result fields: no fake data, no simulated progress, no timers driving state.
- `BAY_API_KEY` stays on the server (the `/api/bay` proxy); nothing client-side reads it.
- Owner-approved market source: Home (`/`), crypto detail (`/crypto/*`), and Solana token pages
  (`/tokens/*`) read only Baystfirm through the server-side `/api/markets` proxy; `BAYST_API_KEY`
  stays on the server. Crypto charts use backend exchange candles; token facts and token candles
  use only the backend's Solana endpoints. Stocks never show a live price. The legacy `/markets`
  and `/tokens` routes redirect into the workspace. Analysis pages remain web-search-only.
- This is an intelligence-only product, not a wallet, trading, or custody product. Never add an
  overall safe/unsafe token verdict; describe sourced facts and any separately labelled second
  opinion without blending them.

## How changes ship (owner's rule, not negotiable)

- Finish the whole change first, then run the checks once. When asked to remove something, remove
  all of it (code, wiring, config, labels, docs, tests) in one pass before checking.
- Once a change has passed its checks, **leave it alone**: no follow-up tidying, relabelling or
  "one more fix" before it ships, and no re-running checks on code that already passed. Ship
  exactly what passed.
- Leftovers noticed after checks pass are reported to the owner, not fixed on the spot. They go
  in a later change only if the owner asks.
