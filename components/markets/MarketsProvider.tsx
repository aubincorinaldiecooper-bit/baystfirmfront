"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAlerts } from "@/lib/markets/useAlerts";
import { watchlistAlertsEnabled } from "@/lib/markets/features";
import { useMarkets, type UseMarketsResult } from "@/lib/markets/useMarkets";

type AlertsValue = ReturnType<typeof useAlerts>;
export type MarketsContextValue = UseMarketsResult & { alerts: AlertsValue | null };

const MarketsContext = createContext<MarketsContextValue | null>(null);

function AlertsContextProvider({ markets, children }: { markets: UseMarketsResult; children: ReactNode }) {
  const alerts = useAlerts(markets.state);
  return <MarketsContext.Provider value={{ ...markets, alerts }}>{children}</MarketsContext.Provider>;
}

function MarketsValueProvider({ markets, children }: { markets: UseMarketsResult; children: ReactNode }) {
  if (watchlistAlertsEnabled()) return <AlertsContextProvider markets={markets}>{children}</AlertsContextProvider>;
  return <MarketsContext.Provider value={{ ...markets, alerts: null }}>{children}</MarketsContext.Provider>;
}

function LiveMarketsProvider({ children }: { children: ReactNode }) {
  const markets = useMarkets();
  return <MarketsValueProvider markets={markets}>{children}</MarketsValueProvider>;
}

export default function MarketsProvider({ children, value }: { children: ReactNode; value?: UseMarketsResult }) {
  if (value) return <MarketsValueProvider markets={value}>{children}</MarketsValueProvider>;
  return <LiveMarketsProvider>{children}</LiveMarketsProvider>;
}

export function useMarketsContext(): MarketsContextValue {
  const value = useContext(MarketsContext);
  if (!value) throw new Error("useMarketsContext must be used inside MarketsProvider.");
  return value;
}
