export function watchlistAlertsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WATCHLIST_ALERTS === "true";
}
