# BayAnalytics web frontend

## Data rules

- Data comes only from the backend, which uses web search results only. Never add a data source, API or provider the user hasn't approved.
- Everything the UI shows comes from recorded backend events or result fields: no fake data, no simulated progress, no timers driving state.
- `BAY_API_KEY` stays on the server (the `/api/bay` proxy); nothing client-side reads it.

## How changes ship (owner's rule, not negotiable)

- Finish the whole change first, then run the checks once. When asked to remove something, remove
  all of it (code, wiring, config, labels, docs, tests) in one pass before checking.
- Once a change has passed its checks, **leave it alone**: no follow-up tidying, relabelling or
  "one more fix" before it ships, and no re-running checks on code that already passed. Ship
  exactly what passed.
- Leftovers noticed after checks pass are reported to the owner, not fixed on the spot. They go
  in a later change only if the owner asks.
