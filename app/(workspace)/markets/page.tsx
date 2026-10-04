import { Suspense } from "react";
import MarketsView from "@/components/markets/MarketsView";

/* The crypto market terminal: live public exchange trades and the shadow
 * classifiers from the Baystfirm backend, through /api/markets. */
export default function MarketsPage() {
  return (
    <Suspense fallback={<div className="min-h-0 flex-1 p-6 text-[12.5px] text-ink-3">Loading market view…</div>}>
      <MarketsView />
    </Suspense>
  );
}
