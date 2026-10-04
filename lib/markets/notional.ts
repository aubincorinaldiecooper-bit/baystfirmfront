import { instrumentKey, type DerivativeState } from "./state";
import type { MarketEvent } from "./types";

export function liquidationNotionalUsd(
  event: MarketEvent,
  derivatives: Record<string, DerivativeState>,
): number | null {
  if (typeof event.price !== "number" || typeof event.size !== "number") return null;
  const metadataMultiplier = event.metadata.contract_multiplier;
  const multiplier =
    typeof metadataMultiplier === "number"
      ? metadataMultiplier
      : derivatives[instrumentKey(event.venue, event.symbol)]?.contract_multiplier;
  if (event.venue === "okx" && event.instrument_kind === "perpetual" && multiplier == null) return null;
  return event.price * event.size * (multiplier ?? 1);
}
