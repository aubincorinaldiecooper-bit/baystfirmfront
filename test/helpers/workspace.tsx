/* Renders pages inside the real workspace shell with injected API deps.
 * Test files mock `next/navigation` themselves (vi.mock is hoisted per file). */

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import FinanceShell from "@/components/finance/FinanceShell";
import { ApiDepsProvider, type ApiDeps } from "@/lib/api/deps";

export function renderWorkspace(ui: ReactNode, deps: Partial<ApiDeps>) {
  return render(
    <ApiDepsProvider value={deps}>
      <FinanceShell>{ui}</FinanceShell>
    </ApiDepsProvider>,
  );
}
