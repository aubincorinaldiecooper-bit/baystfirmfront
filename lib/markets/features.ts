export function watchlistAlertsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WATCHLIST_ALERTS === "true";
}

export function fullHomeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FULL_HOME === "true";
}
