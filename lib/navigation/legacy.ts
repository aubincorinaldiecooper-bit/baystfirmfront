export function marketsRedirect(instrumentParam: string | string[] | undefined): string {
  const instrument = Array.isArray(instrumentParam) ? instrumentParam[0] : instrumentParam;
  if (!instrument) return "/";
  const separator = instrument.indexOf("|");
  const symbol = separator >= 0 ? instrument.slice(separator + 1) : instrument;
  const base = symbol.split("-")[0]?.trim().toUpperCase();
  if (!base) return "/";
  return `/crypto/${encodeURIComponent(base)}?instrument=${encodeURIComponent(instrument)}`;
}

export const TOKENS_REDIRECT = "/";
