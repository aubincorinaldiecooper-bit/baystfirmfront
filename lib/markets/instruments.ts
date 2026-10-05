import type { InstrumentRow } from "./state";

export interface BaseInstrumentGroup {
  base: string;
  instruments: InstrumentRow[];
  preferred: InstrumentRow;
  venueCount: number;
  hasPerpetual: boolean;
}

export function preferredInstrument(rows: readonly InstrumentRow[]): InstrumentRow | null {
  const ordered = [...rows].sort((a, b) => a.venue.localeCompare(b.venue) || a.symbol.localeCompare(b.symbol));
  return (
    ordered.find((row) => row.venue.toLowerCase() === "coinbase" && row.kind === "spot" && row.symbol.endsWith("-USD")) ??
    ordered.find((row) => row.kind === "spot") ??
    ordered[0] ??
    null
  );
}

export function groupInstrumentsByBase(rows: readonly InstrumentRow[]): BaseInstrumentGroup[] {
  const grouped = new Map<string, InstrumentRow[]>();
  for (const row of rows) {
    const base = row.symbol.split("-")[0]?.toUpperCase();
    if (!base) continue;
    const values = grouped.get(base) ?? [];
    values.push(row);
    grouped.set(base, values);
  }
  return Array.from(grouped, ([base, instruments]) => {
    const preferred = preferredInstrument(instruments);
    if (!preferred) return null;
    return {
      base,
      instruments,
      preferred,
      venueCount: new Set(instruments.map((row) => row.venue)).size,
      hasPerpetual: instruments.some((row) => row.kind === "perpetual"),
    };
  })
    .filter((group): group is BaseInstrumentGroup => group !== null)
    .sort((a, b) => a.base.localeCompare(b.base));
}
