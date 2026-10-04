export const WATCHLIST_STORAGE_KEY = "baystfirm.markets.watchlist.v1";

function validInstrumentKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const separator = value.indexOf("|");
  return separator > 0 && separator < value.length - 1 && value.indexOf("|", separator + 1) === -1;
}

function uniqueValidKeys(values: readonly unknown[]): string[] {
  return Array.from(new Set(values.filter(validInstrumentKey)));
}

export function parseWatchlist(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? uniqueValidKeys(parsed) : [];
  } catch {
    return [];
  }
}

export function serializeWatchlist(keys: readonly string[]): string {
  return JSON.stringify(uniqueValidKeys(keys));
}

export function toggleWatchlist(keys: readonly string[], key: string): string[] {
  if (!validInstrumentKey(key)) return uniqueValidKeys(keys);
  const current = uniqueValidKeys(keys);
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}
