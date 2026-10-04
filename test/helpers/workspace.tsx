/* Renders pages inside the real workspace shell with injected API deps.
 * Test files mock `next/navigation` themselves (vi.mock is hoisted per file). */

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import FinanceShell from "@/components/finance/FinanceShell";
import { initialMarketsState } from "@/lib/markets/state";
import type { UseMarketsResult } from "@/lib/markets/useMarkets";
import { ApiDepsProvider, type ApiDeps } from "@/lib/api/deps";

const emptyMarkets: UseMarketsResult = {
  state: initialMarketsState(),
  snapshot: null,
  snapshotError: null,
  gate: null,
  gateError: null,
  trackRecord: null,
  trackRecordError: null,
  backtest: null,
  backtestError: null,
  stream: "connecting",
  reload: () => {},
};

export function renderWorkspace(ui: ReactNode, deps: Partial<ApiDeps>, markets: UseMarketsResult = emptyMarkets) {
  return render(
    <ApiDepsProvider value={deps}>
      <FinanceShell marketsOverride={markets}>{ui}</FinanceShell>
    </ApiDepsProvider>,
  );
}
