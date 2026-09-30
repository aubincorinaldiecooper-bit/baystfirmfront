# BayAnalytics web frontend

## Data rules

- Data comes only from the backend, which uses web search results only. Never add a data source, API or provider the user hasn't approved.
- Everything the UI shows comes from recorded backend events or result fields: no fake data, no simulated progress, no timers driving state.
- `BAY_API_KEY` stays on the server (the `/api/bay` proxy); nothing client-side reads it.
