"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { watchlistAlertsEnabled } from "@/lib/markets/features";
import { shortAddress, SOLANA_MINT } from "@/lib/markets/tokens";
import { useRecentSearches } from "@/lib/search/recents";

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export default function RecentAssetTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const instrument = searchParams.get("instrument");
  const { record } = useRecentSearches(watchlistAlertsEnabled());

  useEffect(() => {
    const crypto = /^\/crypto\/([^/]+)$/.exec(pathname ?? "");
    if (crypto) {
      const base = decodeSegment(crypto[1])?.toUpperCase();
      if (base) record({ kind: "crypto", id: `crypto:${base}`, label: base, ...(instrument ? { detail: instrument } : {}) });
      return;
    }
    const token = /^\/tokens\/([^/]+)$/.exec(pathname ?? "");
    if (token) {
      const mint = decodeSegment(token[1]);
      if (mint && SOLANA_MINT.test(mint)) {
        record({ kind: "token", id: `token:${mint}`, label: shortAddress(mint) });
      }
    }
  }, [instrument, pathname, record]);

  return null;
}
