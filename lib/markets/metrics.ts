export function spreadBps(
  bid: number | null | undefined,
  ask: number | null | undefined,
): number | null {
  if (typeof bid !== "number" || typeof ask !== "number" || !Number.isFinite(bid) || !Number.isFinite(ask)) {
    return null;
  }
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 10_000 : null;
}

export function basisBps(
  mark: number | null | undefined,
  index: number | null | undefined,
): number | null {
  if (typeof mark !== "number" || typeof index !== "number" || !Number.isFinite(mark) || !Number.isFinite(index)) {
    return null;
  }
  return index > 0 ? ((mark - index) / index) * 10_000 : null;
}
